-- Semantic search for notes and tasks (plan item 9.1).
--
-- Migration 0004 created `semantic_documents` (pgvector, vector(1536), HNSW cosine index) and a
-- SECURITY DEFINER `search_semantic_documents` RPC, but nothing ever wrote or read them. This
-- migration turns the table into a per-entity embedding index the app keeps up to date:
--
--   * One row per task/note (`UNIQUE (entity_type, entity_id)`), `user_id` = the entity's owner
--     (so wipes and the ON DELETE CASCADE from 0016 still work), plus `model` (embeddings from
--     different models are not comparable) and `content_hash` (md5 of the embedded text).
--   * The embedded text is built in SQL (`semantic_task_text` / `semantic_note_text`), so the
--     hash the server compares is always the database's own view of the row.
--   * `semantic_pending(model, limit, user)` (SECURITY INVOKER) lists rows the caller can see
--     whose document is missing, from another model or outdated. The server embeds them in one
--     provider call and stores them with `semantic_upsert(model, docs)` (SECURITY DEFINER): it
--     re-checks access per row (`can_access_task` / `can_access_note`) and skips a row whose text
--     changed in the meantime (hash mismatch), so a concurrent edit is simply picked up next time.
--   * `match_semantic_documents(embedding, model, limit, min_similarity)` (SECURITY INVOKER)
--     returns the nearest live tasks/notes the caller can read: RLS on `semantic_documents`
--     (owner or project member through the security-definer helpers) and on `tasks`/`notes`.
--   * Authenticated users can only read the table; every write goes through `semantic_upsert`
--     (or the service role: demo seed, n8n maintenance). Hard-deleting a task or note removes
--     its document.
--
-- The vector dimension stays 1536: OpenAI text-embedding-3-small is 1536-d, and longer
-- Matryoshka embeddings (Gemini gemini-embedding-001: 3072) are truncated and re-normalised by
-- the server (src/lib/semantic.ts) before they reach the database. HNSW indexes at most 2000
-- dimensions, so keeping 1536 also keeps the existing index usable.
--
-- Idempotent: safe to run more than once.

-- 1. Table shape --------------------------------------------------------------------------------

ALTER TABLE public.semantic_documents ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.semantic_documents ADD COLUMN IF NOT EXISTS content_hash text;

-- Nothing wrote this table before; drop anything that cannot be a valid entity document.
DELETE FROM public.semantic_documents WHERE entity_type NOT IN ('task', 'note');
DELETE FROM public.semantic_documents d
USING public.semantic_documents newer
WHERE d.entity_type = newer.entity_type
  AND d.entity_id = newer.entity_id
  AND (d.updated_at, d.id) < (newer.updated_at, newer.id);

ALTER TABLE public.semantic_documents
  DROP CONSTRAINT IF EXISTS semantic_documents_user_id_entity_type_entity_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS semantic_documents_entity_key
  ON public.semantic_documents (entity_type, entity_id);
-- The dropped unique constraint was also the index behind the user_id foreign key (0016).
CREATE INDEX IF NOT EXISTS semantic_documents_user_idx ON public.semantic_documents (user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'semantic_documents_entity_type_check') THEN
    ALTER TABLE public.semantic_documents
      ADD CONSTRAINT semantic_documents_entity_type_check CHECK (entity_type IN ('task', 'note'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'semantic_documents_model_length') THEN
    ALTER TABLE public.semantic_documents
      ADD CONSTRAINT semantic_documents_model_length CHECK (model IS NULL OR char_length(model) <= 200);
  END IF;
END $$;

-- 2. Access: read-only for members, writes through semantic_upsert ------------------------------

DROP POLICY IF EXISTS semantic_documents_owner ON public.semantic_documents;
DROP POLICY IF EXISTS semantic_documents_select ON public.semantic_documents;
CREATE POLICY semantic_documents_select ON public.semantic_documents FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (entity_type = 'task' AND public.can_access_task(entity_id, (SELECT auth.uid())))
    OR (entity_type = 'note' AND public.can_access_note(entity_id))
  );
REVOKE INSERT, UPDATE, DELETE ON public.semantic_documents FROM authenticated;
GRANT SELECT ON public.semantic_documents TO authenticated;
GRANT ALL ON public.semantic_documents TO service_role;

-- The 0004 RPC was SECURITY DEFINER, owner-only and never used; match_semantic_documents replaces it.
DROP FUNCTION IF EXISTS public.search_semantic_documents(vector, integer);

-- 3. Embedded text -------------------------------------------------------------------------------

-- Title, tags and the first 2000 characters of the description.
CREATE OR REPLACE FUNCTION public.semantic_task_text(_title text, _description text, _tags text[])
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT btrim(concat_ws(E'\n',
    nullif(btrim(_title), ''),
    nullif(array_to_string(_tags, ' '), ''),
    nullif(btrim(left(_description, 2000)), '')))
$$;

-- Title, tags and the first 2000 characters of the markdown mirror, without block-id markers.
CREATE OR REPLACE FUNCTION public.semantic_note_text(_title text, _content text, _tags text[])
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT btrim(concat_ws(E'\n',
    nullif(btrim(_title), ''),
    nullif(array_to_string(_tags, ' '), ''),
    nullif(btrim(left(regexp_replace(_content, '[ \t]\^[A-Za-z0-9_-]{6,}', '', 'g'), 2000)), '')))
$$;

-- 4. Pending rows ---------------------------------------------------------------------------------

-- Live (not trashed, not archived) tasks and notes visible to the caller whose document is
-- missing, from another model or outdated, newest first. A signed-in caller sees what RLS allows
-- (own rows and shared projects); `_user_id` may only repeat the caller's id. The service role
-- (no auth.uid()) may pass `_user_id` to restrict to one owner, or NULL for every user.
CREATE OR REPLACE FUNCTION public.semantic_pending(
  _model text,
  _limit integer DEFAULT 50,
  _user_id uuid DEFAULT NULL
)
RETURNS TABLE(entity_type text, entity_id uuid, user_id uuid, body text, content_hash text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE
  _uid uuid := (SELECT auth.uid());
BEGIN
  IF _model IS NULL OR char_length(_model) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'semantic_pending: invalid model' USING ERRCODE = '22023';
  END IF;
  IF _uid IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> _uid THEN
    RAISE EXCEPTION 'semantic_pending: forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH src AS (
    SELECT 'task'::text AS kind, t.id, t.user_id AS owner,
           public.semantic_task_text(t.title, t.description, t.tags) AS txt, t.updated_at AS ts
    FROM public.tasks t
    WHERE t.deleted_at IS NULL AND t.archived_at IS NULL
      AND (_user_id IS NULL OR t.user_id = _user_id)
    UNION ALL
    SELECT 'note'::text, n.id, n.user_id,
           public.semantic_note_text(n.title, n.content, n.tags), n.updated_at
    FROM public.notes n
    WHERE n.deleted_at IS NULL AND n.archived_at IS NULL
      AND (_user_id IS NULL OR n.user_id = _user_id)
  )
  SELECT s.kind, s.id, s.owner, s.txt, md5(s.txt)
  FROM src s
  LEFT JOIN public.semantic_documents d ON d.entity_type = s.kind AND d.entity_id = s.id
  WHERE s.txt <> ''
    AND (d.id IS NULL OR d.embedding IS NULL OR d.model IS DISTINCT FROM _model
         OR d.content_hash IS DISTINCT FROM md5(s.txt))
  ORDER BY s.ts DESC, s.id
  LIMIT least(greatest(coalesce(_limit, 50), 1), 500);
END $$;

-- 5. Writes ---------------------------------------------------------------------------------------

-- `_docs`: jsonb array (max 100) of {entity_type, entity_id, content_hash, embedding} where
-- embedding is a pgvector literal '[x,y,...]' with 1536 values. Returns the number of rows
-- stored. A row is skipped when it no longer exists, is trashed, the caller cannot access it, or
-- its text changed since `semantic_pending` (hash mismatch). SECURITY DEFINER because
-- authenticated has no write grant on the table; access is re-checked per row.
CREATE OR REPLACE FUNCTION public.semantic_upsert(_model text, _docs jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE
  _uid uuid := (SELECT auth.uid());
  _claims text := nullif(current_setting('request.jwt.claims', true), '');
  _role text;
  _doc jsonb;
  _type text;
  _id uuid;
  _owner uuid;
  _project uuid;
  _body text;
  _n integer := 0;
BEGIN
  IF _model IS NULL OR char_length(_model) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'semantic_upsert: invalid model' USING ERRCODE = '22023';
  END IF;
  IF _docs IS NULL OR jsonb_typeof(_docs) <> 'array' OR jsonb_array_length(_docs) > 100 THEN
    RAISE EXCEPTION 'semantic_upsert: _docs must be an array of at most 100 documents'
      USING ERRCODE = '22023';
  END IF;
  IF _uid IS NULL THEN
    -- Only the service role (or a direct database session without a JWT) may write without a user.
    _role := coalesce(CASE WHEN _claims IS NOT NULL THEN _claims::jsonb ->> 'role' END, '');
    IF _role NOT IN ('', 'service_role') THEN
      RAISE EXCEPTION 'semantic_upsert: forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR _doc IN SELECT value FROM jsonb_array_elements(_docs) LOOP
    _type := _doc ->> 'entity_type';
    _id := nullif(_doc ->> 'entity_id', '')::uuid;
    _owner := NULL;
    _body := NULL;
    IF _type = 'task' THEN
      SELECT t.user_id, t.project_id, public.semantic_task_text(t.title, t.description, t.tags)
        INTO _owner, _project, _body
        FROM public.tasks t
        WHERE t.id = _id AND t.deleted_at IS NULL;
      IF _uid IS NOT NULL AND NOT public.can_access_task(_id, _uid) THEN
        CONTINUE;
      END IF;
    ELSIF _type = 'note' THEN
      SELECT n.user_id, n.project_id, public.semantic_note_text(n.title, n.content, n.tags)
        INTO _owner, _project, _body
        FROM public.notes n
        WHERE n.id = _id AND n.deleted_at IS NULL;
      IF _uid IS NOT NULL AND NOT public.can_access_note(_id) THEN
        CONTINUE;
      END IF;
    ELSE
      RAISE EXCEPTION 'semantic_upsert: unknown entity_type %', _type USING ERRCODE = '22023';
    END IF;
    IF _owner IS NULL OR _body IS NULL OR _body = '' OR md5(_body) IS DISTINCT FROM _doc ->> 'content_hash' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.semantic_documents AS d
      (user_id, entity_type, entity_id, project_id, search_text, embedding, model, content_hash, updated_at)
    VALUES
      (_owner, _type, _id, _project, _body, (_doc ->> 'embedding')::vector(1536), _model, md5(_body), now())
    ON CONFLICT (entity_type, entity_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          project_id = EXCLUDED.project_id,
          search_text = EXCLUDED.search_text,
          embedding = EXCLUDED.embedding,
          model = EXCLUDED.model,
          content_hash = EXCLUDED.content_hash,
          updated_at = now();
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- 6. Search ---------------------------------------------------------------------------------------

-- Nearest live tasks/notes for `_query_embedding` among documents of `_model`, limited to what
-- the caller may read (SECURITY INVOKER: RLS on semantic_documents, tasks and notes). The HNSW
-- scan is iterative (pgvector 0.8 `relaxed_order`) so RLS filtering does not starve the result;
-- the outer query re-sorts by distance.
CREATE OR REPLACE FUNCTION public.match_semantic_documents(
  _query_embedding vector(1536),
  _model text,
  _limit integer DEFAULT 20,
  _min_similarity double precision DEFAULT 0
)
RETURNS TABLE(
  entity_type text,
  entity_id uuid,
  title text,
  snippet text,
  project_id uuid,
  similarity double precision
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
SET hnsw.iterative_scan = 'relaxed_order'
AS $$
  WITH hits AS (
    SELECT d.entity_type, d.entity_id, d.embedding <=> _query_embedding AS distance
    FROM public.semantic_documents d
    WHERE d.model = _model AND d.embedding IS NOT NULL
    ORDER BY d.embedding <=> _query_embedding
    LIMIT least(greatest(coalesce(_limit, 20), 1), 50) * 3
  )
  SELECT h.entity_type,
         h.entity_id,
         coalesce(t.title, n.title),
         CASE WHEN t.id IS NOT NULL THEN left(coalesce(t.description, ''), 160) ELSE n.excerpt END,
         coalesce(t.project_id, n.project_id),
         1 - h.distance
  FROM hits h
  LEFT JOIN public.tasks t
    ON h.entity_type = 'task' AND t.id = h.entity_id AND t.deleted_at IS NULL AND t.archived_at IS NULL
  LEFT JOIN public.notes n
    ON h.entity_type = 'note' AND n.id = h.entity_id AND n.deleted_at IS NULL AND n.archived_at IS NULL
  WHERE (t.id IS NOT NULL OR n.id IS NOT NULL)
    AND 1 - h.distance >= coalesce(_min_similarity, 0)
  ORDER BY h.distance
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50)
$$;

-- 7. Cleanup on hard delete ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.semantic_documents_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.semantic_documents d
  WHERE d.entity_type = TG_ARGV[0] AND d.entity_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS semantic_documents_cleanup ON public.tasks;
CREATE TRIGGER semantic_documents_cleanup AFTER DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.semantic_documents_cleanup('task');
DROP TRIGGER IF EXISTS semantic_documents_cleanup ON public.notes;
CREATE TRIGGER semantic_documents_cleanup AFTER DELETE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.semantic_documents_cleanup('note');

-- 8. Grants ---------------------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.semantic_pending(text, integer, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.semantic_upsert(text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.match_semantic_documents(vector, text, integer, double precision) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.semantic_documents_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.semantic_pending(text, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.semantic_upsert(text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_semantic_documents(vector, text, integer, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.semantic_task_text(text, text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.semantic_note_text(text, text, text[]) TO authenticated, service_role;

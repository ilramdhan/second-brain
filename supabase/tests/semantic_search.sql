-- Checks for migration 0020 (semantic search: semantic_pending, semantic_upsert,
-- match_semantic_documents, read-only RLS on semantic_documents, cleanup on hard delete).
--
-- Run with psql (it uses \ir to re-apply the migration, which also checks it is idempotent) as a
-- superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/semantic_search.sql
-- Everything runs in one transaction that is rolled back; success ends with
-- "semantic_search: all checks passed".

BEGIN;

\ir ../../drizzle/migrations/0020_semantic_search.sql

CREATE FUNCTION pg_temp.login(_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', _uid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
CREATE FUNCTION pg_temp.logout() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('role', 'postgres', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '', true);
$$;
-- One-hot 1536-d vector literal (1 at position _i), so cosine similarity is exactly 0 or 1.
CREATE FUNCTION pg_temp.vec(_i integer) RETURNS text LANGUAGE sql AS $$
  SELECT '[' || string_agg(CASE WHEN g = _i THEN '1' ELSE '0' END, ',' ORDER BY g) || ']'
  FROM generate_series(1, 1536) g
$$;
GRANT EXECUTE ON FUNCTION pg_temp.vec(integer) TO authenticated;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000e5a1', 'sem-owner@example.test'),
  ('00000000-0000-0000-0000-00000000e5b2', 'sem-member@example.test'),
  ('00000000-0000-0000-0000-00000000e5c3', 'sem-stranger@example.test');

INSERT INTO public.projects (id, user_id, name) VALUES
  ('50000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e5a1', 'Shared');
INSERT INTO public.project_members (project_id, user_id) VALUES
  ('50000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e5b2');

INSERT INTO public.tasks (id, user_id, project_id, title, description, tags) VALUES
  ('51000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e5a1', NULL,
   'Private task', 'only the owner', ARRAY['x']),
  ('51000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000e5a1',
   '50000000-0000-0000-0000-0000000000a1', 'Shared task', 'team work', '{}'),
  ('51000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000e5c3', NULL,
   'Stranger task', NULL, '{}');
INSERT INTO public.tasks (id, user_id, title, archived_at) VALUES
  ('51000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000e5a1', 'Archived', now());
INSERT INTO public.notes (id, user_id, project_id, title, content, excerpt) VALUES
  ('52000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e5a1',
   '50000000-0000-0000-0000-0000000000a1', 'Shared note', E'Body ^blkid001\nmore', 'Body'),
  ('52000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000e5a1', NULL, '', '', '');

DO $$
DECLARE
  _n integer;
  _txt text;
BEGIN
  -- Text builders.
  IF public.semantic_task_text('  T ', 'desc', ARRAY['a', 'b']) <> E'T\na b\ndesc' THEN
    RAISE EXCEPTION 'FAIL semantic_task_text';
  END IF;
  IF public.semantic_note_text('N', E'Line ^abcdef12\nnext', '{}') <> E'N\nLine\nnext' THEN
    RAISE EXCEPTION 'FAIL semantic_note_text strips block ids: %', public.semantic_note_text('N', E'Line ^abcdef12\nnext', '{}');
  END IF;
  IF to_regprocedure('public.search_semantic_documents(vector,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL old definer RPC still exists';
  END IF;

  -- Owner: sees own + shared rows; archived, empty and the stranger's rows are not pending.
  PERFORM pg_temp.login('00000000-0000-0000-0000-00000000e5a1');
  SELECT count(*) INTO _n FROM public.semantic_pending('m1', 50, NULL);
  IF _n <> 3 THEN RAISE EXCEPTION 'FAIL owner pending = % (want 3)', _n; END IF;
  BEGIN
    PERFORM * FROM public.semantic_pending('m1', 50, '00000000-0000-0000-0000-00000000e5c3');
    RAISE EXCEPTION 'FAIL pending for another user allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Direct writes are refused; semantic_upsert stores rows with matching hashes only.
  BEGIN
    INSERT INTO public.semantic_documents (user_id, entity_type, entity_id)
    VALUES ('00000000-0000-0000-0000-00000000e5a1', 'task', '51000000-0000-0000-0000-0000000000a1');
    RAISE EXCEPTION 'FAIL direct insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT public.semantic_upsert('m1', jsonb_agg(jsonb_build_object(
    'entity_type', p.entity_type, 'entity_id', p.entity_id, 'content_hash', p.content_hash,
    'embedding', pg_temp.vec(CASE p.entity_id
      WHEN '51000000-0000-0000-0000-0000000000a1' THEN 1
      WHEN '51000000-0000-0000-0000-0000000000a2' THEN 2 ELSE 3 END))))
  INTO _n FROM public.semantic_pending('m1', 50, NULL) p;
  IF _n <> 3 THEN RAISE EXCEPTION 'FAIL upsert stored % (want 3)', _n; END IF;
  SELECT count(*) INTO _n FROM public.semantic_pending('m1', 50, NULL);
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL still pending after upsert: %', _n; END IF;
  -- Another model makes everything pending again.
  SELECT count(*) INTO _n FROM public.semantic_pending('m2', 50, NULL);
  IF _n <> 3 THEN RAISE EXCEPTION 'FAIL model change not pending: %', _n; END IF;

  -- Stale hash and inaccessible rows are skipped.
  SELECT public.semantic_upsert('m1', jsonb_build_array(
    jsonb_build_object('entity_type', 'task', 'entity_id', '51000000-0000-0000-0000-0000000000a1',
      'content_hash', 'stale', 'embedding', pg_temp.vec(9)),
    jsonb_build_object('entity_type', 'task', 'entity_id', '51000000-0000-0000-0000-0000000000c1',
      'content_hash', md5('Stranger task'), 'embedding', pg_temp.vec(9)))) INTO _n;
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL stale/foreign rows stored: %', _n; END IF;

  -- Search: nearest first, model-scoped.
  SELECT title INTO _txt FROM public.match_semantic_documents(pg_temp.vec(2)::vector, 'm1', 5, 0) LIMIT 1;
  IF _txt IS DISTINCT FROM 'Shared task' THEN RAISE EXCEPTION 'FAIL top hit %', _txt; END IF;
  SELECT count(*) INTO _n FROM public.match_semantic_documents(pg_temp.vec(2)::vector, 'm1', 5, 0.5);
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL min_similarity filter: %', _n; END IF;
  SELECT count(*) INTO _n FROM public.match_semantic_documents(pg_temp.vec(2)::vector, 'other', 5, 0);
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL other model matched: %', _n; END IF;

  -- Editing a task makes it pending again (hash changes).
  UPDATE public.tasks SET title = 'Private task v2' WHERE id = '51000000-0000-0000-0000-0000000000a1';
  SELECT count(*) INTO _n FROM public.semantic_pending('m1', 50, NULL);
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL edit not pending: %', _n; END IF;

  -- Member: sees shared task + shared note only, never the owner's private task.
  PERFORM pg_temp.login('00000000-0000-0000-0000-00000000e5b2');
  SELECT count(*) INTO _n FROM public.match_semantic_documents(pg_temp.vec(1)::vector, 'm1', 10, 0);
  IF _n <> 2 THEN RAISE EXCEPTION 'FAIL member hits = % (want 2)', _n; END IF;
  IF EXISTS (SELECT 1 FROM public.match_semantic_documents(pg_temp.vec(1)::vector, 'm1', 10, 0)
             WHERE entity_id = '51000000-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'FAIL member sees private task';
  END IF;
  SELECT count(*) INTO _n FROM public.semantic_documents;
  IF _n <> 2 THEN RAISE EXCEPTION 'FAIL member reads % documents', _n; END IF;

  -- Stranger: nothing.
  PERFORM pg_temp.login('00000000-0000-0000-0000-00000000e5c3');
  SELECT count(*) INTO _n FROM public.match_semantic_documents(pg_temp.vec(2)::vector, 'm1', 10, 0);
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL stranger hits = %', _n; END IF;
  -- Writing someone else's row through the RPC is skipped.
  SELECT public.semantic_upsert('m1', jsonb_build_array(jsonb_build_object(
    'entity_type', 'task', 'entity_id', '51000000-0000-0000-0000-0000000000a2',
    'content_hash', md5(public.semantic_task_text('Shared task', 'team work', '{}')),
    'embedding', pg_temp.vec(7)))) INTO _n;
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL stranger overwrote a document'; END IF;
  PERFORM pg_temp.logout();

  -- Trashed rows disappear from results; hard delete removes the document.
  UPDATE public.tasks SET deleted_at = now() WHERE id = '51000000-0000-0000-0000-0000000000a2';
  PERFORM pg_temp.login('00000000-0000-0000-0000-00000000e5a1');
  IF EXISTS (SELECT 1 FROM public.match_semantic_documents(pg_temp.vec(2)::vector, 'm1', 10, 0)
             WHERE entity_id = '51000000-0000-0000-0000-0000000000a2') THEN
    RAISE EXCEPTION 'FAIL trashed task matched';
  END IF;
  PERFORM pg_temp.logout();
  DELETE FROM public.tasks WHERE id = '51000000-0000-0000-0000-0000000000a2';
  IF EXISTS (SELECT 1 FROM public.semantic_documents WHERE entity_id = '51000000-0000-0000-0000-0000000000a2') THEN
    RAISE EXCEPTION 'FAIL document not removed on hard delete';
  END IF;

  -- Service role (no auth.uid()): may scope pending to a user, or list everyone.
  SELECT count(*) INTO _n FROM public.semantic_pending('m1', 50, '00000000-0000-0000-0000-00000000e5c3');
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL service pending for one user: %', _n; END IF;
  SELECT public.semantic_upsert('m1', jsonb_build_array(jsonb_build_object(
    'entity_type', 'task', 'entity_id', '51000000-0000-0000-0000-0000000000c1',
    'content_hash', md5('Stranger task'), 'embedding', pg_temp.vec(5)))) INTO _n;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL service upsert: %', _n; END IF;
  IF (SELECT user_id FROM public.semantic_documents WHERE entity_id = '51000000-0000-0000-0000-0000000000c1')
     <> '00000000-0000-0000-0000-00000000e5c3' THEN
    RAISE EXCEPTION 'FAIL document owner is not the entity owner';
  END IF;

  -- Input validation.
  BEGIN
    PERFORM public.semantic_upsert('m1', (SELECT jsonb_agg(g) FROM generate_series(1, 101) g));
    RAISE EXCEPTION 'FAIL oversized batch accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- The search plan can use the HNSW index.
  IF to_regclass('public.semantic_documents_embedding_idx') IS NULL THEN
    RAISE EXCEPTION 'FAIL HNSW index missing';
  END IF;

  RAISE NOTICE 'semantic_search: all checks passed';
END $$;

ROLLBACK;

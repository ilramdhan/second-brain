CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS estimate_minutes integer NOT NULL DEFAULT 25;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS time_block_end timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS google_event_id text;

CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.activity_logs TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_logs_owner_select ON public.activity_logs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE INDEX activity_logs_user_created_idx ON public.activity_logs(user_id, created_at DESC);
CREATE INDEX activity_logs_entity_idx ON public.activity_logs(entity_type, entity_id);

CREATE OR REPLACE FUNCTION public.log_activity(
  _action text,
  _entity_type text,
  _entity_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _source text DEFAULT 'app'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  INSERT INTO public.activity_logs(user_id, action, entity_type, entity_id, metadata, source)
  VALUES (auth.uid(), left(_action, 80), left(_entity_type, 80), _entity_id, COALESCE(_metadata, '{}'::jsonb) - 'content' - 'description' - 'blocks' - 'connection_key', left(_source, 40))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_activity(text,text,uuid,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _row jsonb; _entity_id uuid; _owner uuid; _metadata jsonb;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  _entity_id := CASE WHEN (_row->>'id') ~* '^[0-9a-f-]{36}$' THEN (_row->>'id')::uuid ELSE NULL END;
  _owner := auth.uid();
  IF _owner IS NULL AND (_row->>'user_id') ~* '^[0-9a-f-]{36}$' THEN _owner := (_row->>'user_id')::uuid; END IF;
  _metadata := jsonb_build_object('table', TG_TABLE_NAME);
  IF TG_OP = 'UPDATE' THEN
    _metadata := _metadata || jsonb_build_object('changed_fields', (
      SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
      FROM jsonb_object_keys(to_jsonb(NEW)) k
      WHERE to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k
        AND k NOT IN ('content','description','blocks','connection_key_ciphertext')
    ));
  END IF;
  INSERT INTO public.activity_logs(user_id, action, entity_type, entity_id, metadata, source)
  VALUES (_owner, lower(TG_OP), TG_TABLE_NAME, _entity_id, _metadata, 'database');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TABLE public.note_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  version_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.note_versions TO authenticated;
GRANT ALL ON public.note_versions TO service_role;
ALTER TABLE public.note_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_versions_access ON public.note_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.notes n WHERE n.id = note_id AND (n.user_id = auth.uid() OR public.is_project_member(n.project_id, auth.uid()))));
CREATE POLICY note_versions_insert ON public.note_versions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.notes n WHERE n.id = note_id AND (n.user_id = auth.uid() OR public.is_project_member(n.project_id, auth.uid()))));
CREATE POLICY note_versions_delete ON public.note_versions FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX note_versions_note_created_idx ON public.note_versions(note_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.snapshot_note_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _next integer;
BEGIN
  IF OLD.title IS NOT DISTINCT FROM NEW.title AND OLD.content IS NOT DISTINCT FROM NEW.content AND OLD.blocks IS NOT DISTINCT FROM NEW.blocks THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.note_versions WHERE note_id = OLD.id AND created_at > now() - interval '10 minutes') THEN
    SELECT COALESCE(max(version_number), 0) + 1 INTO _next FROM public.note_versions WHERE note_id = OLD.id;
    INSERT INTO public.note_versions(note_id,user_id,title,content,blocks,version_number)
    VALUES (OLD.id, COALESCE(auth.uid(), OLD.user_id), OLD.title, OLD.content, OLD.blocks, _next);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notes_snapshot_before_update BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.snapshot_note_change();

CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'focus',
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT ALL ON public.time_entries TO service_role;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY time_entries_owner ON public.time_entries FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX time_entries_user_started_idx ON public.time_entries(user_id, started_at DESC);

CREATE TABLE public.canvas_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled canvas',
  viewport jsonb NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canvas_boards TO authenticated;
GRANT ALL ON public.canvas_boards TO service_role;
ALTER TABLE public.canvas_boards ENABLE ROW LEVEL SECURITY;
CREATE POLICY canvas_boards_access ON public.canvas_boards FOR ALL TO authenticated USING (user_id = auth.uid() OR public.is_project_member(project_id, auth.uid())) WITH CHECK (user_id = auth.uid() OR public.is_project_member(project_id, auth.uid()));

CREATE TABLE public.canvas_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.canvas_boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  node_type text NOT NULL DEFAULT 'text',
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  ref_type text,
  ref_id uuid,
  url text,
  x double precision NOT NULL DEFAULT 0,
  y double precision NOT NULL DEFAULT 0,
  width double precision NOT NULL DEFAULT 280,
  height double precision NOT NULL DEFAULT 180,
  color text NOT NULL DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canvas_nodes TO authenticated;
GRANT ALL ON public.canvas_nodes TO service_role;
ALTER TABLE public.canvas_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY canvas_nodes_access ON public.canvas_nodes FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.canvas_boards b WHERE b.id = board_id AND (b.user_id = auth.uid() OR public.is_project_member(b.project_id, auth.uid())))) WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.canvas_boards b WHERE b.id = board_id AND (b.user_id = auth.uid() OR public.is_project_member(b.project_id, auth.uid()))));

CREATE TABLE public.canvas_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.canvas_boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES public.canvas_nodes(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.canvas_nodes(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canvas_edges TO authenticated;
GRANT ALL ON public.canvas_edges TO service_role;
ALTER TABLE public.canvas_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY canvas_edges_access ON public.canvas_edges FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.canvas_boards b WHERE b.id = board_id AND (b.user_id = auth.uid() OR public.is_project_member(b.project_id, auth.uid())))) WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.canvas_boards b WHERE b.id = board_id AND (b.user_id = auth.uid() OR public.is_project_member(b.project_id, auth.uid()))));

CREATE TABLE public.calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  calendar_id text NOT NULL DEFAULT 'primary',
  sync_enabled boolean NOT NULL DEFAULT true,
  reconnect_required boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_connections TO authenticated;
GRANT ALL ON public.calendar_connections TO service_role;
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_connections_owner ON public.calendar_connections FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.app_user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connector_id text NOT NULL,
  connection_key_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, connector_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_connections TO service_role;
ALTER TABLE public.app_user_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.semantic_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  project_id uuid,
  search_text text NOT NULL DEFAULT '',
  embedding vector(1536),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, entity_type, entity_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.semantic_documents TO authenticated;
GRANT ALL ON public.semantic_documents TO service_role;
ALTER TABLE public.semantic_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY semantic_documents_owner ON public.semantic_documents FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX semantic_documents_embedding_idx ON public.semantic_documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX semantic_documents_text_idx ON public.semantic_documents USING gin (to_tsvector('simple', search_text));

CREATE OR REPLACE FUNCTION public.search_semantic_documents(_query_embedding vector(1536), _limit integer DEFAULT 20)
RETURNS TABLE(entity_type text, entity_id uuid, search_text text, similarity double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
 SELECT d.entity_type, d.entity_id, d.search_text, 1 - (d.embedding <=> _query_embedding) AS similarity
 FROM public.semantic_documents d
 WHERE d.user_id = auth.uid() AND d.embedding IS NOT NULL
 ORDER BY d.embedding <=> _query_embedding LIMIT LEAST(_limit, 50)
$$;
GRANT EXECUTE ON FUNCTION public.search_semantic_documents(vector,integer) TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','inbox_items','tasks','notes','milestones','project_invites','project_members','task_comments','task_dependencies','automations','time_entries','canvas_boards','canvas_nodes','canvas_edges','calendar_connections']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t, t);
  END LOOP;
END $$;
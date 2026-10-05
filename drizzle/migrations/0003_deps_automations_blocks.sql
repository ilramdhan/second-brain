CREATE TABLE public.task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  blocker_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_dependencies TO authenticated;
GRANT ALL ON public.task_dependencies TO service_role;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY deps_select ON public.task_dependencies FOR SELECT TO authenticated
  USING (public.can_access_task(blocker_id, auth.uid()) OR public.can_access_task(blocked_id, auth.uid()));
CREATE POLICY deps_insert ON public.task_dependencies FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_task(blocker_id, auth.uid()) AND public.can_access_task(blocked_id, auth.uid()));
CREATE POLICY deps_delete ON public.task_dependencies FOR DELETE TO authenticated
  USING (public.can_access_task(blocker_id, auth.uid()) AND public.can_access_task(blocked_id, auth.uid()));

CREATE TABLE public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  trigger jsonb NOT NULL DEFAULT '{}'::jsonb,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_count integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT ALL ON public.automations TO service_role;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY automations_owner ON public.automations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  automation_id uuid REFERENCES public.automations(id) ON DELETE CASCADE,
  task_id uuid,
  ok boolean NOT NULL DEFAULT true,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.automation_runs TO authenticated;
GRANT ALL ON public.automation_runs TO service_role;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY runs_owner ON public.automation_runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.notes ADD COLUMN blocks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.notes ADD COLUMN properties jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.notes n SET blocks = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id', substr(md5(random()::text || n.id::text || l.ord), 1, 8), 'type', 'p', 'text', l.line) ORDER BY l.ord)
  FROM regexp_split_to_table(n.content, E'\n') WITH ORDINALITY AS l(line, ord)
  WHERE btrim(l.line) <> ''
), '[]'::jsonb)
WHERE n.blocks = '[]'::jsonb AND btrim(n.content) <> '';
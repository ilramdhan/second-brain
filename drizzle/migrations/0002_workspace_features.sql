-- Projects extensions
ALTER TABLE public.projects
  ADD COLUMN description text,
  ADD COLUMN color text NOT NULL DEFAULT 'teal',
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN start_date date,
  ADD COLUMN due_date date,
  ADD COLUMN launch_date date,
  ADD COLUMN parent_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN position double precision NOT NULL DEFAULT 0,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Milestones
CREATE TABLE public.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  due_date date,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.milestones TO authenticated;
GRANT ALL ON public.milestones TO service_role;

-- Tasks extensions
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo','in_progress','review','done'));
ALTER TABLE public.tasks
  ADD COLUMN start_date timestamptz,
  ADD COLUMN parent_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  ADD COLUMN milestone_id uuid REFERENCES public.milestones(id) ON DELETE SET NULL,
  ADD COLUMN assignee_id uuid,
  ADD COLUMN assignee_name text,
  ADD COLUMN recurrence text,
  ADD COLUMN position double precision NOT NULL DEFAULT 0,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Notes extensions
ALTER TABLE public.notes
  ADD COLUMN status text NOT NULL DEFAULT 'idea',
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN position double precision NOT NULL DEFAULT 0,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Team
CREATE TABLE public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;

CREATE TABLE public.project_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);
GRANT SELECT, INSERT, DELETE ON public.project_invites TO authenticated;
GRANT ALL ON public.project_invites TO service_role;

-- Comments
CREATE TABLE public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;

-- Helpers
CREATE OR REPLACE FUNCTION public.is_project_owner(_project_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(_project_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _project_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND user_id = _user_id)
    OR EXISTS (SELECT 1 FROM public.project_members WHERE project_id = _project_id AND user_id = _user_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_task(_task_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = _task_id
      AND (t.user_id = _user_id OR public.is_project_member(t.project_id, _user_id))
  )
$$;

CREATE OR REPLACE FUNCTION public.accept_project_invites()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _email text; _n integer;
BEGIN
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid();
  IF _email IS NULL THEN RETURN 0; END IF;
  INSERT INTO public.project_members (project_id, user_id)
    SELECT project_id, auth.uid() FROM public.project_invites WHERE lower(email) = _email
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  DELETE FROM public.project_invites WHERE lower(email) = _email;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.list_project_people(_project_id uuid)
RETURNS TABLE(user_id uuid, display_name text, email text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.user_id, pr.display_name, u.email::text, 'owner'::text
    FROM public.projects p JOIN auth.users u ON u.id = p.user_id
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
    WHERE p.id = _project_id AND public.is_project_member(_project_id, auth.uid())
  UNION ALL
  SELECT m.user_id, pr.display_name, u.email::text, m.role
    FROM public.project_members m JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN public.profiles pr ON pr.id = m.user_id
    WHERE m.project_id = _project_id AND public.is_project_member(_project_id, auth.uid())
$$;

REVOKE EXECUTE ON FUNCTION public.accept_project_invites() FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_project_people(uuid) FROM anon;

-- RLS
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_member_select ON public.projects FOR SELECT TO authenticated
  USING (public.is_project_member(id, auth.uid()));
CREATE POLICY projects_member_update ON public.projects FOR UPDATE TO authenticated
  USING (public.is_project_member(id, auth.uid())) WITH CHECK (public.is_project_member(id, auth.uid()));

CREATE POLICY tasks_member_all ON public.tasks FOR ALL TO authenticated
  USING (public.is_project_member(project_id, auth.uid()))
  WITH CHECK (public.is_project_member(project_id, auth.uid()));

CREATE POLICY notes_member_all ON public.notes FOR ALL TO authenticated
  USING (public.is_project_member(project_id, auth.uid()))
  WITH CHECK (public.is_project_member(project_id, auth.uid()));

CREATE POLICY milestones_access ON public.milestones FOR ALL TO authenticated
  USING (public.is_project_member(project_id, auth.uid()))
  WITH CHECK (public.is_project_member(project_id, auth.uid()));

CREATE POLICY members_select ON public.project_members FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));
CREATE POLICY members_owner_manage ON public.project_members FOR ALL TO authenticated
  USING (public.is_project_owner(project_id, auth.uid()))
  WITH CHECK (public.is_project_owner(project_id, auth.uid()));
CREATE POLICY members_leave ON public.project_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY invites_owner_manage ON public.project_invites FOR ALL TO authenticated
  USING (public.is_project_owner(project_id, auth.uid()))
  WITH CHECK (public.is_project_owner(project_id, auth.uid()) AND invited_by = auth.uid());

CREATE POLICY comments_select ON public.task_comments FOR SELECT TO authenticated
  USING (public.can_access_task(task_id, auth.uid()));
CREATE POLICY comments_insert ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_task(task_id, auth.uid()));
CREATE POLICY comments_delete ON public.task_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());
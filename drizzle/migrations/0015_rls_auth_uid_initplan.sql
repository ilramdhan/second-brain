-- RLS: evaluate auth.uid() once per statement (plan item 2.3, ANALYSIS §2.11).
--
-- A bare `auth.uid()` in a policy is evaluated for every row. Wrapped in a scalar sub-select,
-- `(SELECT auth.uid())`, the planner turns it into an InitPlan that runs once per query, and
-- `user_id = $0` can then use the user_id indexes from 0014. Migration 0010 already did this for
-- projects, tasks, notes, milestones and canvas; this migration rewrites every remaining policy.
--
-- Each policy is dropped and recreated with the same name, command, role and logic; only
-- `auth.uid()` becomes `(SELECT auth.uid())`. The 0010 per-operation rules are untouched.
-- The membership helpers stay STABLE SECURITY DEFINER (re-asserted below) and never recurse
-- through RLS.
--
-- List queries: `is_project_member(project_id, uid)` in a SELECT policy still runs once per row
-- (it is a function of the row), so `select * from tasks` scanned the whole table and called it
-- ~40 000 times on the perf fixture (docs/perf-baseline.md §4). The new STABLE helper
-- `my_project_ids()` returns the caller's projects (owned + member) once per statement, and the
-- member-visible SELECT/UPDATE policies of tasks, notes, milestones, canvas boards and projects
-- use `project_id = ANY (ARRAY(SELECT public.my_project_ids()))` instead. This is equivalent to
-- `is_project_member(project_id, uid)`: same two sources, and a NULL project_id never matches.
-- INSERT checks, trash/delete rules (is_project_owner) and the 0010 guard triggers are unchanged.

-- Set of project ids the caller may access (owner or member), evaluated once per statement ------

CREATE OR REPLACE FUNCTION public.my_project_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id FROM public.projects p WHERE p.user_id = (SELECT auth.uid())
  UNION
  SELECT m.project_id FROM public.project_members m WHERE m.user_id = (SELECT auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION public.my_project_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_project_ids() TO authenticated, service_role;

-- Member-visible policies from 0010 (same rules, set-based membership check) -----------------

DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR id = ANY (ARRAY(SELECT public.my_project_ids())));

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR project_id = ANY (ARRAY(SELECT public.my_project_ids())));
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR project_id = ANY (ARRAY(SELECT public.my_project_ids())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR project_id = ANY (ARRAY(SELECT public.my_project_ids())));

DROP POLICY IF EXISTS notes_select ON public.notes;
CREATE POLICY notes_select ON public.notes FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR project_id = ANY (ARRAY(SELECT public.my_project_ids())));
DROP POLICY IF EXISTS notes_update ON public.notes;
CREATE POLICY notes_update ON public.notes FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR project_id = ANY (ARRAY(SELECT public.my_project_ids())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR project_id = ANY (ARRAY(SELECT public.my_project_ids())));

DROP POLICY IF EXISTS milestones_select ON public.milestones;
CREATE POLICY milestones_select ON public.milestones FOR SELECT TO authenticated
  USING (project_id = ANY (ARRAY(SELECT public.my_project_ids())));
DROP POLICY IF EXISTS milestones_update ON public.milestones;
CREATE POLICY milestones_update ON public.milestones FOR UPDATE TO authenticated
  USING (project_id = ANY (ARRAY(SELECT public.my_project_ids())))
  WITH CHECK (project_id = ANY (ARRAY(SELECT public.my_project_ids())));

DROP POLICY IF EXISTS canvas_boards_select ON public.canvas_boards;
CREATE POLICY canvas_boards_select ON public.canvas_boards FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR project_id = ANY (ARRAY(SELECT public.my_project_ids())));
DROP POLICY IF EXISTS canvas_boards_update ON public.canvas_boards;
CREATE POLICY canvas_boards_update ON public.canvas_boards FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR project_id = ANY (ARRAY(SELECT public.my_project_ids())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR project_id = ANY (ARRAY(SELECT public.my_project_ids())));

-- Owner-only tables (FOR ALL, `user_id` = caller) --------------------------------------------

DROP POLICY IF EXISTS profiles_owner ON public.profiles;
CREATE POLICY profiles_owner ON public.profiles FOR ALL TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS inbox_owner ON public.inbox_items;
CREATE POLICY inbox_owner ON public.inbox_items FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS automations_owner ON public.automations;
CREATE POLICY automations_owner ON public.automations FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS runs_owner ON public.automation_runs;
CREATE POLICY runs_owner ON public.automation_runs FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS time_entries_owner ON public.time_entries;
CREATE POLICY time_entries_owner ON public.time_entries FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS calendar_connections_owner ON public.calendar_connections;
CREATE POLICY calendar_connections_owner ON public.calendar_connections FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS semantic_documents_owner ON public.semantic_documents;
CREATE POLICY semantic_documents_owner ON public.semantic_documents FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Own templates" ON public.templates;
CREATE POLICY "Own templates" ON public.templates FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS activity_logs_owner_select ON public.activity_logs;
CREATE POLICY activity_logs_owner_select ON public.activity_logs FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS telegram_link_codes_select_own ON public.telegram_link_codes;
CREATE POLICY telegram_link_codes_select_own ON public.telegram_link_codes FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS telegram_link_codes_insert_own ON public.telegram_link_codes;
CREATE POLICY telegram_link_codes_insert_own ON public.telegram_link_codes FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Team tables ----------------------------------------------------------------------------------

DROP POLICY IF EXISTS members_select ON public.project_members;
CREATE POLICY members_select ON public.project_members FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, (SELECT auth.uid())));
DROP POLICY IF EXISTS members_owner_manage ON public.project_members;
CREATE POLICY members_owner_manage ON public.project_members FOR ALL TO authenticated
  USING (public.is_project_owner(project_id, (SELECT auth.uid())))
  WITH CHECK (public.is_project_owner(project_id, (SELECT auth.uid())));
DROP POLICY IF EXISTS members_leave ON public.project_members;
CREATE POLICY members_leave ON public.project_members FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS invites_owner_manage ON public.project_invites;
CREATE POLICY invites_owner_manage ON public.project_invites FOR ALL TO authenticated
  USING (public.is_project_owner(project_id, (SELECT auth.uid())))
  WITH CHECK (public.is_project_owner(project_id, (SELECT auth.uid())) AND invited_by = (SELECT auth.uid()));

-- Task children --------------------------------------------------------------------------------

DROP POLICY IF EXISTS comments_select ON public.task_comments;
CREATE POLICY comments_select ON public.task_comments FOR SELECT TO authenticated
  USING (public.can_access_task(task_id, (SELECT auth.uid())));
DROP POLICY IF EXISTS comments_insert ON public.task_comments;
CREATE POLICY comments_insert ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.can_access_task(task_id, (SELECT auth.uid())));
DROP POLICY IF EXISTS comments_delete ON public.task_comments;
CREATE POLICY comments_delete ON public.task_comments FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS deps_select ON public.task_dependencies;
CREATE POLICY deps_select ON public.task_dependencies FOR SELECT TO authenticated
  USING (public.can_access_task(blocker_id, (SELECT auth.uid()))
    OR public.can_access_task(blocked_id, (SELECT auth.uid())));
DROP POLICY IF EXISTS deps_insert ON public.task_dependencies;
CREATE POLICY deps_insert ON public.task_dependencies FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
    AND public.can_access_task(blocker_id, (SELECT auth.uid()))
    AND public.can_access_task(blocked_id, (SELECT auth.uid())));
DROP POLICY IF EXISTS deps_delete ON public.task_dependencies;
CREATE POLICY deps_delete ON public.task_dependencies FOR DELETE TO authenticated
  USING (public.can_access_task(blocker_id, (SELECT auth.uid()))
    AND public.can_access_task(blocked_id, (SELECT auth.uid())));

-- Note versions --------------------------------------------------------------------------------

DROP POLICY IF EXISTS note_versions_access ON public.note_versions;
CREATE POLICY note_versions_access ON public.note_versions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = note_id
      AND (n.user_id = (SELECT auth.uid()) OR public.is_project_member(n.project_id, (SELECT auth.uid())))
  ));
DROP POLICY IF EXISTS note_versions_insert ON public.note_versions;
CREATE POLICY note_versions_insert ON public.note_versions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = note_id
      AND (n.user_id = (SELECT auth.uid()) OR public.is_project_member(n.project_id, (SELECT auth.uid())))
  ));
DROP POLICY IF EXISTS note_versions_delete ON public.note_versions;
CREATE POLICY note_versions_delete ON public.note_versions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Helpers stay STABLE (no writes; same result for the same arguments within a statement) ------

ALTER FUNCTION public.is_project_owner(uuid, uuid) STABLE;
ALTER FUNCTION public.is_project_member(uuid, uuid) STABLE;
ALTER FUNCTION public.can_access_task(uuid, uuid) STABLE;
ALTER FUNCTION public.can_access_note(uuid) STABLE;
ALTER FUNCTION public.can_access_canvas_board(uuid) STABLE;
ALTER FUNCTION public.is_canvas_board_owner(uuid) STABLE;

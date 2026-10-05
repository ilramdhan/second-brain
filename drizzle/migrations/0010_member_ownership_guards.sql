-- Ownership and spoofing fixes for shared projects (ANALYSIS S4, S5, S15; plan item 1.4).
--
-- Before: `projects_member_update` let any member rewrite `projects.user_id` (take over the
-- project), and `tasks_member_all` / `notes_member_all` / `milestones_access` / canvas policies
-- were FOR ALL with only a project-membership check, so members could insert rows owned by
-- someone else, reassign `user_id`, and hard-delete or trash other people's rows.
--
-- Rules after this migration:
--   * `user_id` never changes on UPDATE for authenticated clients (trigger).
--   * Only the project owner may update or delete a project (members keep read access).
--   * Inserts must use `user_id = auth.uid()`; project-scoped inserts require membership.
--   * Members may update rows in shared projects (collaboration keeps working) but may only move
--     a row into a project they belong to.
--   * Trash/restore (changing `deleted_at`) and hard DELETE are limited to the row owner or the
--     project owner. Archiving stays open to members (it is reversible from /archive and never
--     leads to a purge).
--   * Canvas nodes/edges: members see every node on a board they can access, but only the
--     author updates or deletes a node/edge (the board owner may also delete).
-- The guards only apply to the `authenticated`/`anon` roles; service_role and migrations bypass.

-- Helpers ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_access_canvas_board(_board_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.canvas_boards b
    WHERE b.id = _board_id
      AND (b.user_id = (SELECT auth.uid()) OR public.is_project_member(b.project_id, (SELECT auth.uid())))
  )
$$;

CREATE OR REPLACE FUNCTION public.is_canvas_board_owner(_board_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.canvas_boards b
    WHERE b.id = _board_id
      AND (b.user_id = (SELECT auth.uid()) OR public.is_project_owner(b.project_id, (SELECT auth.uid())))
  )
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_canvas_board(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_canvas_board_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_canvas_board(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_canvas_board_owner(uuid) TO authenticated, service_role;

-- Triggers --------------------------------------------------------------------------------------

-- Rejects any change of `user_id` made by an end-user role.
CREATE OR REPLACE FUNCTION public.prevent_user_id_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id of % rows cannot be changed', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- For project-scoped rows (tasks, notes, canvas_boards): the target project must be one the user
-- belongs to, and trashing/restoring is reserved for the row owner or the project owner.
CREATE OR REPLACE FUNCTION public.guard_project_row_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id AND NEW.project_id IS NOT NULL
     AND NOT public.is_project_member(NEW.project_id, _uid) THEN
    RAISE EXCEPTION 'cannot move % row into a project you are not a member of', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) -> 'deleted_at') IS DISTINCT FROM (to_jsonb(OLD) -> 'deleted_at')
     AND OLD.user_id IS DISTINCT FROM _uid
     AND NOT public.is_project_owner(OLD.project_id, _uid) THEN
    RAISE EXCEPTION 'only the owner or the project owner can trash or restore this % row', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','tasks','notes','milestones','canvas_boards','canvas_nodes','canvas_edges','task_comments','task_dependencies']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_%I_user_id_immutable ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER a_%I_user_id_immutable BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_user_id_change()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['tasks','notes','canvas_boards']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_%I_guard_project_update ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER a_%I_guard_project_update BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_project_row_update()', t, t);
  END LOOP;
END
$$;

-- projects --------------------------------------------------------------------------------------

DROP POLICY IF EXISTS "projects_owner" ON public.projects;
DROP POLICY IF EXISTS projects_member_select ON public.projects;
DROP POLICY IF EXISTS projects_member_update ON public.projects;
DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
DROP POLICY IF EXISTS projects_delete ON public.projects;
CREATE POLICY projects_select ON public.projects FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_member(id, (SELECT auth.uid())));
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY projects_delete ON public.projects FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- tasks and notes (same shape) ------------------------------------------------------------------

DROP POLICY IF EXISTS "tasks_owner" ON public.tasks;
DROP POLICY IF EXISTS tasks_member_all ON public.tasks;
DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_select ON public.tasks FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_member(project_id, (SELECT auth.uid())));
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
    AND (project_id IS NULL OR public.is_project_member(project_id, (SELECT auth.uid()))));
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_member(project_id, (SELECT auth.uid())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_project_member(project_id, (SELECT auth.uid())));
CREATE POLICY tasks_delete ON public.tasks FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_owner(project_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "notes_owner" ON public.notes;
DROP POLICY IF EXISTS notes_member_all ON public.notes;
DROP POLICY IF EXISTS notes_select ON public.notes;
DROP POLICY IF EXISTS notes_insert ON public.notes;
DROP POLICY IF EXISTS notes_update ON public.notes;
DROP POLICY IF EXISTS notes_delete ON public.notes;
CREATE POLICY notes_select ON public.notes FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_member(project_id, (SELECT auth.uid())));
CREATE POLICY notes_insert ON public.notes FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
    AND (project_id IS NULL OR public.is_project_member(project_id, (SELECT auth.uid()))));
CREATE POLICY notes_update ON public.notes FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_member(project_id, (SELECT auth.uid())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_project_member(project_id, (SELECT auth.uid())));
CREATE POLICY notes_delete ON public.notes FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_owner(project_id, (SELECT auth.uid())));

-- milestones (always project-scoped) ------------------------------------------------------------

DROP POLICY IF EXISTS milestones_access ON public.milestones;
DROP POLICY IF EXISTS milestones_select ON public.milestones;
DROP POLICY IF EXISTS milestones_insert ON public.milestones;
DROP POLICY IF EXISTS milestones_update ON public.milestones;
DROP POLICY IF EXISTS milestones_delete ON public.milestones;
CREATE POLICY milestones_select ON public.milestones FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, (SELECT auth.uid())));
CREATE POLICY milestones_insert ON public.milestones FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_project_member(project_id, (SELECT auth.uid())));
CREATE POLICY milestones_update ON public.milestones FOR UPDATE TO authenticated
  USING (public.is_project_member(project_id, (SELECT auth.uid())))
  WITH CHECK (public.is_project_member(project_id, (SELECT auth.uid())));
CREATE POLICY milestones_delete ON public.milestones FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_owner(project_id, (SELECT auth.uid())));

-- canvas ----------------------------------------------------------------------------------------

DROP POLICY IF EXISTS canvas_boards_access ON public.canvas_boards;
DROP POLICY IF EXISTS canvas_boards_select ON public.canvas_boards;
DROP POLICY IF EXISTS canvas_boards_insert ON public.canvas_boards;
DROP POLICY IF EXISTS canvas_boards_update ON public.canvas_boards;
DROP POLICY IF EXISTS canvas_boards_delete ON public.canvas_boards;
CREATE POLICY canvas_boards_select ON public.canvas_boards FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_member(project_id, (SELECT auth.uid())));
CREATE POLICY canvas_boards_insert ON public.canvas_boards FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
    AND (project_id IS NULL OR public.is_project_member(project_id, (SELECT auth.uid()))));
CREATE POLICY canvas_boards_update ON public.canvas_boards FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_member(project_id, (SELECT auth.uid())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_project_member(project_id, (SELECT auth.uid())));
CREATE POLICY canvas_boards_delete ON public.canvas_boards FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_project_owner(project_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS canvas_nodes_access ON public.canvas_nodes;
DROP POLICY IF EXISTS canvas_nodes_select ON public.canvas_nodes;
DROP POLICY IF EXISTS canvas_nodes_insert ON public.canvas_nodes;
DROP POLICY IF EXISTS canvas_nodes_update ON public.canvas_nodes;
DROP POLICY IF EXISTS canvas_nodes_delete ON public.canvas_nodes;
CREATE POLICY canvas_nodes_select ON public.canvas_nodes FOR SELECT TO authenticated
  USING (public.can_access_canvas_board(board_id));
CREATE POLICY canvas_nodes_insert ON public.canvas_nodes FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.can_access_canvas_board(board_id));
CREATE POLICY canvas_nodes_update ON public.canvas_nodes FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.can_access_canvas_board(board_id));
CREATE POLICY canvas_nodes_delete ON public.canvas_nodes FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_canvas_board_owner(board_id));

DROP POLICY IF EXISTS canvas_edges_access ON public.canvas_edges;
DROP POLICY IF EXISTS canvas_edges_select ON public.canvas_edges;
DROP POLICY IF EXISTS canvas_edges_insert ON public.canvas_edges;
DROP POLICY IF EXISTS canvas_edges_update ON public.canvas_edges;
DROP POLICY IF EXISTS canvas_edges_delete ON public.canvas_edges;
CREATE POLICY canvas_edges_select ON public.canvas_edges FOR SELECT TO authenticated
  USING (public.can_access_canvas_board(board_id));
CREATE POLICY canvas_edges_insert ON public.canvas_edges FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.can_access_canvas_board(board_id));
CREATE POLICY canvas_edges_update ON public.canvas_edges FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.can_access_canvas_board(board_id));
CREATE POLICY canvas_edges_delete ON public.canvas_edges FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_canvas_board_owner(board_id));

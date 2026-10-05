-- Referential and domain constraints (plan item 2.4, ANALYSIS §6.2).
--
-- 1. `user_id` (and `profiles.id`, `project_invites.invited_by`) reference auth.users ON DELETE
--    CASCADE, so deleting an account removes all of its data (GDPR) instead of leaving orphans.
--    Only `templates`, `telegram_link_codes`, `rate_limits` and `n8n_events` had this before.
--    `activity_logs` gets no FK: deleting a user cascades row deletes whose audit trigger runs
--    after the user row is gone, so a FK would block account deletion. Instead an AFTER DELETE
--    trigger on auth.users purges the user's existing log rows, and audit_row_change (0013)
--    does not log deletes for a user that no longer exists.
--    `tasks.assignee_id` → auth.users ON DELETE SET NULL (the task stays with its owner).
--    `automation_runs.task_id` → tasks ON DELETE SET NULL (run history outlives the task).
-- activity_logs cleanup on account deletion
CREATE OR REPLACE FUNCTION public.purge_deleted_user_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.activity_logs WHERE user_id = OLD.id;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_deleted_user_activity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_purge_activity_on_user_delete ON auth.users;
CREATE TRIGGER zz_purge_activity_on_user_delete AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.purge_deleted_user_activity();

-- 2. CHECK constraints for text enums, using the values the app writes (src/lib/constants.ts:
--    PROJECT_STATUS, NOTE_STATUS, RECURRENCE; project_members.role is only ever the default
--    'member', and list_project_people() reports the owner as 'owner'). tasks.status/priority,
--    projects.para_type and inbox_items.status/source already have CHECKs (0000/0002/0012).
--    `tasks.recurrence` stores NULL for "none" (TaskDialogProvider, nlp.ts).
--
-- Every constraint is added NOT VALID (no table scan under an exclusive lock; new and updated
-- rows are checked immediately) and then validated. If existing rows violate it, validation is
-- skipped with a NOTICE and the constraint stays NOT VALID, so the migration never fails on
-- legacy data. Find such rows with:
--   select conrelid::regclass, conname from pg_constraint where not convalidated;

CREATE OR REPLACE FUNCTION pg_temp.add_constraint(_table text, _name text, _definition text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || _table)::regclass AND conname = _name
  ) THEN
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s NOT VALID', _table, _name, _definition);
  END IF;
  BEGIN
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', _table, _name);
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN
    RAISE NOTICE 'constraint %.% left NOT VALID: existing rows violate it (%)', _table, _name, SQLERRM;
  END;
END;
$$;

-- 1. Foreign keys to auth.users ---------------------------------------------------------------

SELECT pg_temp.add_constraint('profiles', 'profiles_id_fkey',
  'FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE');

SELECT pg_temp.add_constraint(t, t || '_user_id_fkey',
  'FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE')
FROM unnest(ARRAY[
  'projects', 'inbox_items', 'tasks', 'notes', 'milestones', 'project_members', 'task_comments',
  'task_dependencies', 'automations', 'automation_runs', 'note_versions',
  'time_entries', 'canvas_boards', 'canvas_nodes', 'canvas_edges', 'calendar_connections',
  'app_user_connections', 'semantic_documents'
]) AS t;

SELECT pg_temp.add_constraint('project_invites', 'project_invites_invited_by_fkey',
  'FOREIGN KEY (invited_by) REFERENCES auth.users (id) ON DELETE CASCADE');
SELECT pg_temp.add_constraint('tasks', 'tasks_assignee_id_fkey',
  'FOREIGN KEY (assignee_id) REFERENCES auth.users (id) ON DELETE SET NULL');
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON public.tasks (assignee_id) WHERE assignee_id IS NOT NULL;
SELECT pg_temp.add_constraint('automation_runs', 'automation_runs_task_id_fkey',
  'FOREIGN KEY (task_id) REFERENCES public.tasks (id) ON DELETE SET NULL');

-- activity_logs cleanup on account deletion
CREATE OR REPLACE FUNCTION public.purge_deleted_user_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.activity_logs WHERE user_id = OLD.id;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_deleted_user_activity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_purge_activity_on_user_delete ON auth.users;
CREATE TRIGGER zz_purge_activity_on_user_delete AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.purge_deleted_user_activity();

-- 2. CHECK constraints ------------------------------------------------------------------------

SELECT pg_temp.add_constraint('projects', 'projects_status_check',
  $c$CHECK (status IN ('planning', 'active', 'on_hold', 'done'))$c$);
SELECT pg_temp.add_constraint('notes', 'notes_status_check',
  $c$CHECK (status IN ('idea', 'draft', 'final'))$c$);
SELECT pg_temp.add_constraint('project_members', 'project_members_role_check',
  $c$CHECK (role IN ('owner', 'member'))$c$);
SELECT pg_temp.add_constraint('tasks', 'tasks_recurrence_check',
  $c$CHECK (recurrence IS NULL OR recurrence IN ('daily', 'weekly', 'monthly'))$c$);

DROP FUNCTION pg_temp.add_constraint(text, text, text);

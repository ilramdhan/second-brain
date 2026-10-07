-- Phase 9.6: habit tracker (`public.habits` + `public.habit_logs`).
--
-- A habit belongs to one user and is private: habits are personal routines, so there is no
-- project-member sharing (`project_id` only groups a habit under one of the user's projects and
-- must be a project the user belongs to). A log is one calendar day of one habit (`date` is the
-- user's local day, chosen by the client) with a count; the habit is "done" that day when
-- `count >= habits.target`. One row per habit and day (unique), so a check-in is an upsert.
--
-- Schedules:
--   daily    every day;
--   weekdays the ISO weekdays in `weekdays_mask` (bit 0 = Monday ... bit 6 = Sunday);
--   weekly   `times_per_week` done days per ISO week, any day.
-- Streaks and completion rates are computed client-side (src/lib/habits.ts).
--
-- Like tasks and notes, habits are archived (`archived_at`) or trashed (`deleted_at`); /archive
-- restores them and the 30-day purge deletes them (logs cascade). `user_id` is immutable for end
-- users (0010's `prevent_user_id_change`), so is a log's `habit_id`. RLS is per operation with
-- `(SELECT auth.uid())`, plus the restrictive `mfa_aal2` policy (0022) and the demo row limits
-- (0019). Habit changes are audited; daily check-ins are not (they would flood the activity log).
-- Idempotent.

-- Applying to a live database: fail fast instead of queueing behind (and in front of) app
-- queries; a lock_timeout error only means "retry" (the file is idempotent). Plain SET, not SET
-- LOCAL: it lasts for the session, which also covers drizzle-kit running every pending file in
-- one transaction.
SET lock_timeout = '5s';

-- Create or replace a trigger only when it is missing or its definition differs (see 0024).
CREATE OR REPLACE FUNCTION pg_temp.ensure_trigger(_table regclass, _name name, _def text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $f$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid = _table AND t.tgname = _name AND pg_catalog.pg_get_triggerdef(t.oid) = _def
  ) THEN
    RETURN;
  END IF;
  EXECUTE pg_catalog.regexp_replace(_def, '^CREATE TRIGGER ', 'CREATE OR REPLACE TRIGGER ');
END;
$f$;

-- 1. Tables -----------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects (id) ON DELETE SET NULL,
  name text NOT NULL CONSTRAINT habits_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description text CONSTRAINT habits_description_check CHECK (length(description) <= 2000),
  color text NOT NULL DEFAULT 'teal' CONSTRAINT habits_color_check CHECK (length(color) <= 50),
  icon text CONSTRAINT habits_icon_check CHECK (length(icon) <= 50),
  schedule_type text NOT NULL DEFAULT 'daily' CONSTRAINT habits_schedule_type_check
    CHECK (schedule_type IN ('daily', 'weekdays', 'weekly')),
  weekdays_mask smallint NOT NULL DEFAULT 127 CONSTRAINT habits_weekdays_mask_check
    CHECK (weekdays_mask BETWEEN 1 AND 127),
  times_per_week smallint NOT NULL DEFAULT 3 CONSTRAINT habits_times_per_week_check
    CHECK (times_per_week BETWEEN 1 AND 7),
  target integer NOT NULL DEFAULT 1 CONSTRAINT habits_target_check CHECK (target BETWEEN 1 AND 100),
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.habit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id uuid NOT NULL REFERENCES public.habits (id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  date date NOT NULL,
  count integer NOT NULL DEFAULT 1 CONSTRAINT habit_logs_count_check CHECK (count BETWEEN 0 AND 1000),
  note text CONSTRAINT habit_logs_note_check CHECK (length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- CREATE INDEX IF NOT EXISTS locks the table (SHARE) before it checks, so only run it when needed.
DO $$
BEGIN
  IF to_regclass('public.habits_user_idx') IS NULL THEN
    CREATE INDEX IF NOT EXISTS habits_user_idx ON public.habits (user_id, position);
  END IF;
  IF to_regclass('public.habits_project_idx') IS NULL THEN
    CREATE INDEX IF NOT EXISTS habits_project_idx ON public.habits (project_id)
      WHERE project_id IS NOT NULL;
  END IF;
  IF to_regclass('public.habit_logs_habit_date_key') IS NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS habit_logs_habit_date_key ON public.habit_logs (habit_id, date);
  END IF;
  IF to_regclass('public.habit_logs_user_date_idx') IS NULL THEN
    CREATE INDEX IF NOT EXISTS habit_logs_user_date_idx ON public.habit_logs (user_id, date DESC);
  END IF;
END $$;

-- 2. Row guards --------------------------------------------------------------------------------

-- A log never moves to another habit (end users only; the service role restores backups).
CREATE OR REPLACE FUNCTION public.guard_habit_log_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.habit_id IS DISTINCT FROM OLD.habit_id THEN
    RAISE EXCEPTION 'habit_id of habit_logs rows cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

SELECT pg_temp.ensure_trigger('public.habits', 'a_habits_user_id_immutable',
  'CREATE TRIGGER a_habits_user_id_immutable BEFORE UPDATE ON public.habits FOR EACH ROW EXECUTE FUNCTION public.prevent_user_id_change()');
SELECT pg_temp.ensure_trigger('public.habit_logs', 'a_habit_logs_user_id_immutable',
  'CREATE TRIGGER a_habit_logs_user_id_immutable BEFORE UPDATE ON public.habit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_user_id_change()');
SELECT pg_temp.ensure_trigger('public.habit_logs', 'a_habit_logs_guard',
  'CREATE TRIGGER a_habit_logs_guard BEFORE UPDATE ON public.habit_logs FOR EACH ROW EXECUTE FUNCTION public.guard_habit_log_update()');

-- 3. RLS ---------------------------------------------------------------------------------------

-- Policies have no CREATE OR REPLACE and DROP/CREATE POLICY lock the table ACCESS EXCLUSIVE, so
-- each is created only when it is missing (this file is the only one that defines them).
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.habits'::regclass) THEN
    ALTER TABLE public.habits ENABLE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.habit_logs'::regclass) THEN
    ALTER TABLE public.habit_logs ENABLE ROW LEVEL SECURITY;
  END IF;

  -- habits: owner only; the optional project must be one the owner belongs to.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habits'
                  AND policyname = 'habits_select') THEN
    CREATE POLICY habits_select ON public.habits FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habits'
                  AND policyname = 'habits_insert') THEN
    CREATE POLICY habits_insert ON public.habits FOR INSERT TO authenticated
      WITH CHECK (user_id = (SELECT auth.uid())
        AND (project_id IS NULL OR public.is_project_member(project_id, (SELECT auth.uid()))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habits'
                  AND policyname = 'habits_update') THEN
    CREATE POLICY habits_update ON public.habits FOR UPDATE TO authenticated
      USING (user_id = (SELECT auth.uid()))
      WITH CHECK (user_id = (SELECT auth.uid())
        AND (project_id IS NULL OR public.is_project_member(project_id, (SELECT auth.uid()))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habits'
                  AND policyname = 'habits_delete') THEN
    CREATE POLICY habits_delete ON public.habits FOR DELETE TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  -- habit_logs: owner only, and only for the owner's own habits (habits' policies never read
  -- habit_logs, so this subquery cannot recurse).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habit_logs'
                  AND policyname = 'habit_logs_select') THEN
    CREATE POLICY habit_logs_select ON public.habit_logs FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habit_logs'
                  AND policyname = 'habit_logs_insert') THEN
    CREATE POLICY habit_logs_insert ON public.habit_logs FOR INSERT TO authenticated
      WITH CHECK (user_id = (SELECT auth.uid())
        AND EXISTS (SELECT 1 FROM public.habits h
                     WHERE h.id = habit_id AND h.user_id = (SELECT auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habit_logs'
                  AND policyname = 'habit_logs_update') THEN
    CREATE POLICY habit_logs_update ON public.habit_logs FOR UPDATE TO authenticated
      USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habit_logs'
                  AND policyname = 'habit_logs_delete') THEN
    CREATE POLICY habit_logs_delete ON public.habit_logs FOR DELETE TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  -- Two-factor (migration 0022): an aal1 session of a user with a verified factor sees nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habits'
                  AND policyname = 'mfa_aal2') THEN
    CREATE POLICY mfa_aal2 ON public.habits AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'habit_logs'
                  AND policyname = 'mfa_aal2') THEN
    CREATE POLICY mfa_aal2 ON public.habit_logs AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));
  END IF;
END $$;

REVOKE ALL ON public.habits, public.habit_logs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habits, public.habit_logs TO authenticated;
GRANT ALL ON public.habits, public.habit_logs TO service_role;

-- 4. Activity log ------------------------------------------------------------------------------
-- Habit created / renamed / archived / trashed / deleted. Check-ins (habit_logs) are not logged.

SELECT pg_temp.ensure_trigger('public.habits', 'audit_habits_changes',
  'CREATE TRIGGER audit_habits_changes AFTER INSERT OR DELETE OR UPDATE ON public.habits FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()');

-- 5. Demo limits (migration 0019) ----------------------------------------------------------------
-- `demo_limit:habits` / `demo_limit:habit_logs` override the defaults (30 habits, 1000 check-ins:
-- the seed has ~150).

SELECT pg_temp.ensure_trigger('public.habit_logs', 'zz_demo_guard',
  'CREATE TRIGGER zz_demo_guard BEFORE INSERT OR UPDATE ON public.habit_logs FOR EACH ROW EXECUTE FUNCTION public.demo_guard(''1000'', ''user_id'', ''check-in kebiasaan'')');
SELECT pg_temp.ensure_trigger('public.habit_logs', 'zz_demo_write',
  'CREATE TRIGGER zz_demo_write BEFORE INSERT OR DELETE OR UPDATE ON public.habit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.demo_write_quota()');
SELECT pg_temp.ensure_trigger('public.habits', 'zz_demo_guard',
  'CREATE TRIGGER zz_demo_guard BEFORE INSERT OR UPDATE ON public.habits FOR EACH ROW EXECUTE FUNCTION public.demo_guard(''30'', ''user_id'', ''kebiasaan'')');
SELECT pg_temp.ensure_trigger('public.habits', 'zz_demo_write',
  'CREATE TRIGGER zz_demo_write BEFORE INSERT OR DELETE OR UPDATE ON public.habits FOR EACH STATEMENT EXECUTE FUNCTION public.demo_write_quota()');

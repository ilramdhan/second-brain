-- Checks for migrations 0025 (habit tracker: public.habits, public.habit_logs) and 0026
-- (public.report_daily, the reports aggregate).
--
-- Covers owner-only RLS on both tables (no project-member access), logs only for the caller's own
-- habits, one log per habit and day, the immutable user_id/habit_id, the aal2 policy, the demo
-- row limit, the audit trigger (habits yes, check-ins no) and, for report_daily, that it runs with
-- the caller's RLS, honours the time zone at day boundaries, the project filter and the range cap.
--
-- Run with psql (it uses \ir to re-apply the migrations, which also checks they are idempotent)
-- as a superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/habits_reports.sql
-- Everything runs in one transaction that is rolled back; success ends with
-- "habits_reports: all checks passed".

BEGIN;

\ir ../../drizzle/migrations/0025_habits.sql
\ir ../../drizzle/migrations/0026_report_daily.sql

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  friendly_name text,
  factor_type text NOT NULL DEFAULT 'totp',
  status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION pg_temp.login(_uid uuid, _aal text DEFAULT 'aal1') RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', _uid::text, true),
         set_config('request.jwt.claims',
           json_build_object('sub', _uid, 'role', 'authenticated', 'aal', _aal)::text, true),
         set_config('role', 'authenticated', true);
$$;
CREATE FUNCTION pg_temp.logout() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('role', 'none', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '', true);
$$;
CREATE FUNCTION pg_temp.try(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

INSERT INTO auth.users (id, email, encrypted_password) VALUES
  ('00000000-0000-0000-0000-00000000f001', 'habit-owner@example.test', 'x'),
  ('00000000-0000-0000-0000-00000000f002', 'habit-member@example.test', 'x'),
  ('00000000-0000-0000-0000-00000000f003', 'habit-outsider@example.test', 'x'),
  ('00000000-0000-0000-0000-00000000f004', 'habit-mfa@example.test', 'x');
INSERT INTO public.projects (id, user_id, name) VALUES
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f001', 'Owner project'),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-00000000f003', 'Outsider project');
INSERT INTO public.project_members (project_id, user_id) VALUES
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f002');
INSERT INTO auth.mfa_factors (user_id, status) VALUES ('00000000-0000-0000-0000-00000000f004', 'verified');

DELETE FROM public.app_config WHERE key = 'demo_mode' OR key LIKE 'demo\_%';

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-00000000f001';
  member uuid := '00000000-0000-0000-0000-00000000f002';
  outsider uuid := '00000000-0000-0000-0000-00000000f003';
  mfa uuid := '00000000-0000-0000-0000-00000000f004';
  project uuid := '00000000-0000-0000-0000-00000000f101';
  other_project uuid := '00000000-0000-0000-0000-00000000f102';
  habit uuid := '00000000-0000-0000-0000-00000000f201';
  member_habit uuid := '00000000-0000-0000-0000-00000000f202';
  n int;
  err text;
BEGIN
  -- Structure.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.habits'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.habit_logs'::regclass) THEN
    RAISE EXCEPTION 'FAIL RLS is not enabled on habits/habit_logs';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('habits', 'habit_logs')
     AND policyname = 'mfa_aal2' AND permissive = 'RESTRICTIVE';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL expected a restrictive mfa_aal2 policy on both tables'; END IF;
  IF has_table_privilege('anon', 'public.habits', 'SELECT')
     OR has_table_privilege('anon', 'public.habit_logs', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL anon can read habits';
  END IF;
  IF has_function_privilege('anon', 'public.report_daily(date, date, text, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL anon can run report_daily';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.report_daily(date, date, text, uuid, uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'FAIL report_daily must be SECURITY INVOKER';
  END IF;
  RAISE NOTICE 'ok   RLS, aal2 policies, privileges, report_daily is security invoker';

  -- Owner: habits (also in an own project), logs, one per day.
  PERFORM pg_temp.login(owner_id);
  err := pg_temp.try(format('INSERT INTO public.habits (id, user_id, name, project_id) VALUES (%L, %L, %L, %L)',
                            habit, owner_id, 'Olahraga', project));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL owner cannot create a habit: %', err; END IF;
  err := pg_temp.try(format('INSERT INTO public.habits (user_id, name, project_id) VALUES (%L, %L, %L)',
                            owner_id, 'Foreign', other_project));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL habit in a foreign project: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try(format('INSERT INTO public.habits (user_id, name) VALUES (%L, %L)', member, 'Forged'));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL habit inserted for another user: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try(format('INSERT INTO public.habits (user_id, name, schedule_type) VALUES (%L, %L, %L)', owner_id, 'Bad', 'hourly'));
  IF err IS NULL OR err NOT LIKE '23514%' THEN RAISE EXCEPTION 'FAIL invalid schedule accepted: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try(format('INSERT INTO public.habit_logs (habit_id, user_id, date) VALUES (%L, %L, %L)', habit, owner_id, '2026-10-01'));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL owner cannot check in: %', err; END IF;
  err := pg_temp.try(format('INSERT INTO public.habit_logs (habit_id, user_id, date) VALUES (%L, %L, %L)', habit, owner_id, '2026-10-01'));
  IF err IS NULL OR err NOT LIKE '23505%' THEN RAISE EXCEPTION 'FAIL second log on the same day: %', coalesce(err, 'success'); END IF;
  -- Upsert (the client's check-in) bumps the count instead.
  err := pg_temp.try(format('INSERT INTO public.habit_logs (habit_id, user_id, date, count) VALUES (%L, %L, %L, 2) ON CONFLICT (habit_id, date) DO UPDATE SET count = excluded.count',
                            habit, owner_id, '2026-10-01'));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL upsert check-in refused: %', err; END IF;
  err := pg_temp.try(format('UPDATE public.habits SET user_id = %L WHERE id = %L', member, habit));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL habit user_id changed: %', coalesce(err, 'success'); END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   owner creates habits and one log per day; foreign project/user refused';

  -- Member of the owner's project: sees none of the owner's habits or logs, cannot log on them.
  PERFORM pg_temp.login(member);
  SELECT count(*) INTO n FROM public.habits;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL member sees % owner habit(s)', n; END IF;
  SELECT count(*) INTO n FROM public.habit_logs;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL member sees % owner log(s)', n; END IF;
  err := pg_temp.try(format('INSERT INTO public.habit_logs (habit_id, user_id, date) VALUES (%L, %L, %L)', habit, member, '2026-10-02'));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL member logged on the owner habit: %', coalesce(err, 'success'); END IF;
  -- The member may group an own habit under the shared project (membership is enough).
  err := pg_temp.try(format('INSERT INTO public.habits (id, user_id, name, project_id) VALUES (%L, %L, %L, %L)',
                            member_habit, member, 'Membaca', project));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL member cannot create a habit in a shared project: %', err; END IF;
  -- ...and cannot move an own log onto someone else's habit.
  INSERT INTO public.habit_logs (habit_id, user_id, date) VALUES (member_habit, member, '2026-10-02');
  err := pg_temp.try(format('UPDATE public.habit_logs SET habit_id = %L WHERE habit_id = %L', habit, member_habit));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL log moved to another habit: %', coalesce(err, 'success'); END IF;
  UPDATE public.habits SET name = 'hijacked' WHERE id = habit;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL member renamed the owner habit'; END IF;
  DELETE FROM public.habit_logs WHERE habit_id = habit;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL member deleted % owner log(s)', n; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   project members cannot read or change another user''s habits';

  -- Outsider: nothing.
  PERFORM pg_temp.login(outsider);
  SELECT count(*) INTO n FROM public.habits;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL outsider sees % habit(s)', n; END IF;
  DELETE FROM public.habits;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL outsider deleted % habit(s)', n; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   outsider cannot read or delete';

  -- Audit: habit creation logged, check-ins not.
  IF NOT EXISTS (SELECT 1 FROM public.activity_logs WHERE entity_id = habit AND action = 'insert') THEN
    RAISE EXCEPTION 'FAIL habit creation is not in the activity log';
  END IF;
  IF EXISTS (SELECT 1 FROM public.activity_logs WHERE entity_type = 'habit_logs') THEN
    RAISE EXCEPTION 'FAIL check-ins are written to the activity log';
  END IF;
  RAISE NOTICE 'ok   habits audited, check-ins not';

  -- Purging a habit deletes its logs.
  DELETE FROM public.habits WHERE id = member_habit;
  IF EXISTS (SELECT 1 FROM public.habit_logs WHERE habit_id = member_habit) THEN
    RAISE EXCEPTION 'FAIL logs of a purged habit remain';
  END IF;
  RAISE NOTICE 'ok   purge cascades to logs';

  -- 2FA user at aal1: refused; at aal2: allowed.
  PERFORM pg_temp.login(mfa, 'aal1');
  err := pg_temp.try(format('INSERT INTO public.habits (user_id, name) VALUES (%L, %L)', mfa, 'aal1'));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL aal1 habit created: %', coalesce(err, 'success'); END IF;
  PERFORM pg_temp.logout();
  PERFORM pg_temp.login(mfa, 'aal2');
  err := pg_temp.try(format('INSERT INTO public.habits (user_id, name) VALUES (%L, %L)', mfa, 'aal2'));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL aal2 habit refused: %', err; END IF;
  PERFORM pg_temp.logout();
  PERFORM pg_temp.login(mfa, 'aal1');
  SELECT count(*) INTO n FROM public.habits;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL aal1 session sees % habit(s)', n; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   aal1 session of a 2FA user is refused';

  -- Demo row limit.
  INSERT INTO public.app_config (key, value) VALUES ('demo_mode', 'on'), ('demo_limit:habits', '1');
  PERFORM pg_temp.login(mfa, 'aal2');
  err := pg_temp.try(format('INSERT INTO public.habits (user_id, name) VALUES (%L, %L)', mfa, 'second'));
  IF err IS NULL OR err NOT LIKE 'P0001 Batas demo: maksimal 1 kebiasaan%' THEN
    RAISE EXCEPTION 'FAIL demo limit not enforced: %', coalesce(err, 'success');
  END IF;
  PERFORM pg_temp.logout();
  DELETE FROM public.app_config WHERE key IN ('demo_mode', 'demo_limit:habits');
  RAISE NOTICE 'ok   demo row limit';
END $$;

-- report_daily ----------------------------------------------------------------------------------

-- Day-boundary fixture (Jakarta is UTC+7): "edge" is created 2026-09-30 16:30Z (23:30 local, still
-- 30 Sep) and completed 17:30Z (00:30 local, already 1 Oct), so UTC puts both on 30 Sep.
INSERT INTO public.tasks (id, user_id, project_id, title, status, estimate_minutes, created_at, completed_at, start_date, time_block_end) VALUES
  ('00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f101',
   'edge', 'done', 30, '2026-09-30 16:30+00', '2026-09-30 17:30+00', NULL, NULL),
  ('00000000-0000-0000-0000-00000000f302', '00000000-0000-0000-0000-00000000f001', NULL,
   'open, no project', 'todo', 60, '2026-09-29 03:00+00', NULL, '2026-10-01 02:00+00', '2026-10-01 03:30+00'),
  -- trashed: never counted
  ('00000000-0000-0000-0000-00000000f303', '00000000-0000-0000-0000-00000000f001', NULL,
   'trashed', 'todo', 15, '2026-09-29 03:00+00', NULL, NULL, NULL),
  -- the outsider's task: invisible to the owner
  ('00000000-0000-0000-0000-00000000f304', '00000000-0000-0000-0000-00000000f003', NULL,
   'foreign', 'done', 45, '2026-09-30 03:00+00', '2026-10-01 03:00+00', NULL, NULL);
UPDATE public.tasks SET deleted_at = now() WHERE id = '00000000-0000-0000-0000-00000000f303';
INSERT INTO public.time_entries (user_id, task_id, mode, started_at, duration_seconds) VALUES
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f301', 'focus', '2026-09-30 18:00+00', 1500),
  ('00000000-0000-0000-0000-00000000f001', NULL, 'break', '2026-09-30 18:30+00', 300),
  ('00000000-0000-0000-0000-00000000f003', NULL, 'focus', '2026-09-30 18:00+00', 9999);

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-00000000f001';
  r record;
  err text;
BEGIN
  PERFORM pg_temp.login(owner_id);

  -- Jakarta: created on 30 Sep, completed (and focused) on 1 Oct.
  SELECT * INTO r FROM public.report_daily('2026-09-30', '2026-09-30', 'Asia/Jakarta');
  IF r.created <> 1 OR r.completed <> 0 OR r.open_tasks <> 2 OR r.open_minutes <> 90 THEN
    RAISE EXCEPTION 'FAIL Jakarta 30 Sep: %', r;
  END IF;
  SELECT * INTO r FROM public.report_daily('2026-10-01', '2026-10-01', 'Asia/Jakarta');
  IF r.created <> 0 OR r.completed <> 1 OR r.completed_minutes <> 30 OR r.open_tasks <> 1
     OR r.focus_seconds <> 1500 OR r.planned_minutes <> 90 THEN
    RAISE EXCEPTION 'FAIL Jakarta 1 Oct: %', r;
  END IF;
  -- UTC: both on 30 Sep; the outsider's task and focus time and the trashed task never appear.
  SELECT * INTO r FROM public.report_daily('2026-09-30', '2026-09-30', 'UTC');
  IF r.created <> 1 OR r.completed <> 1 OR r.focus_seconds <> 1500 OR r.open_tasks <> 1 THEN
    RAISE EXCEPTION 'FAIL UTC 30 Sep: %', r;
  END IF;
  -- An unknown zone falls back to UTC instead of failing.
  SELECT * INTO r FROM public.report_daily('2026-09-30', '2026-09-30', 'Mars/Olympus');
  IF r.completed <> 1 THEN RAISE EXCEPTION 'FAIL unknown zone: %', r; END IF;
  -- Project filter.
  SELECT * INTO r FROM public.report_daily('2026-09-29', '2026-09-29', 'UTC', '00000000-0000-0000-0000-00000000f101');
  IF r.open_tasks <> 0 THEN RAISE EXCEPTION 'FAIL project filter (before creation): %', r; END IF;
  SELECT * INTO r FROM public.report_daily('2026-10-01', '2026-10-01', 'Asia/Jakarta', '00000000-0000-0000-0000-00000000f101');
  IF r.completed <> 1 OR r.open_tasks <> 0 OR r.planned_minutes <> 0 OR r.focus_seconds <> 1500 THEN
    RAISE EXCEPTION 'FAIL project filter: %', r;
  END IF;
  -- One row per day, range capped.
  IF (SELECT count(*) FROM public.report_daily('2026-01-01', '2026-03-31', 'UTC')) <> 90 THEN
    RAISE EXCEPTION 'FAIL expected 90 rows for Q1';
  END IF;
  err := pg_temp.try('SELECT * FROM public.report_daily(''2024-01-01'', ''2026-01-01'', ''UTC'')');
  IF err IS NULL OR err NOT LIKE '22023%' THEN RAISE EXCEPTION 'FAIL long range accepted: %', coalesce(err, 'success'); END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   report_daily: RLS, time zone boundaries, filters, range cap';
END $$;

SELECT 'habits_reports: all checks passed' AS result;

ROLLBACK;

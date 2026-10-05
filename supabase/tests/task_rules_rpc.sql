-- Checks for migration 0017 (task rules as RPCs: shift_task_dependents, complete_task).
--
-- Run as a superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/task_rules_rpc.sql
-- Everything runs in one transaction that is rolled back; success ends with
-- "task_rules_rpc: all checks passed".

BEGIN;

CREATE FUNCTION pg_temp.as_role(_role text, _uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', _role)::text, true),
         set_config('role', _role, true);
$$;
CREATE FUNCTION pg_temp.reset() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('role', 'postgres', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '', true);
$$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'tr-owner@example.test'),
  ('00000000-0000-0000-0000-00000000e002', 'tr-member@example.test'),
  ('00000000-0000-0000-0000-00000000e003', 'tr-stranger@example.test');

INSERT INTO public.projects (id, user_id, name) VALUES
  ('30000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e001', 'TR');
INSERT INTO public.project_members (project_id, user_id) VALUES
  ('30000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e002');

-- a → b → c (a blocks b, b blocks c), plus a done dependent d, an undated dependent e and a
-- trashed dependent f of a. c → a closes a cycle to check the walk terminates.
INSERT INTO public.tasks (id, user_id, title, status, start_date, due_date, recurrence) VALUES
  ('40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001', 'A', 'todo', NULL, '2026-01-10 10:00+00', 'weekly'),
  ('40000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e001', 'B', 'todo', '2026-01-11 10:00+00', '2026-01-12 10:00+00', NULL),
  ('40000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000e001', 'C', 'todo', NULL, '2026-01-15 10:00+00', NULL),
  ('40000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000e001', 'D', 'done', NULL, '2026-01-15 10:00+00', NULL),
  ('40000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e001', 'E', 'todo', NULL, NULL, NULL);
INSERT INTO public.tasks (id, user_id, title, due_date, deleted_at) VALUES
  ('40000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000e001', 'F', '2026-01-15 10:00+00', now());
INSERT INTO public.task_dependencies (user_id, blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-00000000e001', '40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000e001', '40000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000e001', '40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000e001', '40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-00000000e001', '40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000f1');

DO $$
DECLARE
  owner constant uuid := '00000000-0000-0000-0000-00000000e001';
  stranger constant uuid := '00000000-0000-0000-0000-00000000e003';
  a constant uuid := '40000000-0000-0000-0000-0000000000a1';
  n int;
BEGIN
  -- Functions are SECURITY INVOKER with a pinned search_path; anon cannot call them.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('shift_task_dependents', 'complete_task')
             AND pronamespace = 'public'::regnamespace
             AND (prosecdef OR NOT ('search_path=""' = ANY (proconfig)))) THEN
    RAISE EXCEPTION 'FAIL task rule functions must be SECURITY INVOKER with search_path ''''';
  END IF;
  IF has_function_privilege('anon', 'public.complete_task(uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.shift_task_dependents(uuid, bigint, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL anon can execute task rule functions';
  END IF;
  RAISE NOTICE 'ok   invoker functions, no anon execute';

  -- A stranger sees no dependencies and changes nothing.
  PERFORM pg_temp.as_role('authenticated', stranger);
  SELECT count(*) INTO n FROM public.shift_task_dependents(a, 86400000);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL stranger shifted % tasks', n; END IF;
  BEGIN
    PERFORM public.shift_task_dependents(a, 86400000, owner);
    RAISE EXCEPTION 'FAIL stranger acted for another user';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.reset();

  -- Owner: shift a by one day; b and c (transitively) move, d (done), e (undated), f (trashed)
  -- and a itself (cycle c → a) do not.
  INSERT INTO public.task_dependencies (user_id, blocker_id, blocked_id)
    VALUES (owner, '40000000-0000-0000-0000-0000000000c1', a);
  PERFORM pg_temp.as_role('authenticated', owner);
  SELECT count(*) INTO n FROM public.shift_task_dependents(a, 86400000);
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL expected 2 shifted tasks, got %', n; END IF;
  PERFORM pg_temp.reset();
  IF (SELECT start_date FROM public.tasks WHERE id = '40000000-0000-0000-0000-0000000000b1') <> '2026-01-12 10:00+00'
     OR (SELECT due_date FROM public.tasks WHERE id = '40000000-0000-0000-0000-0000000000b1') <> '2026-01-13 10:00+00'
     OR (SELECT due_date FROM public.tasks WHERE id = '40000000-0000-0000-0000-0000000000c1') <> '2026-01-16 10:00+00'
     OR (SELECT start_date FROM public.tasks WHERE id = '40000000-0000-0000-0000-0000000000c1') IS NOT NULL
     OR (SELECT due_date FROM public.tasks WHERE id = '40000000-0000-0000-0000-0000000000d1') <> '2026-01-15 10:00+00'
     OR (SELECT due_date FROM public.tasks WHERE id = '40000000-0000-0000-0000-0000000000f1') <> '2026-01-15 10:00+00'
     OR (SELECT due_date FROM public.tasks WHERE id = a) <> '2026-01-10 10:00+00' THEN
    RAISE EXCEPTION 'FAIL wrong dates after shift';
  END IF;
  DELETE FROM public.task_dependencies WHERE blocked_id = a;

  -- Zero or negative deltas never shift.
  PERFORM pg_temp.as_role('authenticated', owner);
  SELECT count(*) INTO n FROM public.shift_task_dependents(a, -86400000);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL negative delta shifted % tasks', n; END IF;
  PERFORM pg_temp.reset();

  -- Service role: scoped to the user it acts for.
  PERFORM pg_temp.as_role('service_role', NULL);
  SELECT count(*) INTO n FROM public.shift_task_dependents(a, 3600000, stranger);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL service role shifted % tasks for a stranger', n; END IF;
  SELECT count(*) INTO n FROM public.shift_task_dependents(a, 3600000, owner);
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL service role shifted % tasks for the owner', n; END IF;
  BEGIN
    PERFORM public.shift_task_dependents(a, 3600000);
    RAISE EXCEPTION 'FAIL service role shift without a user';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM pg_temp.reset();
  RAISE NOTICE 'ok   shift_task_dependents';
END $$;

DO $$
DECLARE
  owner constant uuid := '00000000-0000-0000-0000-00000000e001';
  member constant uuid := '00000000-0000-0000-0000-00000000e002';
  stranger constant uuid := '00000000-0000-0000-0000-00000000e003';
  a constant uuid := '40000000-0000-0000-0000-0000000000a1';
  b constant uuid := '40000000-0000-0000-0000-0000000000b1';
  r jsonb;
  nxt public.tasks;
  p uuid := '30000000-0000-0000-0000-0000000000e1';
  m uuid;
BEGIN
  PERFORM pg_temp.as_role('authenticated', owner);
  -- b is blocked by a: refused, nothing changes.
  r := public.complete_task(b);
  IF r ->> 'status' <> 'blocked' OR r ->> 'blocker' <> 'A' THEN
    RAISE EXCEPTION 'FAIL expected blocked by A, got %', r;
  END IF;
  -- a: done; open dependents b and e are unblocked (c still waits on b, d is already done, f is
  -- trashed); the next weekly occurrence is created.
  r := public.complete_task(a, 'Asia/Jakarta');
  IF r ->> 'status' <> 'ok' OR r -> 'task' ->> 'status' <> 'done'
     OR (r -> 'task' ->> 'completed_at') IS NULL THEN
    RAISE EXCEPTION 'FAIL complete a: %', r;
  END IF;
  IF r -> 'unblocked' <> jsonb_build_array(
       jsonb_build_object('id', b, 'title', 'B'),
       jsonb_build_object('id', '40000000-0000-0000-0000-0000000000e1'::uuid, 'title', 'E')) THEN
    RAISE EXCEPTION 'FAIL unblocked list: %', r -> 'unblocked';
  END IF;
  nxt := jsonb_populate_record(NULL::public.tasks, r -> 'recurring');
  IF nxt.id IS NULL OR nxt.due_date <> '2026-01-17 10:00+00' OR nxt.status <> 'todo'
     OR nxt.recurrence <> 'weekly' OR nxt.user_id <> owner OR nxt.title <> 'A' THEN
    RAISE EXCEPTION 'FAIL recurring task: %', r -> 'recurring';
  END IF;
  r := public.complete_task(a);
  IF r ->> 'status' <> 'already_done' THEN RAISE EXCEPTION 'FAIL expected already_done: %', r; END IF;

  -- Monthly recurrence clamps to the month end in the given time zone (Jan 31 → Feb 28).
  INSERT INTO public.tasks (user_id, title, due_date, recurrence)
    VALUES (owner, 'M', '2026-01-31 16:00+00', 'monthly') RETURNING id INTO m;  -- 23:00 Jakarta
  r := public.complete_task(m, 'Asia/Jakarta');
  IF (r -> 'recurring' ->> 'due_date')::timestamptz <> '2026-02-28 16:00+00' THEN
    RAISE EXCEPTION 'FAIL monthly recurrence: %', r -> 'recurring' ->> 'due_date';
  END IF;

  -- Strangers cannot see the task; nobody acts for another user.
  PERFORM pg_temp.as_role('authenticated', stranger);
  BEGIN
    PERFORM public.complete_task(b);
    RAISE EXCEPTION 'FAIL stranger completed a task';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_task(b, 'UTC', owner);
    RAISE EXCEPTION 'FAIL stranger acted for the owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- A member completes a recurring task of a shared project; the next one belongs to the member
  -- (inserts require user_id = auth.uid()) and stays in the project.
  PERFORM pg_temp.reset();
  INSERT INTO public.tasks (user_id, project_id, title, due_date, recurrence)
    VALUES (owner, p, 'Shared', '2026-03-01 10:00+00', 'daily') RETURNING id INTO m;
  PERFORM pg_temp.as_role('authenticated', member);
  r := public.complete_task(m);
  nxt := jsonb_populate_record(NULL::public.tasks, r -> 'recurring');
  IF nxt.user_id <> member OR nxt.project_id <> p OR nxt.due_date <> '2026-03-02 10:00+00' THEN
    RAISE EXCEPTION 'FAIL member recurrence: %', r -> 'recurring';
  END IF;
  IF (SELECT user_id FROM public.tasks WHERE id = m) <> owner THEN
    RAISE EXCEPTION 'FAIL user_id changed on completion';
  END IF;

  -- Service role must name a user who can access the task.
  PERFORM pg_temp.as_role('service_role', NULL);
  BEGIN
    PERFORM public.complete_task(b, 'UTC', stranger);
    RAISE EXCEPTION 'FAIL service role completed for a stranger';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_task(b);
    RAISE EXCEPTION 'FAIL service role completed without a user';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  r := public.complete_task(b, 'UTC', owner);
  IF r ->> 'status' <> 'ok' OR (r -> 'recurring') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL service role complete b: %', r;
  END IF;
  PERFORM pg_temp.reset();
  RAISE NOTICE 'ok   complete_task';
END $$;

DO $$ BEGIN RAISE NOTICE 'task_rules_rpc: all checks passed'; END $$;

ROLLBACK;

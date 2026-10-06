-- End-to-end team-access matrix: project owner, project member and an outsider (plan item 5.3).
--
-- Covers projects, project_members, tasks, notes, task_dependencies and the note_backlinks /
-- complete_task / shift_task_dependents RPCs: members read and edit shared rows, outsiders see
-- and change nothing, only the row creator or project owner trashes/deletes, user_id is
-- immutable, and the RPCs respect RLS.
--
-- Run as a superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_team_access.sql
-- Everything runs in one transaction that is rolled back; success ends with
-- "rls_team_access: all checks passed".

BEGIN;

-- Helpers ---------------------------------------------------------------------------------------

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

-- The statement must succeed and affect exactly `_rows` rows.
CREATE FUNCTION pg_temp.expect_ok(_label text, _uid uuid, _sql text, _rows int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.login(_uid);
  EXECUTE _sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.logout();
  IF n <> _rows THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s), got %', _label, _rows, n;
  END IF;
  RAISE NOTICE 'ok   %', _label;
END $$;

-- Rejected by RLS / guard triggers (insufficient_privilege) or zero rows affected (row hidden).
CREATE FUNCTION pg_temp.expect_denied(_label text, _uid uuid, _sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    PERFORM pg_temp.login(_uid);
    EXECUTE _sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM pg_temp.logout();
  EXCEPTION WHEN insufficient_privilege THEN
    n := 0;
  END;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL %: expected denial, % row(s) affected', _label, n;
  END IF;
  RAISE NOTICE 'ok   % (denied)', _label;
END $$;

CREATE FUNCTION pg_temp.expect_count(_label text, _uid uuid, _sql text, _expected int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.login(_uid);
  EXECUTE _sql INTO n;
  PERFORM pg_temp.logout();
  IF n <> _expected THEN
    RAISE EXCEPTION 'FAIL %: expected count %, got %', _label, _expected, n;
  END IF;
  RAISE NOTICE 'ok   %', _label;
END $$;

-- Fixtures (as superuser) -----------------------------------------------------------------------
-- owner (...f001) owns project "Team"; member (...f002) belongs to it; outsider (...f003) does not.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000f001', 'ta-owner@example.test'),
  ('00000000-0000-0000-0000-00000000f002', 'ta-member@example.test'),
  ('00000000-0000-0000-0000-00000000f003', 'ta-outsider@example.test');

INSERT INTO public.projects (id, user_id, name) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000f001', 'Team'),
  ('a0000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000f003', 'Outsider');
INSERT INTO public.project_members (project_id, user_id) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000f002');

-- T1 (owner, shared) blocks T2 (member, shared); T3 is the owner's private task, T4 the outsider's.
INSERT INTO public.tasks (id, user_id, project_id, title, due_date) VALUES
  ('b0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000f001', 'a0000000-0000-0000-0000-0000000000f1', 'T1', '2026-03-01 10:00+00'),
  ('b0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000f002', 'a0000000-0000-0000-0000-0000000000f1', 'T2', '2026-03-02 10:00+00'),
  ('b0000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000f001', NULL, 'T3', NULL),
  ('b0000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000f003', 'a0000000-0000-0000-0000-0000000000f3', 'T4', NULL);
INSERT INTO public.task_dependencies (id, user_id, blocker_id, blocked_id) VALUES
  ('c0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000f001',
   'b0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000f2');

-- "Spec" (owner, shared) is linked by "Review" (member, shared) and by "Spy" (outsider, private).
INSERT INTO public.notes (id, user_id, project_id, title, content, links, refs) VALUES
  ('d0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000f001', 'a0000000-0000-0000-0000-0000000000f1', 'Spec', 'spec body', '{}', '{}'),
  ('d0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000f001', NULL, 'Diary', 'private', '{}', '{}'),
  ('d0000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000f002', 'a0000000-0000-0000-0000-0000000000f1', 'Review', 'see [[Spec]]', ARRAY['spec'], '{}'),
  ('d0000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000f003', NULL, 'Spy', 'see [[Spec]]', ARRAY['spec'], '{}');

-- Projects and membership -----------------------------------------------------------------------
SELECT pg_temp.expect_count('member reads shared project', '00000000-0000-0000-0000-00000000f002',
  $q$SELECT count(*) FROM public.projects WHERE id = 'a0000000-0000-0000-0000-0000000000f1'$q$, 1);
SELECT pg_temp.expect_count('outsider cannot read shared project', '00000000-0000-0000-0000-00000000f003',
  $q$SELECT count(*) FROM public.projects WHERE id = 'a0000000-0000-0000-0000-0000000000f1'$q$, 0);
SELECT pg_temp.expect_count('outsider cannot list project members', '00000000-0000-0000-0000-00000000f003',
  $q$SELECT count(*) FROM public.project_members WHERE project_id = 'a0000000-0000-0000-0000-0000000000f1'$q$, 0);
SELECT pg_temp.expect_denied('outsider cannot join project', '00000000-0000-0000-0000-00000000f003',
  $q$INSERT INTO public.project_members (project_id, user_id) VALUES ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000f003')$q$);
SELECT pg_temp.expect_denied('member cannot invite others', '00000000-0000-0000-0000-00000000f002',
  $q$INSERT INTO public.project_members (project_id, user_id) VALUES ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000f003')$q$);
SELECT pg_temp.expect_denied('outsider cannot rename project', '00000000-0000-0000-0000-00000000f003',
  $q$UPDATE public.projects SET name = 'x' WHERE id = 'a0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('member cannot rename project', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.projects SET name = 'x' WHERE id = 'a0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('outsider cannot delete project', '00000000-0000-0000-0000-00000000f003',
  $q$DELETE FROM public.projects WHERE id = 'a0000000-0000-0000-0000-0000000000f1'$q$);

-- Tasks -------------------------------------------------------------------------------------------
SELECT pg_temp.expect_count('member reads both shared tasks', '00000000-0000-0000-0000-00000000f002',
  $q$SELECT count(*) FROM public.tasks WHERE project_id = 'a0000000-0000-0000-0000-0000000000f1'$q$, 2);
SELECT pg_temp.expect_count('member cannot read owner private task', '00000000-0000-0000-0000-00000000f002',
  $q$SELECT count(*) FROM public.tasks WHERE id = 'b0000000-0000-0000-0000-0000000000f3'$q$, 0);
SELECT pg_temp.expect_count('outsider reads only own tasks', '00000000-0000-0000-0000-00000000f003',
  $q$SELECT count(*) FROM public.tasks$q$, 1);
SELECT pg_temp.expect_ok('member edits owner shared task', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.tasks SET description = 'by member' WHERE id = 'b0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('outsider cannot edit shared task', '00000000-0000-0000-0000-00000000f003',
  $q$UPDATE public.tasks SET title = 'x' WHERE id = 'b0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('outsider cannot delete shared task', '00000000-0000-0000-0000-00000000f003',
  $q$DELETE FROM public.tasks WHERE id = 'b0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('outsider cannot move own task into shared project', '00000000-0000-0000-0000-00000000f003',
  $q$UPDATE public.tasks SET project_id = 'a0000000-0000-0000-0000-0000000000f1' WHERE id = 'b0000000-0000-0000-0000-0000000000f4'$q$);
SELECT pg_temp.expect_denied('member cannot trash owner task', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.tasks SET deleted_at = now() WHERE id = 'b0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('member cannot hard-delete owner task', '00000000-0000-0000-0000-00000000f002',
  $q$DELETE FROM public.tasks WHERE id = 'b0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('member cannot claim owner task (user_id immutable)', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.tasks SET user_id = '00000000-0000-0000-0000-00000000f002' WHERE id = 'b0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('owner cannot hand private task away (user_id immutable)', '00000000-0000-0000-0000-00000000f001',
  $q$UPDATE public.tasks SET user_id = '00000000-0000-0000-0000-00000000f003' WHERE id = 'b0000000-0000-0000-0000-0000000000f3'$q$);
SELECT pg_temp.expect_ok('creator trashes own shared task', '00000000-0000-0000-0000-00000000f001',
  $q$UPDATE public.tasks SET deleted_at = now() WHERE id = 'b0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('member cannot restore owner task', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.tasks SET deleted_at = NULL WHERE id = 'b0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_ok('creator restores own shared task', '00000000-0000-0000-0000-00000000f001',
  $q$UPDATE public.tasks SET deleted_at = NULL WHERE id = 'b0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_ok('member trashes own shared task', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.tasks SET deleted_at = now() WHERE id = 'b0000000-0000-0000-0000-0000000000f2'$q$);
SELECT pg_temp.expect_ok('project owner restores member task', '00000000-0000-0000-0000-00000000f001',
  $q$UPDATE public.tasks SET deleted_at = NULL WHERE id = 'b0000000-0000-0000-0000-0000000000f2'$q$);

-- Notes -------------------------------------------------------------------------------------------
SELECT pg_temp.expect_count('member reads shared notes', '00000000-0000-0000-0000-00000000f002',
  $q$SELECT count(*) FROM public.notes WHERE project_id = 'a0000000-0000-0000-0000-0000000000f1'$q$, 2);
SELECT pg_temp.expect_count('member cannot read owner private note', '00000000-0000-0000-0000-00000000f002',
  $q$SELECT count(*) FROM public.notes WHERE id = 'd0000000-0000-0000-0000-0000000000f2'$q$, 0);
SELECT pg_temp.expect_count('outsider reads only own notes', '00000000-0000-0000-0000-00000000f003',
  $q$SELECT count(*) FROM public.notes$q$, 1);
SELECT pg_temp.expect_ok('member edits owner shared note', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.notes SET content = 'spec body v2' WHERE id = 'd0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('outsider cannot edit shared note', '00000000-0000-0000-0000-00000000f003',
  $q$UPDATE public.notes SET content = 'x' WHERE id = 'd0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('outsider cannot delete shared note', '00000000-0000-0000-0000-00000000f003',
  $q$DELETE FROM public.notes WHERE id = 'd0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('member cannot trash owner note', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.notes SET deleted_at = now() WHERE id = 'd0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('member cannot delete owner note', '00000000-0000-0000-0000-00000000f002',
  $q$DELETE FROM public.notes WHERE id = 'd0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('member cannot claim owner note (user_id immutable)', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.notes SET user_id = '00000000-0000-0000-0000-00000000f002' WHERE id = 'd0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_ok('project owner trashes member note', '00000000-0000-0000-0000-00000000f001',
  $q$UPDATE public.notes SET deleted_at = now() WHERE id = 'd0000000-0000-0000-0000-0000000000f3'$q$);
SELECT pg_temp.expect_ok('member restores own note', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.notes SET deleted_at = NULL WHERE id = 'd0000000-0000-0000-0000-0000000000f3'$q$);

-- Task dependencies -------------------------------------------------------------------------------
SELECT pg_temp.expect_count('member reads shared dependency', '00000000-0000-0000-0000-00000000f002',
  $q$SELECT count(*) FROM public.task_dependencies WHERE id = 'c0000000-0000-0000-0000-0000000000f1'$q$, 1);
SELECT pg_temp.expect_count('outsider cannot read shared dependency', '00000000-0000-0000-0000-00000000f003',
  $q$SELECT count(*) FROM public.task_dependencies$q$, 0);
SELECT pg_temp.expect_denied('outsider cannot delete shared dependency', '00000000-0000-0000-0000-00000000f003',
  $q$DELETE FROM public.task_dependencies WHERE id = 'c0000000-0000-0000-0000-0000000000f1'$q$);
SELECT pg_temp.expect_denied('outsider cannot link own task to a shared one', '00000000-0000-0000-0000-00000000f003',
  $q$INSERT INTO public.task_dependencies (user_id, blocker_id, blocked_id) VALUES ('00000000-0000-0000-0000-00000000f003', 'b0000000-0000-0000-0000-0000000000f4', 'b0000000-0000-0000-0000-0000000000f2')$q$);
SELECT pg_temp.expect_denied('member cannot insert dependency as owner', '00000000-0000-0000-0000-00000000f002',
  $q$INSERT INTO public.task_dependencies (user_id, blocker_id, blocked_id) VALUES ('00000000-0000-0000-0000-00000000f001', 'b0000000-0000-0000-0000-0000000000f2', 'b0000000-0000-0000-0000-0000000000f1')$q$);
SELECT pg_temp.expect_denied('member cannot link owner private task', '00000000-0000-0000-0000-00000000f002',
  $q$INSERT INTO public.task_dependencies (user_id, blocker_id, blocked_id) VALUES ('00000000-0000-0000-0000-00000000f002', 'b0000000-0000-0000-0000-0000000000f3', 'b0000000-0000-0000-0000-0000000000f2')$q$);
SELECT pg_temp.expect_denied('member cannot claim dependency (user_id immutable)', '00000000-0000-0000-0000-00000000f002',
  $q$UPDATE public.task_dependencies SET user_id = '00000000-0000-0000-0000-00000000f002' WHERE id = 'c0000000-0000-0000-0000-0000000000f1'$q$);

-- RPCs --------------------------------------------------------------------------------------------
DO $$
DECLARE
  owner constant uuid := '00000000-0000-0000-0000-00000000f001';
  member constant uuid := '00000000-0000-0000-0000-00000000f002';
  outsider constant uuid := '00000000-0000-0000-0000-00000000f003';
  n1 constant uuid := 'd0000000-0000-0000-0000-0000000000f1';
  t1 constant uuid := 'b0000000-0000-0000-0000-0000000000f1';
  t2 constant uuid := 'b0000000-0000-0000-0000-0000000000f2';
  r jsonb;
  n int;
BEGIN
  -- note_backlinks: owner and member see the member's linking note, never the outsider's; the
  -- outsider only sees their own note.
  PERFORM pg_temp.login(owner);
  IF (SELECT array_agg(id) FROM public.note_backlinks(n1, 'spec', ARRAY[]::text[]) WHERE linked)
     IS DISTINCT FROM ARRAY['d0000000-0000-0000-0000-0000000000f3'::uuid] THEN
    RAISE EXCEPTION 'FAIL owner backlinks';
  END IF;
  PERFORM pg_temp.login(member);
  IF (SELECT array_agg(id) FROM public.note_backlinks(n1, 'spec', ARRAY[]::text[]) WHERE linked)
     IS DISTINCT FROM ARRAY['d0000000-0000-0000-0000-0000000000f3'::uuid] THEN
    RAISE EXCEPTION 'FAIL member backlinks';
  END IF;
  PERFORM pg_temp.login(outsider);
  IF (SELECT array_agg(id) FROM public.note_backlinks(n1, 'spec', ARRAY[]::text[]))
     IS DISTINCT FROM ARRAY['d0000000-0000-0000-0000-0000000000f4'::uuid] THEN
    RAISE EXCEPTION 'FAIL outsider backlinks leak shared notes';
  END IF;
  RAISE NOTICE 'ok   note_backlinks scoped by RLS';

  -- shift_task_dependents: the outsider shifts nothing; the member shifts the shared dependent.
  PERFORM pg_temp.login(outsider);
  SELECT count(*) INTO n FROM public.shift_task_dependents(t1, 86400000);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL outsider shifted % task(s)', n; END IF;
  PERFORM pg_temp.login(member);
  SELECT count(*) INTO n FROM public.shift_task_dependents(t1, 86400000);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL member shift: %', n; END IF;
  RAISE NOTICE 'ok   shift_task_dependents scoped by RLS';

  -- complete_task: the outsider can neither see nor impersonate; the member completes shared
  -- tasks (blocked check first) without changing ownership.
  PERFORM pg_temp.login(outsider);
  BEGIN
    PERFORM public.complete_task(t1);
    RAISE EXCEPTION 'FAIL outsider completed a shared task';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_task(t1, 'UTC', owner);
    RAISE EXCEPTION 'FAIL outsider acted for the owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.login(member);
  r := public.complete_task(t2);
  IF r ->> 'status' <> 'blocked' OR r ->> 'blocker' <> 'T1' THEN
    RAISE EXCEPTION 'FAIL expected T2 blocked by T1: %', r;
  END IF;
  r := public.complete_task(t1);
  IF r ->> 'status' <> 'ok' OR r -> 'unblocked' -> 0 ->> 'id' <> t2::text THEN
    RAISE EXCEPTION 'FAIL member completes T1: %', r;
  END IF;
  PERFORM pg_temp.logout();
  IF (SELECT status FROM public.tasks WHERE id = t1) <> 'done'
     OR (SELECT user_id FROM public.tasks WHERE id = t1) <> owner THEN
    RAISE EXCEPTION 'FAIL completed task changed status/owner unexpectedly';
  END IF;
  RAISE NOTICE 'ok   complete_task scoped by RLS';
END $$;

SELECT 'rls_team_access: all checks passed' AS result;

ROLLBACK;

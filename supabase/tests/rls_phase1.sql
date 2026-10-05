-- RLS regression checks for plan items 1.3 (private note collaboration channels) and
-- 1.4 (ownership / user_id spoofing in shared projects).
--
-- Run against a database with all migrations in drizzle/migrations applied, as a superuser:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_phase1.sql
-- Everything runs in one transaction that is rolled back. A failed expectation raises an
-- exception (non-zero exit); success ends with "rls_phase1: all checks passed".
-- The realtime section is skipped with a notice when `realtime.messages` does not exist.

BEGIN;

-- Helpers ---------------------------------------------------------------------------------------

-- Act as a signed-in user (sets both the legacy and the current JWT claim settings).
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

-- The statement must be rejected: either an insufficient_privilege error (RLS WITH CHECK or the
-- guard triggers) or zero affected rows (RLS USING hides the row).
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
    n := 0; -- subtransaction rolled back, role restored
  END;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL %: expected denial, % row(s) affected', _label, n;
  END IF;
  RAISE NOTICE 'ok   % (denied)', _label;
END $$;

-- `SELECT count(*) ...` as the user must equal `_expected`.
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
-- owner  = project owner, member = project member, stranger = unrelated user.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'member@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'stranger@example.test');

INSERT INTO public.projects (id, user_id, name) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Shared'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c3', 'Stranger project');
INSERT INTO public.project_members (project_id, user_id) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2');

INSERT INTO public.tasks (id, user_id, project_id, title) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Owner task'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', 'Member task');
INSERT INTO public.notes (id, user_id, project_id, title) VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Shared note'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', NULL, 'Private note');
INSERT INTO public.milestones (id, user_id, project_id, title) VALUES
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'M1');
INSERT INTO public.canvas_boards (id, user_id, project_id, title) VALUES
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Board');
INSERT INTO public.canvas_nodes (id, board_id, user_id, title) VALUES
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Owner node');

-- 1.4: projects -------------------------------------------------------------------------------
SELECT pg_temp.expect_count('member sees shared project', '00000000-0000-0000-0000-0000000000b2',
  $q$SELECT count(*) FROM public.projects WHERE id = '10000000-0000-0000-0000-000000000001'$q$, 1);
SELECT pg_temp.expect_denied('member cannot take over project (user_id)', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.projects SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = '10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot rename project', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.projects SET name = 'Hijacked' WHERE id = '10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot trash project', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.projects SET deleted_at = now() WHERE id = '10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot delete project', '00000000-0000-0000-0000-0000000000b2',
  $q$DELETE FROM public.projects WHERE id = '10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('owner cannot give project away (user_id immutable)', '00000000-0000-0000-0000-0000000000a1',
  $q$UPDATE public.projects SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = '10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_ok('owner updates project', '00000000-0000-0000-0000-0000000000a1',
  $q$UPDATE public.projects SET name = 'Shared v2' WHERE id = '10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('cannot create project for someone else', '00000000-0000-0000-0000-0000000000b2',
  $q$INSERT INTO public.projects (user_id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Spoofed')$q$);

-- 1.4: tasks ----------------------------------------------------------------------------------
SELECT pg_temp.expect_denied('member cannot insert task as owner (spoofed user_id)', '00000000-0000-0000-0000-0000000000b2',
  $q$INSERT INTO public.tasks (user_id, project_id, title) VALUES ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Spoofed')$q$);
SELECT pg_temp.expect_ok('member inserts own task in shared project', '00000000-0000-0000-0000-0000000000b2',
  $q$INSERT INTO public.tasks (user_id, project_id, title) VALUES ('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', 'Mine')$q$);
SELECT pg_temp.expect_denied('stranger cannot insert into shared project', '00000000-0000-0000-0000-0000000000c3',
  $q$INSERT INTO public.tasks (user_id, project_id, title) VALUES ('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-000000000001', 'Intruder')$q$);
SELECT pg_temp.expect_ok('member edits owner task (collaboration)', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.tasks SET status = 'in_progress', title = 'Edited' WHERE id = '20000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_ok('member archives owner task', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.tasks SET archived_at = now() WHERE id = '20000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot claim owner task (user_id)', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.tasks SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = '20000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot trash owner task', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.tasks SET deleted_at = now() WHERE id = '20000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot hard-delete owner task', '00000000-0000-0000-0000-0000000000b2',
  $q$DELETE FROM public.tasks WHERE id = '20000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot move task into a foreign project', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.tasks SET project_id = '10000000-0000-0000-0000-000000000002' WHERE id = '20000000-0000-0000-0000-000000000002'$q$);
SELECT pg_temp.expect_ok('member trashes own task', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.tasks SET deleted_at = now() WHERE id = '20000000-0000-0000-0000-000000000002'$q$);
SELECT pg_temp.expect_ok('project owner restores member task', '00000000-0000-0000-0000-0000000000a1',
  $q$UPDATE public.tasks SET deleted_at = NULL WHERE id = '20000000-0000-0000-0000-000000000002'$q$);
SELECT pg_temp.expect_ok('project owner deletes member task', '00000000-0000-0000-0000-0000000000a1',
  $q$DELETE FROM public.tasks WHERE id = '20000000-0000-0000-0000-000000000002'$q$);
SELECT pg_temp.expect_count('stranger sees no shared tasks', '00000000-0000-0000-0000-0000000000c3',
  $q$SELECT count(*) FROM public.tasks WHERE project_id = '10000000-0000-0000-0000-000000000001'$q$, 0);

-- 1.4: notes ----------------------------------------------------------------------------------
SELECT pg_temp.expect_ok('member edits shared note', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.notes SET title = 'Edited by member' WHERE id = '30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot claim shared note', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.notes SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = '30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot trash owner note', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.notes SET deleted_at = now() WHERE id = '30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot delete owner note', '00000000-0000-0000-0000-0000000000b2',
  $q$DELETE FROM public.notes WHERE id = '30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot insert note as owner', '00000000-0000-0000-0000-0000000000b2',
  $q$INSERT INTO public.notes (user_id, project_id, title) VALUES ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Spoofed')$q$);
SELECT pg_temp.expect_count('member cannot see private note', '00000000-0000-0000-0000-0000000000b2',
  $q$SELECT count(*) FROM public.notes WHERE id = '30000000-0000-0000-0000-000000000002'$q$, 0);

-- 1.4: milestones -----------------------------------------------------------------------------
SELECT pg_temp.expect_ok('member edits milestone', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.milestones SET done = true WHERE id = '40000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot claim milestone', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.milestones SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE id = '40000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot delete owner milestone', '00000000-0000-0000-0000-0000000000b2',
  $q$DELETE FROM public.milestones WHERE id = '40000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot insert milestone as owner', '00000000-0000-0000-0000-0000000000b2',
  $q$INSERT INTO public.milestones (user_id, project_id, title) VALUES ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Spoofed')$q$);

-- 1.4: canvas ---------------------------------------------------------------------------------
SELECT pg_temp.expect_count('member sees owner node', '00000000-0000-0000-0000-0000000000b2',
  $q$SELECT count(*) FROM public.canvas_nodes WHERE id = '60000000-0000-0000-0000-000000000001'$q$, 1);
SELECT pg_temp.expect_denied('member cannot claim owner node', '00000000-0000-0000-0000-0000000000b2',
  $q$UPDATE public.canvas_nodes SET user_id = '00000000-0000-0000-0000-0000000000b2', title = 'x' WHERE id = '60000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_denied('member cannot delete owner node', '00000000-0000-0000-0000-0000000000b2',
  $q$DELETE FROM public.canvas_nodes WHERE id = '60000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_ok('member adds own node', '00000000-0000-0000-0000-0000000000b2',
  $q$INSERT INTO public.canvas_nodes (board_id, user_id, title) VALUES ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'Member node')$q$);

-- 1.3: realtime.messages (note-collab topics) -------------------------------------------------
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE 'skip realtime checks: realtime.messages does not exist';
    RETURN;
  END IF;
  -- Topic validation never raises and only accepts canonical lowercase uuids.
  IF public.note_collab_topic_note_id('note-collab:not-a-uuid') IS NOT NULL
     OR public.note_collab_topic_note_id('note-collab:30000000-0000-0000-0000-000000000001; drop') IS NOT NULL
     OR public.note_collab_topic_note_id('other:30000000-0000-0000-0000-000000000001') IS NOT NULL
     OR public.note_collab_topic_note_id(NULL) IS NOT NULL
     OR public.note_collab_topic_note_id('note-collab:30000000-0000-0000-0000-000000000001') IS DISTINCT FROM '30000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'FAIL note_collab_topic_note_id parsing';
  END IF;
  RAISE NOTICE 'ok   topic parsing';
END $$;

DO $$
DECLARE
  shared constant text := 'note-collab:30000000-0000-0000-0000-000000000001';
  priv constant text := 'note-collab:30000000-0000-0000-0000-000000000002';
  ins constant text := $q$INSERT INTO realtime.messages (topic, extension, event, payload, private) SELECT realtime.topic(), 'broadcast', 'y-update', '{}'::jsonb, true$q$;
  sel constant text := $q$SELECT count(*) FROM realtime.messages WHERE topic = realtime.topic()$q$;
  owner constant uuid := '00000000-0000-0000-0000-0000000000a1';
  member constant uuid := '00000000-0000-0000-0000-0000000000b2';
  stranger constant uuid := '00000000-0000-0000-0000-0000000000c3';
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN RETURN; END IF;
  -- Realtime sets `realtime.topic` per connection; realtime.topic() reads it.
  PERFORM set_config('realtime.topic', shared, true);
  PERFORM pg_temp.expect_ok('owner broadcasts on shared note', owner, ins);
  PERFORM pg_temp.expect_ok('member broadcasts on shared note', member, ins);
  PERFORM pg_temp.expect_denied('stranger cannot broadcast on shared note', stranger, ins);
  PERFORM pg_temp.expect_count('member receives shared note messages', member, sel, 2);
  PERFORM pg_temp.expect_count('stranger receives nothing', stranger, sel, 0);
  PERFORM set_config('realtime.topic', priv, true);
  PERFORM pg_temp.expect_denied('member cannot broadcast on private note', member, ins);
  PERFORM pg_temp.expect_ok('owner broadcasts on private note', owner, ins);
  PERFORM set_config('realtime.topic', 'note-collab:garbage', true);
  PERFORM pg_temp.expect_denied('invalid topic is rejected', owner, ins);
  -- Trashed notes close their channel.
  UPDATE public.notes SET deleted_at = now() WHERE id = '30000000-0000-0000-0000-000000000001';
  PERFORM set_config('realtime.topic', shared, true);
  PERFORM pg_temp.expect_count('trashed note channel is closed', owner, sel, 0);
END $$;

SELECT 'rls_phase1: all checks passed' AS result;

ROLLBACK;

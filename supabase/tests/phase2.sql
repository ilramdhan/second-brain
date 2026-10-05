-- Checks for Phase 2 database hardening (migrations 0013-0016).
--
-- Run as a superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase2.sql
-- Re-run supabase/tests/rls_phase1.sql as well: 0015 rewrites the 0010 policies, and that file
-- checks their rules. Everything runs in one transaction that is rolled back; success ends with
-- "phase2: all checks passed".

BEGIN;

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

-- 2.1 One audit trigger per table -------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tgrelid::regclass AS tbl, count(*) AS n
    FROM pg_trigger
    WHERE NOT tgisinternal AND tgfoid = 'public.audit_row_change'::regproc
    GROUP BY tgrelid
  LOOP
    IF r.n <> 1 THEN RAISE EXCEPTION 'FAIL % has % audit triggers', r.tbl, r.n; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT tgrelid) FROM pg_trigger
      WHERE NOT tgisinternal AND tgfoid = 'public.audit_row_change'::regproc) <> 17 THEN
    RAISE EXCEPTION 'FAIL expected 17 audited tables';
  END IF;
  -- The remaining trigger fires AFTER INSERT, UPDATE and DELETE, FOR EACH ROW
  -- (tgtype bits: 1 row, 4 insert, 8 delete, 16 update; BEFORE bit 2 unset).
  IF EXISTS (SELECT 1 FROM pg_trigger
             WHERE NOT tgisinternal AND tgfoid = 'public.audit_row_change'::regproc
               AND (tgtype & (1 | 2 | 4 | 8 | 16)) <> (1 | 4 | 8 | 16)) THEN
    RAISE EXCEPTION 'FAIL an audit trigger does not cover AFTER INSERT/UPDATE/DELETE FOR EACH ROW';
  END IF;
  RAISE NOTICE 'ok   one AFTER I/U/D audit trigger per table';
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'p2-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'p2-member@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'p2-stranger@example.test');

DO $$
DECLARE
  owner constant uuid := '00000000-0000-0000-0000-0000000000a1';
  t uuid := '20000000-0000-0000-0000-0000000000f1';
  n int;
BEGIN
  DELETE FROM public.activity_logs;
  PERFORM pg_temp.login(owner);
  INSERT INTO public.tasks (id, user_id, title) VALUES (t, owner, 'Audit me');
  SELECT count(*) INTO n FROM public.activity_logs WHERE entity_id = t AND action = 'insert';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL insert wrote % audit rows', n; END IF;

  UPDATE public.tasks SET title = 'Audit me v2' WHERE id = t;
  SELECT count(*) INTO n FROM public.activity_logs WHERE entity_id = t AND action = 'update';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL update wrote % audit rows', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.activity_logs WHERE entity_id = t AND action = 'update'
                 AND metadata -> 'changed_fields' = '["title"]'::jsonb AND user_id = owner) THEN
    RAISE EXCEPTION 'FAIL update audit row lacks changed_fields ["title"]';
  END IF;

  -- No-op update (same values, or only updated_at) is not logged.
  UPDATE public.tasks SET title = 'Audit me v2' WHERE id = t;
  UPDATE public.tasks SET updated_at = now() + interval '1 second' WHERE id = t;
  SELECT count(*) INTO n FROM public.activity_logs WHERE entity_id = t AND action = 'update';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL no-op updates were logged (% update rows)', n; END IF;

  -- Changing hidden fields is still logged, without listing them.
  UPDATE public.tasks SET description = 'secret' WHERE id = t;
  SELECT count(*) INTO n FROM public.activity_logs WHERE entity_id = t AND action = 'update';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL description change not logged'; END IF;
  IF EXISTS (SELECT 1 FROM public.activity_logs WHERE entity_id = t
             AND metadata -> 'changed_fields' ? 'description') THEN
    RAISE EXCEPTION 'FAIL description listed in changed_fields';
  END IF;

  DELETE FROM public.tasks WHERE id = t;
  SELECT count(*) INTO n FROM public.activity_logs WHERE entity_id = t AND action = 'delete';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL delete wrote % audit rows', n; END IF;
  PERFORM pg_temp.logout();

  -- Templates and profiles are audited once as well.
  INSERT INTO public.templates (user_id, kind, name) VALUES (owner, 'task', 'T');
  UPDATE public.profiles SET display_name = 'Owner' WHERE id = owner;
  IF (SELECT count(*) FROM public.activity_logs WHERE entity_type = 'templates') <> 1
     OR (SELECT count(*) FROM public.activity_logs WHERE entity_type = 'profiles' AND action = 'update') <> 1 THEN
    RAISE EXCEPTION 'FAIL templates/profiles audit row count';
  END IF;
  RAISE NOTICE 'ok   one audit row per write; no-op updates skipped';
END $$;

-- 2.2 Indexes ---------------------------------------------------------------------------------
DO $$
DECLARE missing text[];
BEGIN
  SELECT array_agg(i) INTO missing
  FROM unnest(ARRAY[
    'tasks_user_active_idx', 'tasks_project_idx', 'tasks_parent_idx', 'tasks_milestone_idx',
    'tasks_reminder_idx', 'notes_user_active_idx', 'notes_project_idx', 'projects_user_idx',
    'projects_parent_idx', 'project_members_user_idx', 'project_invites_email_lower_idx',
    'project_invites_invited_by_idx', 'milestones_project_idx', 'milestones_user_idx',
    'task_dependencies_blocked_idx', 'task_dependencies_user_idx', 'task_comments_task_idx',
    'task_comments_user_idx', 'time_entries_task_idx', 'time_entries_project_idx',
    'note_versions_user_idx', 'inbox_items_user_status_idx', 'automations_user_idx',
    'automation_runs_user_created_idx', 'automation_runs_automation_idx',
    'automation_runs_task_idx', 'canvas_boards_user_idx', 'canvas_boards_project_idx',
    'canvas_nodes_board_idx', 'canvas_nodes_user_idx', 'canvas_edges_board_idx',
    'canvas_edges_source_idx', 'canvas_edges_target_idx', 'canvas_edges_user_idx',
    'templates_user_idx', 'n8n_events_user_idx', 'tasks_assignee_idx'
  ]) i
  WHERE to_regclass('public.' || i) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'FAIL missing indexes: %', missing; END IF;
  IF to_regclass('public.profiles_telegram_chat_uq') IS NULL
     AND to_regclass('public.profiles_telegram_chat_idx') IS NULL THEN
    RAISE EXCEPTION 'FAIL missing profiles telegram_chat_id index';
  END IF;

  -- Every single-column FK in public has an index whose first column is the FK column.
  SELECT array_agg(format('%s.%s', c.conrelid::regclass, a.attname)) INTO missing
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
    AND cardinality(c.conkey) = 1
    AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'FAIL FK columns without index: %', missing; END IF;
  RAISE NOTICE 'ok   indexes present, every FK column indexed';
END $$;

-- 2.3 Policies use (select auth.uid()); helpers are STABLE -----------------------------------
DO $$
DECLARE bad text[];
BEGIN
  SELECT array_agg(tablename || '.' || policyname) INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                       '\( SELECT auth\.uid\(\) AS uid\)|\( SELECT uid\(\) AS uid\)', '', 'g')
        ~ 'uid\(\)';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL policies calling auth.uid() per row: %', bad; END IF;

  SELECT array_agg(p.oid::regprocedure::text) INTO bad
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('is_project_owner', 'is_project_member', 'can_access_task', 'can_access_note',
                      'can_access_canvas_board', 'is_canvas_board_owner', 'my_project_ids')
    AND (p.provolatile <> 's' OR NOT p.prosecdef);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL helpers not STABLE SECURITY DEFINER: %', bad; END IF;
  RAISE NOTICE 'ok   no per-row auth.uid() in policies; helpers STABLE';
END $$;

-- my_project_ids() matches is_project_member() for owner, member and stranger.
INSERT INTO public.projects (id, user_id, name) VALUES
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'P2 shared'),
  ('10000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c3', 'P2 stranger');
INSERT INTO public.project_members (project_id, user_id) VALUES
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b2');
DO $$
DECLARE u uuid; mine uuid[]; expected uuid[];
BEGIN
  FOREACH u IN ARRAY ARRAY['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2',
                           '00000000-0000-0000-0000-0000000000c3']::uuid[]
  LOOP
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO expected
    FROM public.projects WHERE public.is_project_member(id, u);
    PERFORM pg_temp.login(u);
    SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO mine FROM public.my_project_ids() x;
    PERFORM pg_temp.logout();
    IF mine IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'FAIL my_project_ids for %: % vs %', u, mine, expected;
    END IF;
  END LOOP;
  PERFORM pg_temp.login(NULL);
  IF EXISTS (SELECT 1 FROM public.my_project_ids()) THEN RAISE EXCEPTION 'FAIL anonymous project ids'; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   my_project_ids matches is_project_member';
END $$;

-- The task list uses the indexes (no sequential scan) when run as a user.
SET LOCAL enable_seqscan = off;
DO $$
DECLARE plan text;
BEGIN
  PERFORM pg_temp.login('00000000-0000-0000-0000-0000000000b2');
  EXECUTE 'EXPLAIN (COSTS OFF) SELECT * FROM public.tasks WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY position, created_at'
    INTO plan;
  PERFORM pg_temp.logout();
  IF plan LIKE '%Seq Scan%' THEN RAISE EXCEPTION 'FAIL task list plan: %', plan; END IF;
  RAISE NOTICE 'ok   task list can use indexes under RLS';
END $$;
RESET enable_seqscan;

-- 2.4 Constraints -----------------------------------------------------------------------------
DO $$
DECLARE bad text[];
BEGIN
  SELECT array_agg(conrelid::regclass || '.' || conname) INTO bad
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL constraints left NOT VALID: %', bad; END IF;

  -- Every user_id column references auth.users (activity_logs is purged by a trigger instead).
  SELECT array_agg(c.table_name) INTO bad
  FROM information_schema.columns c
  JOIN information_schema.tables t USING (table_schema, table_name)
  WHERE c.table_schema = 'public' AND c.column_name = 'user_id' AND t.table_type = 'BASE TABLE'
    AND c.table_name <> 'activity_logs'
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint k
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND k.conrelid = ('public.' || c.table_name)::regclass
        AND a.attname = 'user_id' AND k.confrelid = 'auth.users'::regclass
    );
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL user_id without FK to auth.users: %', bad; END IF;
  RAISE NOTICE 'ok   all constraints validated; every user_id references auth.users';
END $$;

DO $$
DECLARE owner constant uuid := '00000000-0000-0000-0000-0000000000a1';
BEGIN
  BEGIN
    INSERT INTO public.tasks (user_id, title, recurrence) VALUES (owner, 'x', 'yearly');
    RAISE EXCEPTION 'FAIL recurrence yearly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.notes (user_id, title, status) VALUES (owner, 'x', 'published');
    RAISE EXCEPTION 'FAIL note status published accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.projects (user_id, name, status) VALUES (owner, 'x', 'archived');
    RAISE EXCEPTION 'FAIL project status archived accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.project_members (project_id, user_id, role)
    VALUES ('10000000-0000-0000-0000-0000000000f2', owner, 'admin');
    RAISE EXCEPTION 'FAIL member role admin accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tasks (user_id, title) VALUES ('00000000-0000-0000-0000-00000000dead', 'orphan');
    RAISE EXCEPTION 'FAIL task for unknown user accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  -- Values the app writes are accepted.
  INSERT INTO public.tasks (user_id, title, status, priority, recurrence) VALUES
    (owner, 'a', 'todo', 'high', NULL), (owner, 'b', 'in_progress', 'medium', 'daily'),
    (owner, 'c', 'review', 'low', 'weekly'), (owner, 'd', 'done', 'medium', 'monthly');
  INSERT INTO public.notes (user_id, title, status) VALUES
    (owner, 'a', 'idea'), (owner, 'b', 'draft'), (owner, 'c', 'final');
  INSERT INTO public.projects (user_id, name, status) VALUES
    (owner, 'a', 'planning'), (owner, 'b', 'active'), (owner, 'c', 'on_hold'), (owner, 'd', 'done');
  RAISE NOTICE 'ok   CHECK and FK constraints enforced';
END $$;

-- Deleting an account removes its rows; assignments to it are cleared.
DO $$
DECLARE
  owner constant uuid := '00000000-0000-0000-0000-0000000000a1';
  member constant uuid := '00000000-0000-0000-0000-0000000000b2';
  t uuid;
BEGIN
  INSERT INTO public.tasks (user_id, title, assignee_id) VALUES (owner, 'assigned', member) RETURNING id INTO t;
  INSERT INTO public.inbox_items (user_id, content) VALUES (member, 'x');
  DELETE FROM auth.users WHERE id = member;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = member)
     OR EXISTS (SELECT 1 FROM public.inbox_items WHERE user_id = member)
     OR EXISTS (SELECT 1 FROM public.project_members WHERE user_id = member)
     OR EXISTS (SELECT 1 FROM public.activity_logs WHERE user_id = member) THEN
    RAISE EXCEPTION 'FAIL account deletion left rows behind';
  END IF;
  IF (SELECT assignee_id FROM public.tasks WHERE id = t) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL assignee_id not cleared';
  END IF;
  RAISE NOTICE 'ok   account deletion cascades';
END $$;

SELECT 'phase2: all checks passed' AS result;

ROLLBACK;

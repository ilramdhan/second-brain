-- Checks for migration 0019 (demo row limits, text sizes, write quota, demo account protection).
--
-- Run with psql (it uses \ir to re-apply the migration, which also checks it is idempotent) as a
-- superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/demo_limits.sql
-- Everything runs in one transaction that is rolled back; success ends with
-- "demo_limits: all checks passed".

BEGIN;

\ir ../../drizzle/migrations/0019_demo_limits.sql

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

-- Runs _sql and returns the error message, or NULL when it succeeded.
CREATE FUNCTION pg_temp.try(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END;
$$;

INSERT INTO auth.users (id, email, encrypted_password) VALUES
  ('00000000-0000-0000-0000-00000000f001', 'Demo@Example.test', 'hash-demo'),
  ('00000000-0000-0000-0000-00000000f002', 'other@example.test', 'hash-other');

DELETE FROM public.app_config WHERE key = 'demo_mode' OR key LIKE 'demo\_%';

DO $$
DECLARE
  a uuid := '00000000-0000-0000-0000-00000000f001';
  b uuid := '00000000-0000-0000-0000-00000000f002';
  err text;
BEGIN
  -- Demo off (production): no row limits, no size caps, no quota, account editable.
  INSERT INTO public.app_config (key, value) VALUES ('demo_limit:tasks', '3'), ('demo_write_max', '1');
  PERFORM pg_temp.as_role('authenticated', a);
  FOR i IN 1..5 LOOP
    err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title) VALUES (%L, 'off %s')$q$, a, i));
    IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL demo off: insert % refused: %', i, err; END IF;
  END LOOP;
  err := pg_temp.try(format($q$UPDATE public.tasks SET description = repeat('x', 5000) WHERE user_id = %L$q$, a));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL demo off: long description refused: %', err; END IF;
  PERFORM pg_temp.reset();
  IF EXISTS (SELECT 1 FROM public.rate_limits WHERE bucket = 'demo_write') THEN
    RAISE EXCEPTION 'FAIL demo off: write quota consumed';
  END IF;
  INSERT INTO public.app_config (key, value) VALUES ('demo_user_email', 'demo@example.test');
  UPDATE auth.users SET encrypted_password = 'hash-changed' WHERE id = a;
  UPDATE auth.users SET encrypted_password = 'hash-demo' WHERE id = a;
  DELETE FROM public.tasks WHERE user_id = a;
  RAISE NOTICE 'ok   demo off: nothing enforced';

  -- Demo on, row limit 3: the 4th insert fails with the "Batas demo" message.
  INSERT INTO public.app_config (key, value) VALUES ('demo_mode', 'on');
  UPDATE public.app_config SET value = '1000' WHERE key = 'demo_write_max';
  PERFORM pg_temp.as_role('authenticated', a);
  FOR i IN 1..3 LOOP
    err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title) VALUES (%L, 'on %s')$q$, a, i));
    IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL insert % under the limit refused: %', i, err; END IF;
  END LOOP;
  err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title) VALUES (%L, 'on 4')$q$, a));
  IF err IS NULL OR err NOT LIKE 'P0001 Batas demo: maksimal 3 tugas%' THEN
    RAISE EXCEPTION 'FAIL 4th insert should hit the limit, got %', coalesce(err, 'success');
  END IF;
  -- Soft-deleted rows still count (trash-and-recreate is not a bypass).
  UPDATE public.tasks SET deleted_at = now() WHERE user_id = a AND title = 'on 1';
  err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title) VALUES (%L, 'on 5')$q$, a));
  IF err IS NULL THEN RAISE EXCEPTION 'FAIL soft-deleted rows should still count'; END IF;
  RAISE NOTICE 'ok   row limit enforced (soft-deleted rows counted)';

  -- Default limit from the trigger argument when no demo_limit:<table> row exists (projects 20).
  FOR i IN 1..20 LOOP
    INSERT INTO public.projects (user_id, name) VALUES (a, 'P' || i);
  END LOOP;
  err := pg_temp.try(format($q$INSERT INTO public.projects (user_id, name) VALUES (%L, 'P21')$q$, a));
  IF err IS NULL OR err NOT LIKE '%maksimal 20 proyek%' THEN
    RAISE EXCEPTION 'FAIL default project limit, got %', coalesce(err, 'success');
  END IF;
  RAISE NOTICE 'ok   default limit from trigger argument';

  -- Another user has an independent count.
  PERFORM pg_temp.as_role('authenticated', b);
  err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title) VALUES (%L, 'b1')$q$, b));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL user b blocked by user a''s count: %', err; END IF;
  RAISE NOTICE 'ok   per-user counts';

  -- The service role (seed, reset, n8n) and direct connections bypass everything.
  PERFORM pg_temp.as_role('service_role', a);
  err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title, description) VALUES (%L, 'seed', repeat('x', 5000))$q$, a));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL service role limited: %', err; END IF;
  PERFORM pg_temp.reset();
  err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title) VALUES (%L, 'superuser')$q$, a));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL direct connection limited: %', err; END IF;
  RAISE NOTICE 'ok   service role and direct connections bypass';

  -- Text sizes: rejected on insert and on update; unchanged oversized values stay editable.
  PERFORM pg_temp.as_role('authenticated', b);
  err := pg_temp.try(format($q$UPDATE public.tasks SET description = repeat('x', 4001) WHERE user_id = %L$q$, b));
  IF err IS NULL OR err NOT LIKE 'P0001 Batas demo: deskripsi maksimal 4000 karakter.' THEN
    RAISE EXCEPTION 'FAIL long description accepted on update, got %', coalesce(err, 'success');
  END IF;
  err := pg_temp.try(format($q$UPDATE public.tasks SET title = repeat('t', 201) WHERE user_id = %L$q$, b));
  IF err IS NULL THEN RAISE EXCEPTION 'FAIL long title accepted'; END IF;
  err := pg_temp.try(format($q$INSERT INTO public.notes (user_id, title, content) VALUES (%L, 'n', repeat('c', 20001))$q$, b));
  IF err IS NULL OR err NOT LIKE '%isi maksimal 20000 karakter%' THEN
    RAISE EXCEPTION 'FAIL long note content accepted, got %', coalesce(err, 'success');
  END IF;
  err := pg_temp.try(format(
    $q$INSERT INTO public.notes (user_id, title, blocks) VALUES (%L, 'n', jsonb_build_array(jsonb_build_object('id', 'b1', 'text', repeat('x', 70000))))$q$, b));
  IF err IS NULL OR err NOT LIKE '%64 KB%' THEN
    RAISE EXCEPTION 'FAIL oversized blocks accepted, got %', coalesce(err, 'success');
  END IF;
  PERFORM pg_temp.as_role('authenticated', a);
  err := pg_temp.try(format($q$UPDATE public.tasks SET status = 'done' WHERE user_id = %L AND title = 'seed'$q$, a));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL unchanged oversized value blocked an update: %', err; END IF;
  RAISE NOTICE 'ok   text sizes enforced on changed values only';

  -- Project invites are disabled (limit 0, attributed by invited_by).
  err := pg_temp.try(format(
    $q$INSERT INTO public.project_invites (project_id, email, invited_by)
       SELECT id, 'x@example.test', %L FROM public.projects WHERE user_id = %L LIMIT 1$q$, a, a));
  IF err IS NULL OR err NOT LIKE 'P0001 Batas demo: undangan proyek tidak tersedia di demo.' THEN
    RAISE EXCEPTION 'FAIL invite accepted in demo, got %', coalesce(err, 'success');
  END IF;
  RAISE NOTICE 'ok   project invites blocked';

  -- Write quota: max 2 statements per window, the 3rd is refused, another user is unaffected.
  PERFORM pg_temp.reset();
  DELETE FROM public.rate_limits WHERE bucket = 'demo_write';
  UPDATE public.app_config SET value = '2' WHERE key = 'demo_write_max';
  PERFORM pg_temp.as_role('authenticated', b);
  FOR i IN 1..2 LOOP
    err := pg_temp.try(format($q$UPDATE public.tasks SET status = 'in_progress' WHERE user_id = %L$q$, b));
    IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL write % within quota refused: %', i, err; END IF;
  END LOOP;
  err := pg_temp.try(format($q$DELETE FROM public.tasks WHERE user_id = %L$q$, b));
  IF err IS NULL OR err NOT LIKE 'P0001 Batas demo: kuota tulis tercapai (2 perubahan per 60 menit)%' THEN
    RAISE EXCEPTION 'FAIL 3rd write should exceed the quota, got %', coalesce(err, 'success');
  END IF;
  PERFORM pg_temp.as_role('authenticated', a);
  err := pg_temp.try(format($q$UPDATE public.tasks SET status = 'todo' WHERE user_id = %L$q$, a));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL user a affected by user b''s quota: %', err; END IF;
  PERFORM pg_temp.reset();
  UPDATE public.app_config SET value = '1000' WHERE key = 'demo_write_max';
  RAISE NOTICE 'ok   write quota enforced per user';

  -- Clients cannot read the settings or call the helpers.
  PERFORM pg_temp.as_role('authenticated', a);
  err := pg_temp.try($q$SELECT public.demo_setting('demo_mode')$q$);
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL authenticated can call demo_setting'; END IF;
  err := pg_temp.try($q$SELECT public.demo_mode_enabled()$q$);
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL authenticated can call demo_mode_enabled'; END IF;
  PERFORM pg_temp.as_role('anon', NULL);
  err := pg_temp.try($q$SELECT public.demo_mode_enabled()$q$);
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL anon can call demo_mode_enabled'; END IF;
  PERFORM pg_temp.reset();
  RAISE NOTICE 'ok   helpers not callable by clients';

  -- auth.users: the demo account (email matched case-insensitively) is protected.
  err := pg_temp.try(format($q$UPDATE auth.users SET encrypted_password = 'hacked' WHERE id = %L$q$, a));
  IF err IS NULL OR err NOT LIKE 'P0001 Batas demo: email dan kata sandi%' THEN
    RAISE EXCEPTION 'FAIL demo password change allowed, got %', coalesce(err, 'success');
  END IF;
  err := pg_temp.try(format($q$UPDATE auth.users SET email = 'new@example.test' WHERE id = %L$q$, a));
  IF err IS NULL THEN RAISE EXCEPTION 'FAIL demo email change allowed'; END IF;
  err := pg_temp.try(format($q$UPDATE auth.users SET email_change = 'new@example.test' WHERE id = %L$q$, a));
  IF err IS NULL THEN RAISE EXCEPTION 'FAIL demo email_change allowed'; END IF;
  err := pg_temp.try(format($q$DELETE FROM auth.users WHERE id = %L$q$, a));
  IF err IS NULL OR err NOT LIKE 'P0001 Batas demo: akun demo tidak bisa dihapus.' THEN
    RAISE EXCEPTION 'FAIL demo account delete allowed, got %', coalesce(err, 'success');
  END IF;
  err := pg_temp.try(format($q$UPDATE auth.users SET last_sign_in_at = now(), raw_user_meta_data = '{"x":1}' WHERE id = %L$q$, a));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL sign-in update on demo account refused: %', err; END IF;
  err := pg_temp.try(format($q$UPDATE auth.users SET encrypted_password = 'other-new', email = 'other2@example.test' WHERE id = %L$q$, b));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL other account change refused: %', err; END IF;
  err := pg_temp.try(format($q$DELETE FROM auth.users WHERE id = %L$q$, b));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL other account delete refused: %', err; END IF;
  RAISE NOTICE 'ok   demo account protected, other accounts unaffected';

  -- Turning demo mode off lifts the protection again (needed to rotate the demo password).
  UPDATE public.app_config SET value = 'off' WHERE key = 'demo_mode';
  err := pg_temp.try(format($q$UPDATE auth.users SET encrypted_password = 'rotated' WHERE id = %L$q$, a));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL demo off should allow password rotation: %', err; END IF;
  RAISE NOTICE 'ok   demo off lifts the account protection';
END $$;

SELECT 'demo_limits: all checks passed' AS result;

ROLLBACK;

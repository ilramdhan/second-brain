-- Checks for migration 0022 (TOTP two-factor: aal2 enforced in RLS for users with a verified
-- factor, list_project_people gated, no MFA enrollment on the shared demo account).
--
-- Run with psql as a superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/mfa_aal2.sql
-- On a Postgres without GoTrue's auth.mfa_factors table a minimal stand-in is created inside the
-- transaction and the migration is re-applied (\ir), which also checks it is idempotent.
-- Everything is rolled back; success ends with "mfa_aal2: all checks passed".

BEGIN;

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  friendly_name text,
  factor_type text NOT NULL DEFAULT 'totp',
  status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

\ir ../../drizzle/migrations/0022_mfa_aal2.sql

-- Act as a signed-in user with the given assurance level.
CREATE FUNCTION pg_temp.login(_uid uuid, _aal text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', _uid::text, true),
         set_config('request.jwt.claims',
           json_build_object('sub', _uid, 'role', 'authenticated', 'aal', _aal)::text, true),
         set_config('role', 'authenticated', true);
$$;
CREATE FUNCTION pg_temp.logout() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('role', 'none', true), -- back to the session user (the superuser)
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
END $$;

INSERT INTO auth.users (id, email, encrypted_password) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'mfa@example.test', 'x'),
  ('00000000-0000-0000-0000-00000000a002', 'plain@example.test', 'x'),
  ('00000000-0000-0000-0000-00000000a003', 'Demo@Example.test', 'x');
INSERT INTO public.tasks (user_id, title) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'secret of the 2FA user'),
  ('00000000-0000-0000-0000-00000000a002', 'task of the plain user');
INSERT INTO public.projects (id, user_id, name) VALUES
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'P');
-- Verified factor for the 2FA user, an unverified (abandoned) enrollment for the plain user.
INSERT INTO auth.mfa_factors (user_id, status) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'verified'),
  ('00000000-0000-0000-0000-00000000a002', 'unverified');

DO $$
DECLARE
  mfa uuid := '00000000-0000-0000-0000-00000000a001';
  plain uuid := '00000000-0000-0000-0000-00000000a002';
  demo uuid := '00000000-0000-0000-0000-00000000a003';
  n int;
  err text;
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE policyname = 'mfa_aal2' AND schemaname = 'public'
        AND permissive = 'RESTRICTIVE') < 20 THEN
    RAISE EXCEPTION 'FAIL restrictive mfa_aal2 policies missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
       AND NOT EXISTS (SELECT 1 FROM pg_policies p
                        WHERE p.schemaname = 'public' AND p.tablename = c.relname
                          AND p.policyname = 'mfa_aal2')
  ) THEN
    RAISE EXCEPTION 'FAIL a public table with RLS has no mfa_aal2 policy';
  END IF;
  RAISE NOTICE 'ok   every RLS table has a restrictive mfa_aal2 policy';

  -- 2FA user at aal1: sees nothing, writes nothing.
  PERFORM pg_temp.login(mfa, 'aal1');
  SELECT count(*) INTO n FROM public.tasks;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL aal1 session of a 2FA user sees % task(s)', n; END IF;
  err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title) VALUES (%L, 'x')$q$, mfa));
  IF err IS NULL OR err NOT LIKE '42501%' THEN
    RAISE EXCEPTION 'FAIL aal1 insert of a 2FA user should be refused, got %', coalesce(err, 'success');
  END IF;
  UPDATE public.tasks SET title = 'changed' WHERE user_id = mfa;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL aal1 update of a 2FA user changed % row(s)', n; END IF;
  SELECT count(*) INTO n FROM public.list_project_people('00000000-0000-0000-0000-00000000b001');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL list_project_people leaks % row(s) at aal1', n; END IF;
  IF public.mfa_satisfied() THEN RAISE EXCEPTION 'FAIL mfa_satisfied() true at aal1'; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   aal1 session of a 2FA user is refused (read, insert, update, RPC)';

  -- 2FA user at aal2: normal access.
  PERFORM pg_temp.login(mfa, 'aal2');
  SELECT count(*) INTO n FROM public.tasks;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL aal2 session sees % task(s), expected 1', n; END IF;
  err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title) VALUES (%L, 'new')$q$, mfa));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL aal2 insert refused: %', err; END IF;
  SELECT count(*) INTO n FROM public.list_project_people('00000000-0000-0000-0000-00000000b001');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL list_project_people at aal2 returned %', n; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   aal2 session of a 2FA user has normal access';

  -- User without a verified factor (only an unverified enrollment): aal1 is enough.
  PERFORM pg_temp.login(plain, 'aal1');
  SELECT count(*) INTO n FROM public.tasks;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL user without 2FA sees % task(s), expected 1', n; END IF;
  err := pg_temp.try(format($q$INSERT INTO public.tasks (user_id, title) VALUES (%L, 'y')$q$, plain));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL user without 2FA insert refused: %', err; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   users without a verified factor are unaffected';

  -- Demo: the shared account cannot enroll a factor; other accounts and demo-off still can.
  INSERT INTO public.app_config (key, value) VALUES ('demo_user_email', 'demo@example.test')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO auth.mfa_factors (user_id) VALUES (demo); -- demo mode off: allowed
  INSERT INTO public.app_config (key, value) VALUES ('demo_mode', 'on')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  err := pg_temp.try(format($q$INSERT INTO auth.mfa_factors (user_id) VALUES (%L)$q$, demo));
  IF err IS NULL OR err NOT LIKE 'P0001 Batas demo: verifikasi dua langkah%' THEN
    RAISE EXCEPTION 'FAIL demo account MFA enrollment should be refused, got %', coalesce(err, 'success');
  END IF;
  err := pg_temp.try(format($q$INSERT INTO auth.mfa_factors (user_id) VALUES (%L)$q$, plain));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL other account enrollment refused in demo: %', err; END IF;
  RAISE NOTICE 'ok   demo account cannot enroll MFA';
END $$;

SELECT 'mfa_aal2: all checks passed' AS result;

ROLLBACK;

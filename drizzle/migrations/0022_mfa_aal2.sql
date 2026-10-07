-- Phase 9.2: TOTP two-factor authentication (Supabase MFA) enforced in the database.
--
-- A user with a verified MFA factor signs in at `aal1` (password, magic link or Google) and only
-- reaches `aal2` after answering a TOTP challenge. The app's client guard keeps such a session on
-- the challenge screen, but the anon key is public and the aal1 access token is a valid JWT, so
-- without this migration it could still read and write every row through PostgREST. Here:
--
--   1. public.mfa_satisfied(): true when the request's JWT is aal2, or the caller has no verified
--      factor (users without 2FA are unaffected, there is no "aal2 for everyone" switch).
--   2. A RESTRICTIVE policy `mfa_aal2` on every public table with RLS enabled (and on
--      realtime.messages when it exists), so an aal1 session of a 2FA user sees and changes
--      nothing. Restrictive policies are ANDed with the existing permissive ones; they never grant
--      access. The service role bypasses RLS and is unaffected (n8n, cron, server helpers).
--   3. list_project_people() (SECURITY DEFINER, bypasses RLS) gets the same condition.
--   4. Demo: the shared demo account may not enroll a factor (a visitor could lock everyone out).
--
-- Idempotent: functions and triggers are replaced, a policy is recreated only when it is missing or
-- differs. Tables
-- created by later migrations need their own `mfa_aal2` policy (see the DO block below; rerunning
-- this file also covers them).

-- Applying to a live database: fail fast instead of queueing behind (and in front of) app
-- queries; a lock_timeout error only means "retry" (the file is idempotent). Plain SET, not SET
-- LOCAL: it lasts for the session, which also covers drizzle-kit running every pending file in
-- one transaction.
SET lock_timeout = '5s';

-- Create or replace a trigger only when it is missing or its definition differs. `_def` is the
-- CREATE TRIGGER statement exactly as pg_get_triggerdef() prints it with an empty search_path
-- (schema-qualified names, events in the order INSERT, DELETE, UPDATE). An unchanged trigger is
-- skipped and its table is not locked; otherwise CREATE OR REPLACE TRIGGER takes SHARE ROW
-- EXCLUSIVE, which readers never wait for (DROP TRIGGER took ACCESS EXCLUSIVE). A definition that
-- prints differently on another Postgres version only costs an unnecessary replace.
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

-- 1. mfa_satisfied() ---------------------------------------------------------------------------
-- Reads the aal claim from `request.jwt.claims` (set by PostgREST/Realtime). auth.mfa_factors is
-- created by GoTrue; on a database without it (plain Postgres in local checks) nobody has factors.
CREATE OR REPLACE FUNCTION public.mfa_satisfied()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _claims text := nullif(current_setting('request.jwt.claims', true), '');
  _uid uuid := (SELECT auth.uid());
  _has_factor boolean;
BEGIN
  IF _claims IS NOT NULL AND (_claims::jsonb ->> 'aal') = 'aal2' THEN
    RETURN true;
  END IF;
  IF _uid IS NULL OR to_regclass('auth.mfa_factors') IS NULL THEN
    RETURN true;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = $1 AND f.status = ''verified'')'
    INTO _has_factor USING _uid;
  RETURN NOT _has_factor;
END;
$$;

REVOKE ALL ON FUNCTION public.mfa_satisfied() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_satisfied() TO authenticated, service_role;

-- 2. Restrictive aal2 policies -----------------------------------------------------------------
-- `(SELECT public.mfa_satisfied())` is an initplan: evaluated once per statement, not per row.
--
-- Safe on a live database: policies have no CREATE OR REPLACE, and DROP/CREATE POLICY take an
-- ACCESS EXCLUSIVE lock on the table. Dropping and recreating it on every public table in one
-- transaction deadlocks with app queries whose RLS helpers read several tables in another order.
-- So tables are visited in a fixed order (by name) and a table is only touched when its policy is
-- missing or differs (then dropped and recreated, as before); a rerun locks nothing.
CREATE OR REPLACE FUNCTION pg_temp.mfa_aal2_policy_ok(_schema name, _table name)
RETURNS boolean
LANGUAGE sql
STABLE
AS $f$
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
     WHERE p.schemaname = _schema AND p.tablename = _table AND p.policyname = 'mfa_aal2'
       AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL' AND p.roles = '{authenticated}'::name[]
       AND regexp_replace(p.qual, '\m(public\.)?mfa_satisfied\M', 'mfa_satisfied', 'g')
           = '( SELECT mfa_satisfied() AS mfa_satisfied)'
       AND regexp_replace(p.with_check, '\m(public\.)?mfa_satisfied\M', 'mfa_satisfied', 'g')
           = '( SELECT mfa_satisfied() AS mfa_satisfied)'
  )
$f$;

DO $$
DECLARE
  _t record;
BEGIN
  FOR _t IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
     ORDER BY c.relname
  LOOP
    CONTINUE WHEN pg_temp.mfa_aal2_policy_ok('public', _t.relname);
    EXECUTE format('DROP POLICY IF EXISTS mfa_aal2 ON public.%I', _t.relname);
    EXECUTE format(
      'CREATE POLICY mfa_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()))',
      _t.relname
    );
  END LOOP;

  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE 'realtime.messages not found; mfa_aal2 policy for note collaboration not created';
  ELSIF NOT pg_temp.mfa_aal2_policy_ok('realtime', 'messages') THEN
    DROP POLICY IF EXISTS mfa_aal2 ON realtime.messages;
    CREATE POLICY mfa_aal2 ON realtime.messages AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));
  END IF;
END
$$;

-- 3. list_project_people(): same body as 0002 plus the aal2 condition --------------------------
CREATE OR REPLACE FUNCTION public.list_project_people(_project_id uuid)
RETURNS TABLE(user_id uuid, display_name text, email text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.user_id, pr.display_name, u.email::text, 'owner'::text
    FROM public.projects p JOIN auth.users u ON u.id = p.user_id
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
    WHERE p.id = _project_id AND public.is_project_member(_project_id, auth.uid())
      AND public.mfa_satisfied()
  UNION ALL
  SELECT m.user_id, pr.display_name, u.email::text, m.role
    FROM public.project_members m JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN public.profiles pr ON pr.id = m.user_id
    WHERE m.project_id = _project_id AND public.is_project_member(_project_id, auth.uid())
      AND public.mfa_satisfied()
$$;
REVOKE EXECUTE ON FUNCTION public.list_project_people(uuid) FROM anon;

-- 4. Demo: no MFA enrollment on the shared demo account ----------------------------------------
-- Uses the demo settings of migration 0019 (app_config demo_mode / demo_user_email).
CREATE OR REPLACE FUNCTION public.demo_protect_mfa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _email text;
BEGIN
  IF NOT public.demo_mode_enabled() THEN
    RETURN NEW;
  END IF;
  _email := lower(btrim(public.demo_setting('demo_user_email', '')));
  IF _email <> '' AND EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id AND lower(u.email) = _email
  ) THEN
    RAISE EXCEPTION 'Batas demo: verifikasi dua langkah tidak tersedia untuk akun demo.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.demo_protect_mfa() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('auth.mfa_factors') IS NULL THEN
    RAISE NOTICE 'auth.mfa_factors not found; demo MFA guard not created';
    RETURN;
  END IF;
  PERFORM pg_temp.ensure_trigger('auth.mfa_factors', 'zz_demo_protect_mfa',
    'CREATE TRIGGER zz_demo_protect_mfa BEFORE INSERT ON auth.mfa_factors FOR EACH ROW EXECUTE FUNCTION public.demo_protect_mfa()');
END
$$;

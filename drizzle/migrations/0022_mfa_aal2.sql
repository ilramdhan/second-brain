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
-- Idempotent: functions are replaced and every policy/trigger is dropped and recreated. Tables
-- created by later migrations need their own `mfa_aal2` policy (see the DO block below; rerunning
-- this file also covers them).

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
DO $$
DECLARE
  _t record;
BEGIN
  FOR _t IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_aal2 ON public.%I', _t.relname);
    EXECUTE format(
      'CREATE POLICY mfa_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()))',
      _t.relname
    );
  END LOOP;

  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE 'realtime.messages not found; mfa_aal2 policy for note collaboration not created';
  ELSE
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
  DROP TRIGGER IF EXISTS zz_demo_protect_mfa ON auth.mfa_factors;
  CREATE TRIGGER zz_demo_protect_mfa BEFORE INSERT ON auth.mfa_factors
    FOR EACH ROW EXECUTE FUNCTION public.demo_protect_mfa();
END
$$;

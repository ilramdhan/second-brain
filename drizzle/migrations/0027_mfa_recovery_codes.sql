-- Phase 9.2 follow-up: one-time recovery codes for TOTP two-factor authentication.
--
-- A user who lost their authenticator is otherwise locked out for good (public sign-up is
-- closed and only the instance owner could delete the factor in the Supabase dashboard). In
-- Settings → Keamanan an aal2 session can generate 10 single-use codes; the plaintext is shown
-- once and only a keyed hash is stored here (src/server/mfaRecovery.server.ts). On /login the
-- TOTP step accepts one code instead: the server checks it, marks it used, drops the user's other
-- unused codes and deletes their MFA factors, so they can finish signing in and enroll again.
--
-- The table is service-role only: no policy grants `authenticated` anything and it has no
-- privileges either, so codes (even hashed) never travel through PostgREST. The restrictive
-- `mfa_aal2` policy (migration 0022) is still added because every public RLS table must carry it
-- (supabase/tests/mfa_aal2.sql). Deleting the auth user deletes their codes. Idempotent.

-- Applying to a live database: fail fast instead of queueing behind (and in front of) app
-- queries; a lock_timeout error only means "retry" (the file is idempotent). Plain SET, not SET
-- LOCAL: it lasts for the session, which also covers drizzle-kit running every pending file in
-- one transaction.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  code_hash text NOT NULL CONSTRAINT mfa_recovery_codes_code_hash_check
    CHECK (length(code_hash) BETWEEN 1 AND 200),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('public.mfa_recovery_codes_user_idx') IS NULL THEN
    CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx
      ON public.mfa_recovery_codes (user_id) WHERE used_at IS NULL;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mfa_recovery_codes'::regclass) THEN
    ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
  END IF;

  -- No permissive policy: signed-in users can neither read nor write codes (service role only).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'mfa_recovery_codes' AND policyname = 'mfa_aal2') THEN
    CREATE POLICY mfa_aal2 ON public.mfa_recovery_codes AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));
  END IF;
END $$;

REVOKE ALL ON public.mfa_recovery_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mfa_recovery_codes TO service_role;

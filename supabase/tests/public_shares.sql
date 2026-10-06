-- Checks for migration 0024 (revocable public read-only links: public.public_shares).
--
-- Covers who may create a share (note creator, project owner; not a project member who did not
-- write the note, not an outsider), that owners only see and change their own rows, the frozen
-- revoked state, the column grants (view counter, owner), the service-role view counter, the
-- cleanup on hard delete, the aal2 policy, the demo row limit and the audit trigger.
--
-- Run with psql (it uses \ir to re-apply the migration, which also checks it is idempotent) as a
-- superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/public_shares.sql
-- Everything runs in one transaction that is rolled back; success ends with
-- "public_shares: all checks passed".

BEGIN;

\ir ../../drizzle/migrations/0024_public_shares.sql

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
-- Runs _sql and returns the error (SQLSTATE + message), or NULL when it succeeded.
CREATE FUNCTION pg_temp.try(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
-- A valid-looking token hash (64 hex chars) derived from a label.
CREATE FUNCTION pg_temp.h(_label text) RETURNS text LANGUAGE sql AS $$
  SELECT encode(sha256(convert_to(_label, 'UTF8')), 'hex');
$$;

INSERT INTO auth.users (id, email, encrypted_password) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'owner@example.test', 'x'),
  ('00000000-0000-0000-0000-00000000c002', 'member@example.test', 'x'),
  ('00000000-0000-0000-0000-00000000c003', 'outsider@example.test', 'x'),
  ('00000000-0000-0000-0000-00000000c004', 'mfa@example.test', 'x');

INSERT INTO public.projects (id, user_id, name) VALUES
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'Shared project');
INSERT INTO public.project_members (project_id, user_id) VALUES
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c002');
INSERT INTO public.notes (id, user_id, project_id, title) VALUES
  -- written by the owner, in the project
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000c001',
   '00000000-0000-0000-0000-00000000d001', 'Owner note'),
  -- written by the member, in the owner's project
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000c002',
   '00000000-0000-0000-0000-00000000d001', 'Member note'),
  -- the member's private note
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-00000000c002', NULL, 'Private'),
  -- the owner's archived note
  ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-00000000c001', NULL, 'Archived'),
  -- the 2FA user's note
  ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-00000000c004', NULL, 'MFA');
UPDATE public.notes SET archived_at = now() WHERE id = '00000000-0000-0000-0000-00000000e004';
INSERT INTO auth.mfa_factors (user_id, status) VALUES ('00000000-0000-0000-0000-00000000c004', 'verified');

DELETE FROM public.app_config WHERE key = 'demo_mode' OR key LIKE 'demo\_%';

DO $$
DECLARE
  owner_id uuid := '00000000-0000-0000-0000-00000000c001';
  member uuid := '00000000-0000-0000-0000-00000000c002';
  outsider uuid := '00000000-0000-0000-0000-00000000c003';
  mfa uuid := '00000000-0000-0000-0000-00000000c004';
  project uuid := '00000000-0000-0000-0000-00000000d001';
  owner_note uuid := '00000000-0000-0000-0000-00000000e001';
  member_note uuid := '00000000-0000-0000-0000-00000000e002';
  private_note uuid := '00000000-0000-0000-0000-00000000e003';
  archived_note uuid := '00000000-0000-0000-0000-00000000e004';
  mfa_note uuid := '00000000-0000-0000-0000-00000000e005';
  share_id uuid;
  n int;
  err text;
  ins text := 'INSERT INTO public.public_shares (user_id, resource_type, resource_id, token_hash) VALUES (%L, %L, %L, %L)';
BEGIN
  -- Structure: RLS on, restrictive aal2 policy, no anon access.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.public_shares'::regclass) THEN
    RAISE EXCEPTION 'FAIL RLS is not enabled on public_shares';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'public_shares'
                   AND policyname = 'mfa_aal2' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'FAIL public_shares has no restrictive mfa_aal2 policy';
  END IF;
  IF has_table_privilege('anon', 'public.public_shares', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL anon can read public_shares';
  END IF;
  IF has_function_privilege('authenticated', 'public.record_public_share_view(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL authenticated can bump view counters';
  END IF;
  RAISE NOTICE 'ok   RLS, aal2 policy and privileges';

  -- Owner: shares own note and own project.
  PERFORM pg_temp.login(owner_id);
  err := pg_temp.try(format(ins, owner_id, 'note', owner_note, pg_temp.h('owner-note')));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL owner cannot share own note: %', err; END IF;
  err := pg_temp.try(format(ins, owner_id, 'project', project, pg_temp.h('owner-project')));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL owner cannot share own project: %', err; END IF;
  -- Project owner may share a member's note in their project.
  err := pg_temp.try(format(ins, owner_id, 'note', member_note, pg_temp.h('owner-member-note')));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL project owner cannot share member note: %', err; END IF;
  -- Not an archived note, not someone else's private note, not with a forged user_id.
  err := pg_temp.try(format(ins, owner_id, 'note', archived_note, pg_temp.h('archived')));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL archived note shared: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try(format(ins, owner_id, 'note', private_note, pg_temp.h('private')));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL private note of another user shared: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try(format(ins, member, 'note', owner_note, pg_temp.h('forged')));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL share inserted for another user: %', coalesce(err, 'success'); END IF;
  -- One active link per resource and creator.
  err := pg_temp.try(format(ins, owner_id, 'note', owner_note, pg_temp.h('owner-note-2')));
  IF err IS NULL OR err NOT LIKE '23505%' THEN RAISE EXCEPTION 'FAIL second active link allowed: %', coalesce(err, 'success'); END IF;
  -- The view counter is not writable by end users.
  err := pg_temp.try('UPDATE public.public_shares SET view_count = 999');
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL owner can set view_count: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try('SELECT public.record_public_share_view(id) FROM public.public_shares');
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL owner can call record_public_share_view: %', coalesce(err, 'success'); END IF;
  SELECT count(*) INTO n FROM public.public_shares;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL owner sees % share(s), expected 3', n; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   owner shares own note, own project and member notes in own project';

  -- Member: own private note yes; own note in the project yes (creator); owner's note and the
  -- project no (only the creator or the project owner publishes).
  PERFORM pg_temp.login(member);
  err := pg_temp.try(format(ins, member, 'note', private_note, pg_temp.h('member-private')));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL member cannot share own private note: %', err; END IF;
  err := pg_temp.try(format(ins, member, 'note', member_note, pg_temp.h('member-note')));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL member cannot share own note in project: %', err; END IF;
  err := pg_temp.try(format(ins, member, 'note', owner_note, pg_temp.h('member-owner-note')));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL member shared the owner''s note: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try(format(ins, member, 'project', project, pg_temp.h('member-project')));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL member shared the project: %', coalesce(err, 'success'); END IF;
  -- Members never see the owner's shares, and cannot revoke them.
  SELECT count(*) INTO n FROM public.public_shares;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL member sees % share(s), expected own 2', n; END IF;
  UPDATE public.public_shares SET revoked_at = now() WHERE user_id = owner_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL member revoked % owner share(s)', n; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   member shares own notes only; cannot see or revoke others';

  -- Outsider: nothing.
  PERFORM pg_temp.login(outsider);
  err := pg_temp.try(format(ins, outsider, 'note', owner_note, pg_temp.h('out-note')));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL outsider shared a note: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try(format(ins, outsider, 'project', project, pg_temp.h('out-project')));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL outsider shared a project: %', coalesce(err, 'success'); END IF;
  SELECT count(*) INTO n FROM public.public_shares;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL outsider sees % share(s)', n; END IF;
  DELETE FROM public.public_shares;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL outsider deleted % share(s)', n; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   outsider cannot share, read or delete';

  -- Regenerate, expiry, revoke (frozen afterwards), resource fixed.
  PERFORM pg_temp.login(owner_id);
  SELECT id INTO share_id FROM public.public_shares WHERE resource_id = owner_note;
  err := pg_temp.try(format('UPDATE public.public_shares SET token_hash = %L, expires_at = now() + interval ''7 days'' WHERE id = %L',
                            pg_temp.h('rotated'), share_id));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL owner cannot regenerate: %', err; END IF;
  err := pg_temp.try(format('UPDATE public.public_shares SET resource_id = %L WHERE id = %L', private_note, share_id));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL resource_id changed: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try(format('UPDATE public.public_shares SET revoked_at = now() WHERE id = %L', share_id));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL owner cannot revoke: %', err; END IF;
  err := pg_temp.try(format('UPDATE public.public_shares SET revoked_at = NULL WHERE id = %L', share_id));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL revoked share reactivated: %', coalesce(err, 'success'); END IF;
  -- After revoking, a new active link for the same note is allowed.
  err := pg_temp.try(format(ins, owner_id, 'note', owner_note, pg_temp.h('owner-note-new')));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL new link after revoke refused: %', err; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   regenerate, revoke (frozen), new link after revoke';

  -- A former right to share is re-checked on regenerate (note moved out of reach).
  UPDATE public.notes SET user_id = member WHERE id = owner_note; -- superuser: simulate a transfer
  UPDATE public.notes SET project_id = NULL WHERE id = owner_note;
  PERFORM pg_temp.login(owner_id);
  err := pg_temp.try(format('UPDATE public.public_shares SET token_hash = %L WHERE resource_id = %L AND revoked_at IS NULL',
                            pg_temp.h('rotate-lost'), owner_note));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL regenerate without the right to share: %', coalesce(err, 'success'); END IF;
  err := pg_temp.try(format('UPDATE public.public_shares SET revoked_at = now() WHERE resource_id = %L AND revoked_at IS NULL', owner_note));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL revoke without the right to share refused: %', err; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   regenerate re-checks the right to share; revoke always works';

  -- Service role counter.
  SELECT id INTO share_id FROM public.public_shares WHERE resource_type = 'project';
  PERFORM public.record_public_share_view(share_id);
  PERFORM public.record_public_share_view(share_id);
  SELECT view_count INTO n FROM public.public_shares WHERE id = share_id;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL view_count is %, expected 2', n; END IF;
  IF EXISTS (SELECT 1 FROM public.activity_logs WHERE entity_id = share_id AND action = 'update') THEN
    RAISE EXCEPTION 'FAIL view counter updates are written to the activity log';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.activity_logs WHERE entity_id = share_id AND action = 'insert') THEN
    RAISE EXCEPTION 'FAIL share creation is not in the activity log';
  END IF;
  RAISE NOTICE 'ok   view counter (service role only, not audited); creation audited';

  -- Hard delete of a note/project deletes its shares.
  DELETE FROM public.projects WHERE id = project;
  IF EXISTS (SELECT 1 FROM public.public_shares WHERE resource_type = 'project' AND resource_id = project) THEN
    RAISE EXCEPTION 'FAIL shares of a purged project remain';
  END IF;
  DELETE FROM public.notes WHERE id = private_note;
  IF EXISTS (SELECT 1 FROM public.public_shares WHERE resource_id = private_note) THEN
    RAISE EXCEPTION 'FAIL shares of a purged note remain';
  END IF;
  RAISE NOTICE 'ok   purging a note or project deletes its shares';

  -- 2FA user at aal1: no read, no insert. At aal2: allowed.
  PERFORM pg_temp.login(mfa, 'aal1');
  err := pg_temp.try(format(ins, mfa, 'note', mfa_note, pg_temp.h('mfa-aal1')));
  IF err IS NULL OR err NOT LIKE '42501%' THEN RAISE EXCEPTION 'FAIL aal1 share created: %', coalesce(err, 'success'); END IF;
  PERFORM pg_temp.logout();
  PERFORM pg_temp.login(mfa, 'aal2');
  err := pg_temp.try(format(ins, mfa, 'note', mfa_note, pg_temp.h('mfa-aal2')));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL aal2 share refused: %', err; END IF;
  PERFORM pg_temp.logout();
  PERFORM pg_temp.login(mfa, 'aal1');
  SELECT count(*) INTO n FROM public.public_shares;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL aal1 session sees % share(s)', n; END IF;
  PERFORM pg_temp.logout();
  RAISE NOTICE 'ok   aal1 session of a 2FA user is refused';

  -- Demo row limit.
  INSERT INTO public.app_config (key, value) VALUES ('demo_mode', 'on'), ('demo_limit:public_shares', '1');
  PERFORM pg_temp.login(mfa, 'aal2');
  err := pg_temp.try(format('UPDATE public.public_shares SET revoked_at = now() WHERE user_id = %L', mfa));
  IF err IS NOT NULL THEN RAISE EXCEPTION 'FAIL demo revoke refused: %', err; END IF;
  err := pg_temp.try(format(ins, mfa, 'note', mfa_note, pg_temp.h('mfa-demo')));
  IF err IS NULL OR err NOT LIKE 'P0001 Batas demo: maksimal 1 tautan publik%' THEN
    RAISE EXCEPTION 'FAIL demo limit not enforced: %', coalesce(err, 'success');
  END IF;
  PERFORM pg_temp.logout();
  DELETE FROM public.app_config WHERE key IN ('demo_mode', 'demo_limit:public_shares');
  RAISE NOTICE 'ok   demo row limit';
END $$;

SELECT 'public_shares: all checks passed' AS result;

ROLLBACK;

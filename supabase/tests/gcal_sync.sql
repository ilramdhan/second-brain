-- Checks for migration 0021 (two-way Google Calendar sync: sync state columns, audit noise).
--
-- Run with psql (it uses \ir to re-apply the migration, which also checks it is idempotent) as a
-- superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/gcal_sync.sql
-- Everything runs in one transaction that is rolled back; success ends with
-- "gcal_sync: all checks passed".

BEGIN;

\ir ../../drizzle/migrations/0021_gcal_two_way_sync.sql

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000061a1', 'gcal-owner@example.test'),
  ('00000000-0000-0000-0000-0000000061b2', 'gcal-other@example.test');
INSERT INTO public.tasks (id, user_id, title, due_date, google_event_id) VALUES
  ('61000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000061a1', 'Rapat',
   now(), 'ev1');
INSERT INTO public.app_user_connections (user_id, connector_id, connection_key_ciphertext) VALUES
  ('00000000-0000-0000-0000-0000000061a1', 'google_calendar', 'x');

DO $$
DECLARE _n integer; _before integer;
BEGIN
  -- New connection defaults: no sync token, import off.
  IF (SELECT sync_token IS NOT NULL OR import_events FROM public.app_user_connections
      WHERE user_id = '00000000-0000-0000-0000-0000000061a1') THEN
    RAISE EXCEPTION 'FAIL connection defaults';
  END IF;

  -- Sync bookkeeping on a task is not an activity-log entry.
  SELECT count(*) INTO _before FROM public.activity_logs
   WHERE entity_id = '61000000-0000-0000-0000-0000000000a1';
  UPDATE public.tasks SET google_etag = '"e1"', google_synced_at = now()
   WHERE id = '61000000-0000-0000-0000-0000000000a1';
  SELECT count(*) INTO _n FROM public.activity_logs
   WHERE entity_id = '61000000-0000-0000-0000-0000000000a1';
  IF _n <> _before THEN RAISE EXCEPTION 'FAIL bookkeeping update was audited'; END IF;

  -- A real change is still logged, without the bookkeeping columns in changed_fields.
  UPDATE public.tasks SET title = 'Rapat tim', google_etag = '"e2"'
   WHERE id = '61000000-0000-0000-0000-0000000000a1';
  SELECT count(*) INTO _n FROM public.activity_logs
   WHERE entity_id = '61000000-0000-0000-0000-0000000000a1';
  IF _n <> _before + 1 THEN RAISE EXCEPTION 'FAIL title change not audited'; END IF;
  IF (SELECT metadata->'changed_fields' FROM public.activity_logs
       WHERE entity_id = '61000000-0000-0000-0000-0000000000a1'
       ORDER BY created_at DESC LIMIT 1) ? 'google_etag' THEN
    RAISE EXCEPTION 'FAIL google_etag listed in changed_fields';
  END IF;

  IF to_regclass('public.tasks_google_event_idx') IS NULL THEN
    RAISE EXCEPTION 'FAIL tasks_google_event_idx missing';
  END IF;
END $$;

-- app_user_connections (sync token included) stays out of reach for signed-in users: RLS is
-- enabled without policies, so even the owner sees no rows (only the service role does).
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000061a1', true),
       set_config('request.jwt.claims',
         json_build_object('sub', '00000000-0000-0000-0000-0000000061a1', 'role', 'authenticated')::text, true),
       set_config('role', 'authenticated', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_user_connections) THEN
    RAISE EXCEPTION 'FAIL authenticated can read app_user_connections';
  END IF;
  RAISE NOTICE 'gcal_sync: all checks passed';
END $$;

ROLLBACK;

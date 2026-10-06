-- Checks for migration 0023 (scheduled automations + note triggers: schedule columns, trigger
-- type check, next_run_at index, automation_runs.note_id).
--
-- Run with psql as a superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/scheduled_automations.sql
-- The migration is re-applied (\ir), which also checks it is idempotent. Everything runs in one
-- transaction that is rolled back; success ends with "scheduled_automations: all checks passed".

BEGIN;

\ir ../../drizzle/migrations/0023_scheduled_note_automations.sql

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000023a1', 'sched-owner@example.test'),
  ('00000000-0000-0000-0000-0000000023b2', 'sched-other@example.test');
INSERT INTO public.notes (id, user_id, title) VALUES
  ('23000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000023a1', 'Rapat')
  ON CONFLICT DO NOTHING;

DO $$
BEGIN
  -- A scheduled rule with cron, zone and next run.
  INSERT INTO public.automations (id, user_id, name, trigger, schedule_cron, schedule_tz, next_run_at)
  VALUES ('23000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000023a1',
          'Pagi', '{"type":"schedule"}', '0 8 * * *', 'Asia/Jakarta', now());
  -- Note triggers are accepted.
  INSERT INTO public.automations (user_id, name, trigger) VALUES
    ('00000000-0000-0000-0000-0000000023a1', 'n1', '{"type":"note_created"}'),
    ('00000000-0000-0000-0000-0000000023a1', 'n2', '{"type":"note_updated"}'),
    ('00000000-0000-0000-0000-0000000023a1', 'n3', '{"type":"note_tagged","to":"rapat"}'),
    ('00000000-0000-0000-0000-0000000023a1', 't1', '{"type":"status_changed","to":"done"}');

  BEGIN
    INSERT INTO public.automations (user_id, name, trigger)
    VALUES ('00000000-0000-0000-0000-0000000023a1', 'bad', '{"type":"bogus"}');
    RAISE EXCEPTION 'FAIL unknown trigger type accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.automations (user_id, name, trigger)
    VALUES ('00000000-0000-0000-0000-0000000023a1', 'bad', '{"type":"schedule"}');
    RAISE EXCEPTION 'FAIL schedule rule without cron accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.automations (user_id, name, trigger, schedule_cron)
    VALUES ('00000000-0000-0000-0000-0000000023a1', 'bad', '{"type":"task_created"}', '* * * * *');
    RAISE EXCEPTION 'FAIL task rule with a cron accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.automations (user_id, name, trigger, schedule_cron)
    VALUES ('00000000-0000-0000-0000-0000000023a1', 'bad', '{"type":"schedule"}', repeat('*', 121));
    RAISE EXCEPTION 'FAIL overlong cron accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'automations_next_run_idx') THEN
    RAISE EXCEPTION 'FAIL next_run_at index missing';
  END IF;

  -- Runs can reference a note; deleting the note keeps the run.
  INSERT INTO public.automation_runs (user_id, automation_id, note_id, detail)
  VALUES ('00000000-0000-0000-0000-0000000023a1', '23000000-0000-0000-0000-0000000000a1',
          '23000000-0000-0000-0000-0000000000b1', 'x');
  DELETE FROM public.notes WHERE id = '23000000-0000-0000-0000-0000000000b1';
  IF (SELECT note_id FROM public.automation_runs WHERE detail = 'x') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL note_id not set null on note delete';
  END IF;
END $$;

-- RLS unchanged: another user sees none of the owner's rules and cannot schedule them.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000023b2', true),
       set_config('request.jwt.claims',
         '{"sub":"00000000-0000-0000-0000-0000000023b2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE _n integer;
BEGIN
  SELECT count(*) INTO _n FROM public.automations;
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL other user sees % rules', _n; END IF;
  UPDATE public.automations SET next_run_at = now() WHERE name = 'Pagi';
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL other user updated a rule'; END IF;
END $$;
RESET ROLE;

SELECT 'scheduled_automations: all checks passed' AS result;
ROLLBACK;

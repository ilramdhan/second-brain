-- Scheduled automations (cron per rule) and note triggers (plan item 9.4).
--
-- Rules keep their trigger in `automations.trigger` (jsonb `{type, to?}`). New trigger types:
--   * `schedule`: runs on a 5-field cron expression in a time zone. The expression and zone live
--     in real columns so the n8n tick (`POST /api/public/n8n/automations/tick`) can find due rules
--     with an index instead of scanning jsonb:
--       - `schedule_cron`  the cron expression, validated by the app's own parser (src/lib/cron.ts)
--                          in a server function before `next_run_at` is set;
--       - `schedule_tz`    IANA zone, null = APP_TIMEZONE of the deployment;
--       - `next_run_at`    next due instant, computed server-side after every save and every run;
--                          null = never runs (disabled, not yet validated or invalid cron).
--     `last_run_at` already exists (0003). The tick claims a due window with a compare-and-swap
--     on `next_run_at` (UPDATE ... WHERE next_run_at = <seen value>), so overlapping or retried
--     ticks never run the same window twice.
--   * `note_created`, `note_updated`, `note_tagged`: evaluated by the note rule engine after
--     note writes. `automation_runs.note_id` records which note a run was about (history, and the
--     cooldown that keeps `note_updated` from firing on every autosave).
--
-- The CHECKs are added NOT VALID and then validated (like 0016): if a hand-edited legacy row
-- violates one, validation is skipped with a NOTICE so the migration never fails, and the
-- constraint still guards every new write. RLS is unchanged (rules stay owner-only; the restrictive `mfa_aal2`
-- policy of 0022 already covers both tables because no table is created here).
--
-- Idempotent: safe to run more than once.

ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS schedule_cron text,
  ADD COLUMN IF NOT EXISTS schedule_tz text,
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz;

ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_trigger_type_check;
ALTER TABLE public.automations ADD CONSTRAINT automations_trigger_type_check CHECK (
  trigger ->> 'type' IN (
    'task_created', 'status_changed', 'priority_changed', 'assignee_changed', 'due_changed',
    'note_created', 'note_updated', 'note_tagged', 'schedule'
  )
) NOT VALID;

-- A schedule rule needs a cron expression; other rules never carry one (or a next run).
ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_schedule_check;
ALTER TABLE public.automations ADD CONSTRAINT automations_schedule_check CHECK (
  CASE WHEN trigger ->> 'type' = 'schedule'
    THEN schedule_cron IS NOT NULL
    ELSE schedule_cron IS NULL AND next_run_at IS NULL
  END
) NOT VALID;

ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_schedule_len_check;
ALTER TABLE public.automations ADD CONSTRAINT automations_schedule_len_check CHECK (
  (schedule_cron IS NULL OR length(schedule_cron) BETWEEN 1 AND 120)
  AND (schedule_tz IS NULL OR length(schedule_tz) BETWEEN 1 AND 64)
);

DO $$
DECLARE _name text;
BEGIN
  FOREACH _name IN ARRAY ARRAY['automations_trigger_type_check', 'automations_schedule_check'] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.automations VALIDATE CONSTRAINT %I', _name);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'constraint automations.% left NOT VALID: existing rows violate it', _name;
    END;
  END LOOP;
END $$;

-- The tick: enabled rules whose next run is due, oldest first.
CREATE INDEX IF NOT EXISTS automations_next_run_idx ON public.automations (next_run_at)
  WHERE enabled AND next_run_at IS NOT NULL;

ALTER TABLE public.automation_runs
  ADD COLUMN IF NOT EXISTS note_id uuid REFERENCES public.notes (id) ON DELETE SET NULL;

-- FK index (note deletes) that also serves the note rule cooldown lookup (last run of a rule for
-- a note): note_id leads so the FK check in supabase/tests/phase2.sql recognises it.
CREATE INDEX IF NOT EXISTS automation_runs_note_idx
  ON public.automation_runs (note_id, automation_id, created_at DESC);

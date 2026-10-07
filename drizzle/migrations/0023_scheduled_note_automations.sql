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

-- ALTER TABLE takes ACCESS EXCLUSIVE even when it ends up changing nothing, so every step below
-- runs only when the column/constraint is missing or its definition differs. A rerun on an
-- up-to-date database locks nothing.
CREATE OR REPLACE FUNCTION pg_temp.constraint_is(_table regclass, _name name, _def text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $f$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = _table AND c.conname = _name
                    AND pg_catalog.pg_get_constraintdef(c.oid) = _def)
$f$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.automations'::regclass
                  AND attname = 'schedule_cron' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.automations'::regclass
                     AND attname = 'schedule_tz' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.automations'::regclass
                     AND attname = 'next_run_at' AND NOT attisdropped) THEN
    ALTER TABLE public.automations
      ADD COLUMN IF NOT EXISTS schedule_cron text,
      ADD COLUMN IF NOT EXISTS schedule_tz text,
      ADD COLUMN IF NOT EXISTS next_run_at timestamptz;
  END IF;

  -- The definitions compared below are exactly what pg_get_constraintdef() prints for the CHECKs
  -- that follow (NOT VALID is not part of it; validation is handled separately). If another
  -- Postgres version prints them differently, the only cost is an unneeded drop + add.
  IF NOT pg_temp.constraint_is('public.automations', 'automations_trigger_type_check',
    'CHECK (((trigger ->> ''type''::text) = ANY (ARRAY[''task_created''::text, ''status_changed''::text, ''priority_changed''::text, ''assignee_changed''::text, ''due_changed''::text, ''note_created''::text, ''note_updated''::text, ''note_tagged''::text, ''schedule''::text])))') THEN
    ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_trigger_type_check;
    ALTER TABLE public.automations ADD CONSTRAINT automations_trigger_type_check CHECK (
      trigger ->> 'type' IN (
        'task_created', 'status_changed', 'priority_changed', 'assignee_changed', 'due_changed',
        'note_created', 'note_updated', 'note_tagged', 'schedule'
      )
    ) NOT VALID;
  END IF;

  -- A schedule rule needs a cron expression; other rules never carry one (or a next run).
  IF NOT pg_temp.constraint_is('public.automations', 'automations_schedule_check',
    E'CHECK (\nCASE\n    WHEN ((trigger ->> ''type''::text) = ''schedule''::text) THEN (schedule_cron IS NOT NULL)\n    ELSE ((schedule_cron IS NULL) AND (next_run_at IS NULL))\nEND)') THEN
    ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_schedule_check;
    ALTER TABLE public.automations ADD CONSTRAINT automations_schedule_check CHECK (
      CASE WHEN trigger ->> 'type' = 'schedule'
        THEN schedule_cron IS NOT NULL
        ELSE schedule_cron IS NULL AND next_run_at IS NULL
      END
    ) NOT VALID;
  END IF;

  IF NOT pg_temp.constraint_is('public.automations', 'automations_schedule_len_check',
    'CHECK ((((schedule_cron IS NULL) OR ((length(schedule_cron) >= 1) AND (length(schedule_cron) <= 120))) AND ((schedule_tz IS NULL) OR ((length(schedule_tz) >= 1) AND (length(schedule_tz) <= 64)))))') THEN
    ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_schedule_len_check;
    ALTER TABLE public.automations ADD CONSTRAINT automations_schedule_len_check CHECK (
      (schedule_cron IS NULL OR length(schedule_cron) BETWEEN 1 AND 120)
      AND (schedule_tz IS NULL OR length(schedule_tz) BETWEEN 1 AND 64)
    );
  END IF;
END $$;

DO $$
DECLARE _name text;
BEGIN
  FOREACH _name IN ARRAY ARRAY['automations_trigger_type_check', 'automations_schedule_check'] LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.automations'::regclass
                           AND conname = _name AND convalidated);
    BEGIN
      EXECUTE format('ALTER TABLE public.automations VALIDATE CONSTRAINT %I', _name);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'constraint automations.% left NOT VALID: existing rows violate it', _name;
    END;
  END LOOP;
END $$;

-- The tick: enabled rules whose next run is due, oldest first.
DO $$
BEGIN
  IF to_regclass('public.automations_next_run_idx') IS NULL THEN
    CREATE INDEX IF NOT EXISTS automations_next_run_idx ON public.automations (next_run_at)
      WHERE enabled AND next_run_at IS NOT NULL;
  END IF;
  -- Adding the FK also locks public.notes (SHARE ROW EXCLUSIVE), so skip it when it exists.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.automation_runs'::regclass
                  AND attname = 'note_id' AND NOT attisdropped) THEN
    ALTER TABLE public.automation_runs
      ADD COLUMN IF NOT EXISTS note_id uuid REFERENCES public.notes (id) ON DELETE SET NULL;
  END IF;
END $$;

-- FK index (note deletes) that also serves the note rule cooldown lookup (last run of a rule for
-- a note): note_id leads so the FK check in supabase/tests/phase2.sql recognises it.
DO $$
BEGIN
  IF to_regclass('public.automation_runs_note_idx') IS NULL THEN
    CREATE INDEX IF NOT EXISTS automation_runs_note_idx
      ON public.automation_runs (note_id, automation_id, created_at DESC);
  END IF;
END $$;

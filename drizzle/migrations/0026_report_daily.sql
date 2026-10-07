-- Phase 9.6: daily aggregates for the reports page (focus, burndown, throughput).
--
-- `report_daily(_from, _to, _tz, _project_id, _milestone_id)` returns one row per calendar day
-- in `_tz` (an IANA name; unknown names fall back to UTC) from `_from` to `_to` (at most 367
-- days), so the browser never downloads the task history to draw a chart:
--   created            tasks created that day
--   completed          tasks completed that day
--   completed_minutes  sum of their estimates
--   open_tasks         tasks open at the end of the day (created before, not yet completed)
--   open_minutes       sum of the estimates of those open tasks
--   focus_seconds      focus-timer time (time_entries, breaks excluded) started that day
--   planned_minutes    time-blocked minutes (start_date .. time_block_end) starting that day
-- Trashed tasks are left out; archived ones count (archiving finished work keeps its history). A
-- task marked done without `completed_at` (rows older than the column) counts as completed at its
-- last update. The optional filters narrow everything to one project and/or milestone; focus time
-- belongs to the entry's project, else its task's.
--
-- SECURITY INVOKER: RLS applies, so the numbers include exactly the tasks the caller can see
-- (own tasks plus those of shared projects) and their own focus time. The client passes its
-- browser time zone like `complete_task` (0017); server callers pass APP_TIMEZONE.
-- Idempotent.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.report_daily(
  _from date,
  _to date,
  _tz text DEFAULT 'UTC',
  _project_id uuid DEFAULT NULL,
  _milestone_id uuid DEFAULT NULL
)
RETURNS TABLE (
  day date,
  created integer,
  completed integer,
  completed_minutes integer,
  open_tasks integer,
  open_minutes integer,
  focus_seconds integer,
  planned_minutes integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  _zone text := 'UTC';
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to < _from OR _to - _from > 366 THEN
    RAISE EXCEPTION 'report_daily: invalid range' USING ERRCODE = '22023';
  END IF;
  IF _tz IS NOT NULL AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = _tz) THEN
    _zone := _tz;
  END IF;

  RETURN QUERY
  WITH t AS (
    SELECT tk.created_at,
           coalesce(tk.completed_at, CASE WHEN tk.status = 'done' THEN tk.updated_at END) AS closed_at,
           coalesce(tk.estimate_minutes, 0) AS est,
           tk.start_date,
           tk.time_block_end
      FROM public.tasks tk
     WHERE tk.deleted_at IS NULL
       AND (_project_id IS NULL OR tk.project_id = _project_id)
       AND (_milestone_id IS NULL OR tk.milestone_id = _milestone_id)
  ),
  f AS (
    SELECT te.started_at, te.duration_seconds
      FROM public.time_entries te
      LEFT JOIN public.tasks tk ON tk.id = te.task_id
     WHERE te.mode IS DISTINCT FROM 'break'
       AND te.duration_seconds > 0
       AND (_project_id IS NULL OR coalesce(te.project_id, tk.project_id) = _project_id)
       AND (_milestone_id IS NULL OR tk.milestone_id = _milestone_id)
  ),
  d AS (
    SELECT (_from + i) AS day,
           ((_from + i)::timestamp AT TIME ZONE _zone) AS lo,
           ((_from + i + 1)::timestamp AT TIME ZONE _zone) AS hi
      FROM pg_catalog.generate_series(0, _to - _from) AS i
  )
  SELECT d.day,
         (SELECT count(*) FROM t WHERE t.created_at >= d.lo AND t.created_at < d.hi)::integer,
         (SELECT count(*) FROM t WHERE t.closed_at >= d.lo AND t.closed_at < d.hi)::integer,
         (SELECT coalesce(sum(t.est), 0) FROM t WHERE t.closed_at >= d.lo AND t.closed_at < d.hi)::integer,
         (SELECT count(*) FROM t
           WHERE t.created_at < d.hi AND (t.closed_at IS NULL OR t.closed_at >= d.hi))::integer,
         (SELECT coalesce(sum(t.est), 0) FROM t
           WHERE t.created_at < d.hi AND (t.closed_at IS NULL OR t.closed_at >= d.hi))::integer,
         (SELECT coalesce(sum(f.duration_seconds), 0) FROM f
           WHERE f.started_at >= d.lo AND f.started_at < d.hi)::integer,
         (SELECT coalesce(sum(greatest(0, extract(epoch FROM t.time_block_end - t.start_date) / 60)), 0)
            FROM t
           WHERE t.time_block_end IS NOT NULL AND t.start_date >= d.lo AND t.start_date < d.hi)::integer
    FROM d
   ORDER BY d.day;
END;
$$;

REVOKE ALL ON FUNCTION public.report_daily(date, date, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_daily(date, date, text, uuid, uuid) TO authenticated, service_role;

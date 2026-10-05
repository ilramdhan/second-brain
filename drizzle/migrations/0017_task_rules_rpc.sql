-- Task rules as Postgres RPCs (plan item 4.5).
--
-- Before: the browser (`useTaskActions`) and the n8n service (`src/server/n8n/service.server.ts`)
-- each implemented dependent auto-shift and recurrence on their own, with one request per
-- shifted dependent / per blocker lookup and no transaction around the steps. Both callers now
-- use these functions, so the rules live in one place and each operation is one round-trip.
--
--   * `shift_task_dependents(task, delta_ms, user)` moves every not-done dependent (transitively, cycle
--     safe) by `delta_ms` and resets its reminder. Only positive deltas shift (a deadline pushed
--     later). Returns the shifted rows so clients can patch their caches.
--   * `complete_task(task, tz, user)` marks a task done: blocked check, status update, the list of
--     dependents that became unblocked, and the next occurrence of a recurring task, all in one
--     transaction. Returns jsonb `{status: ok|blocked|already_done, ...}`.
--
-- Both are SECURITY INVOKER with an empty search_path: an authenticated caller only sees and
-- changes rows its RLS policies allow (and the 0010 guards still apply, so `user_id` never
-- changes). The service role (n8n) bypasses RLS, so `complete_task` checks `can_access_task` for
-- the user it acts for. Telegram notifications and automation rules stay in the application
-- (secrets, and automations must never re-trigger rules).

CREATE OR REPLACE FUNCTION public.shift_task_dependents(
  _task_id uuid,
  _delta_ms bigint,
  _user_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, start_date timestamptz, due_date timestamptz, updated_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  _uid uuid := (SELECT auth.uid());
BEGIN
  IF _uid IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> _uid THEN
    RAISE EXCEPTION 'shift_task_dependents: cannot act for another user' USING ERRCODE = '42501';
  END IF;
  IF _uid IS NULL AND _user_id IS NULL THEN
    RAISE EXCEPTION 'shift_task_dependents: no user' USING ERRCODE = '22023';
  END IF;
  -- RLS does not apply to the service role: only shift tasks the acting user can access.
  RETURN QUERY
  WITH RECURSIVE chain(task_id) AS (
    SELECT d.blocked_id FROM public.task_dependencies d WHERE d.blocker_id = _task_id
    UNION
    SELECT d.blocked_id FROM public.task_dependencies d JOIN chain c ON d.blocker_id = c.task_id
  )
  UPDATE public.tasks t
  SET start_date = t.start_date + make_interval(secs => _delta_ms / 1000.0),
      due_date = t.due_date + make_interval(secs => _delta_ms / 1000.0),
      reminded = false,
      updated_at = now()
  FROM chain c
  WHERE _delta_ms > 0
    AND t.id = c.task_id
    AND t.id <> _task_id
    AND t.status <> 'done'
    AND (t.due_date IS NOT NULL OR t.start_date IS NOT NULL)
    AND t.deleted_at IS NULL
    AND t.archived_at IS NULL
    AND (_uid IS NOT NULL OR public.can_access_task(t.id, _user_id))
  RETURNING t.id, t.start_date, t.due_date, t.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_task(
  _task_id uuid,
  _tz text DEFAULT 'UTC',
  _user_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _actor uuid;
  _zone text := coalesce(nullif(_tz, ''), 'UTC');
  _task public.tasks;
  _next public.tasks;
  _blocker text;
  _step interval;
  _unblocked jsonb;
BEGIN
  IF _uid IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> _uid THEN
    RAISE EXCEPTION 'complete_task: cannot act for another user' USING ERRCODE = '42501';
  END IF;
  _actor := coalesce(_uid, _user_id);
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'complete_task: no user' USING ERRCODE = '22023';
  END IF;
  -- RLS does not apply to the service role: check access for the user it acts for.
  IF _uid IS NULL AND NOT public.can_access_task(_task_id, _actor) THEN
    RAISE EXCEPTION 'complete_task: task not accessible' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _task FROM public.tasks WHERE id = _task_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_task: task not found' USING ERRCODE = 'P0002';
  END IF;
  IF _task.status = 'done' THEN
    RETURN jsonb_build_object('status', 'already_done', 'task', to_jsonb(_task));
  END IF;

  SELECT b.title INTO _blocker
  FROM public.task_dependencies d
  JOIN public.tasks b ON b.id = d.blocker_id
  WHERE d.blocked_id = _task_id
    AND b.status <> 'done' AND b.deleted_at IS NULL AND b.archived_at IS NULL
  ORDER BY d.created_at
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'blocked', 'blocker', _blocker);
  END IF;

  UPDATE public.tasks
  SET status = 'done', completed_at = now(), updated_at = now()
  WHERE id = _task_id
  RETURNING * INTO _task;

  -- Open dependents with no other open blocker left.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) ORDER BY t.title),
                  '[]'::jsonb)
  INTO _unblocked
  FROM public.task_dependencies d
  JOIN public.tasks t ON t.id = d.blocked_id
  WHERE d.blocker_id = _task_id
    AND t.status <> 'done' AND t.deleted_at IS NULL AND t.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.task_dependencies d2
      JOIN public.tasks b ON b.id = d2.blocker_id
      WHERE d2.blocked_id = t.id
        AND b.status <> 'done' AND b.deleted_at IS NULL AND b.archived_at IS NULL
    );

  -- Next occurrence of a recurring task (calendar math in the caller's time zone).
  IF _task.recurrence IS NOT NULL AND _task.due_date IS NOT NULL THEN
    _step := CASE _task.recurrence
      WHEN 'daily' THEN interval '1 day'
      WHEN 'weekly' THEN interval '7 days'
      ELSE interval '1 month'
    END;
    INSERT INTO public.tasks (
      user_id, title, description, priority, project_id, milestone_id, assignee_id,
      assignee_name, tags, recurrence, start_date, due_date
    ) VALUES (
      _actor, _task.title, _task.description, _task.priority, _task.project_id,
      _task.milestone_id, _task.assignee_id, _task.assignee_name, _task.tags, _task.recurrence,
      ((_task.start_date AT TIME ZONE _zone) + _step) AT TIME ZONE _zone,
      ((_task.due_date AT TIME ZONE _zone) + _step) AT TIME ZONE _zone
    )
    RETURNING * INTO _next;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'task', to_jsonb(_task),
    'recurring', CASE WHEN _next.id IS NULL THEN NULL ELSE to_jsonb(_next) END,
    'unblocked', _unblocked
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.shift_task_dependents(uuid, bigint, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_task(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_task_dependents(uuid, bigint, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_task(uuid, text, uuid) TO authenticated, service_role;

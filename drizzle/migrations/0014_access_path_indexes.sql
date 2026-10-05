-- Indexes for the main access paths (plan item 2.2, ANALYSIS §2.11 / §6.3).
--
-- Before this migration only activity_logs, note_versions, time_entries, semantic_documents,
-- telegram_link_codes and n8n_events had secondary indexes, so every list query, RLS membership
-- check and FK cascade scanned whole tables.
--
-- * List queries (src/lib/data.ts) always filter `deleted_at IS NULL AND archived_at IS NULL`, so
--   the per-user list indexes are partial and ordered like the queries.
-- * FK columns get a plain (non-partial) index: Postgres can only use a full index to find the
--   referencing rows when the parent row is deleted (ON DELETE CASCADE / SET NULL).
-- * `task_dependencies(blocker_id)` is already covered by UNIQUE (blocker_id, blocked_id).
-- * Plain CREATE INDEX (not CONCURRENTLY): migrations run inside a transaction. The tables are
--   small per user, so the short write lock is acceptable; apply outside peak hours.

-- tasks
CREATE INDEX IF NOT EXISTS tasks_user_active_idx ON public.tasks (user_id, position, created_at)
  WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_project_idx ON public.tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_parent_idx ON public.tasks (parent_id);
CREATE INDEX IF NOT EXISTS tasks_milestone_idx ON public.tasks (milestone_id);
-- Reminder scan (src/server/reminders.server.ts): open, not yet reminded, due soon.
CREATE INDEX IF NOT EXISTS tasks_reminder_idx ON public.tasks (due_date)
  WHERE status <> 'done' AND reminded = false AND due_date IS NOT NULL
    AND deleted_at IS NULL AND archived_at IS NULL;

-- notes
CREATE INDEX IF NOT EXISTS notes_user_active_idx ON public.notes (user_id, pinned DESC, updated_at DESC)
  WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_project_idx ON public.notes (project_id);

-- projects and membership (is_project_member / is_project_owner)
CREATE INDEX IF NOT EXISTS projects_user_idx ON public.projects (user_id);
CREATE INDEX IF NOT EXISTS projects_parent_idx ON public.projects (parent_id);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON public.project_members (user_id, project_id);
-- accept_project_invites() looks invites up by lower(email).
CREATE INDEX IF NOT EXISTS project_invites_email_lower_idx ON public.project_invites (lower(email));
CREATE INDEX IF NOT EXISTS project_invites_invited_by_idx ON public.project_invites (invited_by);

CREATE INDEX IF NOT EXISTS milestones_project_idx ON public.milestones (project_id, due_date);
CREATE INDEX IF NOT EXISTS milestones_user_idx ON public.milestones (user_id);

-- task children
CREATE INDEX IF NOT EXISTS task_dependencies_blocked_idx ON public.task_dependencies (blocked_id);
CREATE INDEX IF NOT EXISTS task_dependencies_user_idx ON public.task_dependencies (user_id);
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON public.task_comments (task_id, created_at);
CREATE INDEX IF NOT EXISTS task_comments_user_idx ON public.task_comments (user_id);
CREATE INDEX IF NOT EXISTS time_entries_task_idx ON public.time_entries (task_id);
CREATE INDEX IF NOT EXISTS time_entries_project_idx ON public.time_entries (project_id);
CREATE INDEX IF NOT EXISTS note_versions_user_idx ON public.note_versions (user_id);

-- inbox and automations
CREATE INDEX IF NOT EXISTS inbox_items_user_status_idx ON public.inbox_items (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS automations_user_idx ON public.automations (user_id);
CREATE INDEX IF NOT EXISTS automation_runs_user_created_idx ON public.automation_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS automation_runs_automation_idx ON public.automation_runs (automation_id);
CREATE INDEX IF NOT EXISTS automation_runs_task_idx ON public.automation_runs (task_id);

-- canvas
CREATE INDEX IF NOT EXISTS canvas_boards_user_idx ON public.canvas_boards (user_id);
CREATE INDEX IF NOT EXISTS canvas_boards_project_idx ON public.canvas_boards (project_id);
CREATE INDEX IF NOT EXISTS canvas_nodes_board_idx ON public.canvas_nodes (board_id);
CREATE INDEX IF NOT EXISTS canvas_nodes_user_idx ON public.canvas_nodes (user_id);
CREATE INDEX IF NOT EXISTS canvas_edges_board_idx ON public.canvas_edges (board_id);
CREATE INDEX IF NOT EXISTS canvas_edges_source_idx ON public.canvas_edges (source_id);
CREATE INDEX IF NOT EXISTS canvas_edges_target_idx ON public.canvas_edges (target_id);
CREATE INDEX IF NOT EXISTS canvas_edges_user_idx ON public.canvas_edges (user_id);

-- remaining per-user tables
CREATE INDEX IF NOT EXISTS templates_user_idx ON public.templates (user_id);
CREATE INDEX IF NOT EXISTS n8n_events_user_idx ON public.n8n_events (user_id);

-- Telegram chat lookups (webhook, n8n bot). telegramLink.server.ts unlinks a chat from every other
-- profile before linking it, so the column should already be unique. If existing data still has
-- duplicates, fall back to a plain index instead of failing the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE telegram_chat_id IS NOT NULL
    GROUP BY telegram_chat_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'profiles.telegram_chat_id has duplicates; creating a non-unique index';
    CREATE INDEX IF NOT EXISTS profiles_telegram_chat_idx ON public.profiles (telegram_chat_id)
      WHERE telegram_chat_id IS NOT NULL;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS profiles_telegram_chat_uq ON public.profiles (telegram_chat_id)
      WHERE telegram_chat_id IS NOT NULL;
  END IF;
END
$$;

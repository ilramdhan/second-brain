> [!NOTE]
> This repo was originally imported from Lovable and no longer depends on it. As good practice,
> still never rewrite published git history (no force-push, and no rebase/amend/squash of pushed
> commits), and keep `main` buildable.

## Architecture rules

- Client data access goes through hooks in `src/lib/data.ts` (TanStack Query keys `tasks/projects/notes/milestones`); why: one cache keeps list, kanban, calendar and timeline in sync with optimistic updates.
- Task create/edit happens only via the global `TaskDialogProvider` (mounted in `_authenticated` layout); why: every view opens the same full editor.
- Team access is enforced in RLS via security-definer `is_project_member`/`is_project_owner`; tasks/notes/milestones in a shared project are visible to members; why: avoids recursive policies and keeps sharing project-scoped.
- Drag & drop uses `@dnd-kit/core` (kanban, calendar); timeline bars use raw pointer events; why: dnd-kit lacks resize semantics for gantt bars.
- Task dependencies live in `task_dependencies`; blocked checks, cycle rejection and auto-shift of dependents run in `useTaskActions` (src/lib/data.ts); why: every view (list, kanban, calendar, timeline) shares one mutation path. Auto-shift and completion (blocked check + next recurring occurrence) are the Postgres RPCs `shift_task_dependents` / `complete_task` (migration 0017), also called by the n8n service, so change the rules there, not in TypeScript.
- Automations are evaluated server-side in `runAutomations` (src/lib/automations.functions.ts), triggered from `useTaskActions` after create/update; actions write directly so they never re-trigger rules; why: avoids loops and keeps webhooks/Telegram secrets on the server.
- Notes store `blocks` (jsonb, block ids) as source of truth and mirror markdown into `content` for search/AI, plus derived `links`/`refs`/`excerpt` columns (migration 0018, `withNoteIndex`/`noteIndexFields`) that every note writer fills so backlinks are a GIN-indexed `note_backlinks` RPC and the list only loads the excerpt; links `[[title]]`, refs `((blockId))` and queries are parsed client-side in src/lib/blocks.ts; why: backlinks/graph/transclusion need stable block ids without extra tables.
- Natural-language task parsing is a local regex parser (src/lib/nlp.ts); why: instant preview with no AI cost.
- All authenticated pages use the shared `PageContainer`; why: horizontal spacing and responsive widths remain consistent across views.
- Per-user Google Calendar access uses the app's own Google OAuth 2.0 client (code + PKCE, encrypted user-bound `state`) and stores only AES-GCM-encrypted refresh tokens (`TOKEN_ENCRYPTION_KEY`) in service-role-only `app_user_connections`, refreshed server-side; why: provider credentials must never reach the browser, n8n or other users.
- n8n integration endpoints live in `src/routes/api/public/n8n/*` behind `handleN8n` (`x-api-key` = `N8N_API_KEY`, zod validation, idempotency via `n8n_events`); they use the service role only inside handlers, scope every query to the resolved user and reuse the server-side task rules; schedules (reminders, digests, maintenance, backups) run in n8n; why: Vercel Hobby/Supabase Free cannot schedule, while domain logic must stay in one place.
- Note collaboration uses Yjs updates over authenticated realtime channels, while durable note state remains in `notes.blocks`; why: concurrent edits converge without introducing a second source of truth.
- Deleting tasks/notes/projects is a soft delete (`deleted_at`), archiving sets `archived_at`; list hooks in `src/lib/data.ts` exclude both and `/archive` restores or purges; why: users can recover mistakes without a second copy of data.
- Long lists paginate client-side via `usePaged`/`LoadMore` (src/components/common/LoadMore.tsx); why: one consistent "load more" pattern without changing the shared query cache.

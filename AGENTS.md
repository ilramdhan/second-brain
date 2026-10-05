<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Architecture rules

- Client data access goes through hooks in `src/lib/data.ts` (TanStack Query keys `tasks/projects/notes/milestones`); why: one cache keeps list, kanban, calendar and timeline in sync with optimistic updates.
- Task create/edit happens only via the global `TaskDialogProvider` (mounted in `_authenticated` layout); why: every view opens the same full editor.
- Team access is enforced in RLS via security-definer `is_project_member`/`is_project_owner`; tasks/notes/milestones in a shared project are visible to members; why: avoids recursive policies and keeps sharing project-scoped.
- Drag & drop uses `@dnd-kit/core` (kanban, calendar); timeline bars use raw pointer events; why: dnd-kit lacks resize semantics for gantt bars.
- Task dependencies live in `task_dependencies`; blocked checks, cycle rejection and auto-shift of dependents run in `useTaskActions` (src/lib/data.ts); why: every view (list, kanban, calendar, timeline) shares one mutation path.
- Automations are evaluated server-side in `runAutomations` (src/lib/automations.functions.ts), triggered from `useTaskActions` after create/update; actions write directly so they never re-trigger rules; why: avoids loops and keeps webhooks/Telegram secrets on the server.
- Notes store `blocks` (jsonb, block ids) as source of truth and mirror markdown into `content` for search/AI; links `[[title]]`, refs `((blockId))` and queries are parsed client-side in src/lib/blocks.ts; why: backlinks/graph/transclusion need stable block ids without extra tables.
- Natural-language task parsing is a local regex parser (src/lib/nlp.ts); why: instant preview with no AI cost.
- All authenticated pages use the shared `PageContainer`; why: horizontal spacing and responsive widths remain consistent across views.
- Per-user Google Calendar access uses the linked App User Connector and encrypted server-side connection handles; why: provider credentials must never reach the browser or be shared across users.
- Note collaboration uses Yjs updates over authenticated realtime channels, while durable note state remains in `notes.blocks`; why: concurrent edits converge without introducing a second source of truth.
- Deleting tasks/notes/projects is a soft delete (`deleted_at`), archiving sets `archived_at`; list hooks in `src/lib/data.ts` exclude both and `/archive` restores or purges; why: users can recover mistakes without a second copy of data.
- Long lists paginate client-side via `usePaged`/`LoadMore` (src/components/common/LoadMore.tsx); why: one consistent "load more" pattern without changing the shared query cache.

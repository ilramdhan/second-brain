# CLAUDE.md

Guide for Claude Code in this repo. **Read `AGENTS.md` first.** Its architecture rules are authoritative. This file summarizes them and adds practical notes. See `README.md` for the full feature list, ERD and deployment steps.

## Project

"Second Brain": a task & notes management PWA with an inbox and AI capture, tasks (list, kanban, calendar, timeline), dependencies, automations, a block-based notes editor (links, refs, queries, graph, Yjs collaboration), projects shared with team members, Google Calendar and Telegram. UI strings are mostly Indonesian, with i18n in `src/lib/preferences.tsx`. The repo is connected to **Lovable**.

## Stack

TanStack Start 1.168 (SSR + server functions) · React 19 · TanStack Router/Query · Vite 8 via `@lovable.dev/vite-tanstack-config` · Nitro 3 · Supabase (Postgres + RLS, Auth, Realtime) · Tailwind 4 + shadcn/ui · @dnd-kit · Yjs · d3-force · AI SDK through the Lovable AI Gateway · Vitest · Bun.

## Commands

```bash
bun install
bun run dev          # dev server
bun run build        # production build (Nitro)
bun run lint         # ESLint
bun run format       # Prettier
bun run test         # Vitest (jsdom), single run
bunx drizzle-kit migrate   # apply SQL migrations (needs LOVABLE_DB_MIGRATION_URL)
```

Before finishing a change, run `bun run lint` and `bun run test`, and run `bun run build` for routing or server changes.

## Key conventions (see AGENTS.md)

- **Data access**: client reads and writes go through hooks in `src/lib/data.ts` (query keys `tasks/projects/notes/milestones/deps/automations`). Don't add ad-hoc `useQuery` calls for these entities. Reuse the hooks so all views stay in sync.
- **Tasks**: create and edit only through the global `TaskDialogProvider` (`useTaskDialog().newTask/openTask`). All task mutations go through `useTaskActions()`. That hook handles blocked checks, dependent auto-shift, recurrence, unblock notifications and the `runAutomations` trigger.
- **Dependencies**: `task_dependencies`. Cycle rejection is in `useDependencyActions`.
- **Automations**: run server-side in `runAutomations` (`src/lib/automations.functions.ts`). Actions write directly to the database and must never re-trigger rules. Secrets (webhooks, Telegram) stay on the server.
- **Notes**: `notes.blocks` (jsonb with block ids) is the source of truth. Always mirror `content = toMarkdown(blocks)`. Parsing for `[[links]]`, `((refs))` and queries lives in `src/lib/blocks.ts`.
- **NLP quick add**: local regex parser in `src/lib/nlp.ts`. Don't replace it with AI calls.
- **Soft delete**: tasks, notes and projects set `deleted_at`. Archive sets `archived_at` (tasks and notes). List hooks exclude both, and `/archive` restores or purges (30-day trash retention). Never hard-delete from normal views.
- **Pagination**: use `usePaged` / `LoadMore` (`src/components/common/LoadMore.tsx`).
- **Layout**: every authenticated page wraps its content in `PageContainer` (and usually `PageHeader`).
- **Drag & drop**: `@dnd-kit/core` for kanban and calendar. Timeline bars use raw pointer events.
- **Team access**: enforced in RLS with the security-definer `is_project_member`, `is_project_owner` and `can_access_task`. Never write policies that query `projects` or `project_members` directly (recursion).
- **Google Calendar**: per-user App User Connector. Connection handles are AES-GCM-encrypted in `app_user_connections` (service role only). They never reach the browser.
- **Collaboration**: Yjs over the **private** Supabase Realtime channel `note-collab:<id>` (`src/hooks/use-note-collaboration.ts`), authorized by `realtime.messages` policies via `can_access_note` (migration 0009). Durable state is still `notes.blocks`.
- **Ownership**: `user_id` is immutable on update (trigger, migration 0010). Members edit shared rows, but only the row creator or project owner may trash/restore/delete, and only the project owner edits a project. New member policies must be per-operation and use `(select auth.uid())`.

## Directory map

```
src/routes/__root.tsx            HTML shell, SW registration
src/routes/_authenticated.tsx    auth guard + app shell (nav, Cmd+K, Q quick task, capture, idle logout)
src/routes/_authenticated/*      pages: index(Today) inbox tasks calendar timeline projects.* notes.* graph
                                 canvas automations reports templates archive activity settings
src/routes/api/public/*          public HTTP endpoints: telegram/webhook, hooks/reminders (cron)
src/routes/oauth/google-calendar/return.tsx   OAuth popup return
src/lib/data.ts                  query hooks + mutations (central)
src/lib/*.functions.ts           createServerFn (ai, automations, googleCalendar)
src/lib/*.server.ts, src/server/ server-only helpers (AI gateway, Telegram, crypto)
src/lib/blocks.ts, nlp.ts        note block engine; NL task parser
src/components/{tasks,notes,projects,common,ui}
src/integrations/supabase/       client.ts (browser/SSR), client.server.ts (service role), auth middleware (generated)
src/integrations/lovable/        App User Connector gateway calls
drizzle/migrations/              SQL migrations (schema.ts is intentionally blank)
public/                          manifest.webmanifest, sw.js, icons
```

## Gotchas

- **Lovable sync**: never force-push or rebase, amend or squash pushed commits. Pushes to `main` sync to Lovable, so keep `main` buildable.
- `src/routeTree.gen.ts` is generated by the router plugin when the dev server or build runs. Don't edit it.
- Files headed "automatically generated" (`src/integrations/supabase/{client,client.server,auth-middleware,auth-attacher,cron-auth,types}.ts`, `drizzle/schema.ts`) shouldn't be hand-edited.
- `vite.config.ts`: don't add plugins that `@lovable.dev/vite-tanstack-config` already includes (TanStack Start, React, Tailwind, tsconfig paths, Nitro, devtools). Duplicates break the app. Pass extras through `defineConfig({ vite: {...} })`. Add newly discovered heavy deps to `optimizeDeps.include`.
- Nitro defaults to the `cloudflare-module` preset. For Vercel, pin `nitro: { preset: "vercel" }` in `defineConfig` (ignored inside Lovable builds) or set `NITRO_PRESET=vercel`.
- Server-only code: put it in `*.server.ts` and load it with `await import(...)` inside handlers so it never reaches the client bundle. Never import `client.server.ts` (`supabaseAdmin`, which bypasses RLS) from client code.
- `src/start.ts` defines global middleware. Keep `attachSupabaseAuth` and the CSRF middleware.
- `VITE_*` env vars are inlined at build time. Server secrets come from `process.env[...]`.
- The reminder endpoint authenticates against `app_config.cron_token`, not `LOVABLE_CRON_SECRET`.
- Bun's `minimumReleaseAge` (24 h) guard is in `bunfig.toml`. Ask the user before adding exclusions.
- `docs/n8n/` is unrelated reference material (git-ignored). This app's n8n templates go in `integrations/n8n/`.

## How to add a migration

1. Create `drizzle/migrations/NNNN_descriptive_name.sql` with the next number. Prefer idempotent SQL (`IF NOT EXISTS`).
2. For new tables: `ENABLE ROW LEVEL SECURITY`, add policies (owner `auth.uid() = user_id`, plus `is_project_member(project_id, auth.uid())` for project-scoped data), `GRANT ... TO authenticated` and `GRANT ALL ... TO service_role`, and an `audit_row_change` trigger if the table should appear in the activity log.
3. Add an entry to `drizzle/migrations/meta/_journal.json`.
4. Update `src/integrations/supabase/types.ts` (regenerate with `supabase gen types`).
5. If the entity is listed in the UI, add a hook and query key in `src/lib/data.ts`. Exclude `deleted_at` and `archived_at` rows if the table soft-deletes.

## How to add a route

- Create a file under `src/routes/` (see `src/routes/README.md`): `_authenticated/foo.tsx` → `/foo` (auth-guarded), `$param` for dynamic segments.
- `export const Route = createFileRoute("/_authenticated/foo")({ head: () => ({ meta: [...] }), component: Foo })`. Wrap the content in `<PageContainer>`.
- Add it to `NAV` in `src/routes/_authenticated.tsx` and add i18n keys in `preferences.tsx` if it needs a sidebar entry.
- Public HTTP endpoints go under `src/routes/api/public/...` with `server: { handlers: { POST: async ({ request }) => ... } }`. Authenticate them yourself (secret header or token).

## How to add a server function

```ts
// src/lib/foo.functions.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const doFoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]) // context.supabase (RLS as user), context.userId
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { helper } = await import("./foo.server"); // server-only code + secrets
    return helper(context.supabase, data.id);
  });
```

Call it from the client with `useServerFn(doFoo)` or `doFoo({ data })`. Use `supabaseAdmin` only when RLS must be bypassed, and scope queries to `context.userId`.

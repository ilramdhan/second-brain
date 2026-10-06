# CLAUDE.md

Guide for Claude Code in this repo. **Read `AGENTS.md` first.** Its architecture rules are authoritative. This file summarizes them and adds practical notes. See `README.md` for the full feature list, ERD and deployment steps.

## Project

"Second Brain": a task & notes management PWA with an inbox and AI capture, tasks (list, kanban, calendar, timeline), dependencies, automations, a block-based notes editor (links, refs, queries, graph, Yjs collaboration), projects shared with team members, Google Calendar and Telegram. UI strings are mostly Indonesian, with i18n in `src/lib/preferences.tsx`. The repo was originally imported from Lovable but no longer depends on it; it deploys to Vercel + Supabase.

## Stack

TanStack Start 1.168 (SSR + server functions) · React 19 · TanStack Router/Query · Vite 8 (explicit `vite.config.ts`) · Nitro 3 · Supabase (Postgres + RLS, Auth, Realtime) · Tailwind 4 + shadcn/ui · @dnd-kit · Yjs · d3-force · AI SDK with OpenAI or any OpenAI-compatible provider (`AI_*` env) · Vitest · Bun.

## Commands

```bash
bun install
bun run dev          # dev server
bun run build        # production build (Nitro, vercel preset → .vercel/output)
bun run lint         # ESLint
bun run format       # Prettier
bun run test         # Vitest (jsdom), single run
bunx drizzle-kit migrate   # apply SQL migrations (needs DATABASE_URL)
```

Before finishing a change, run `bun run lint` and `bun run test`, and run `bun run build` for routing or server changes.

## Key conventions (see AGENTS.md)

- **Data access**: client reads and writes go through hooks in `src/features/<entity>/{api,hooks,types}.ts` (queryOptions in `api.ts`, hooks in `hooks.ts`, shared `qk`/`useCrud`/`preloadQueries` in `src/features/shared`), all re-exported by the barrel `src/lib/data.ts` so `@/lib/data` imports keep working (query keys `tasks/projects/notes/milestones/deps/automations`). Don't add ad-hoc `useQuery` calls for these entities. Reuse the hooks so all views stay in sync.
- **Tasks**: create and edit only through the global `TaskDialogProvider` (`useTaskDialog().newTask/openTask`). All task mutations go through `useTaskActions()`. That hook handles blocked checks, dependent auto-shift, recurrence, unblock notifications and the `runAutomations` trigger.
- **Dependencies**: `task_dependencies`. Cycle rejection is in `useDependencyActions`.
- **Automations**: run server-side in `runAutomations` (`src/lib/automations.functions.ts`). Actions write directly to the database and must never re-trigger rules. Secrets (webhooks, Telegram) stay on the server.
- **Notes**: `notes.blocks` (jsonb with block ids) is the source of truth. Always mirror `content = toMarkdown(blocks)` and the derived `links`/`refs`/`excerpt` (migration 0018): `useNoteActions` does it via `withNoteIndex`; direct inserts (inbox, backup restore, n8n `createNote`) must call `withNoteIndex`/`noteIndexFields` too. Backlinks come from the `note_backlinks` RPC (`useBacklinks`); the notes list selects `excerpt`, not `content`. Parsing for `[[links]]`, `((refs))` and queries lives in `src/lib/blocks.ts`.
- **NLP quick add**: local regex parser in `src/lib/nlp.ts`. Don't replace it with AI calls.
- **Semantic search**: `semantic_documents` (migration 0020) holds one 1536-d embedding per task/note, keyed by `model` + `content_hash` of the text built in SQL (`semantic_task_text`/`semantic_note_text`). Never embed inside a save: writes go through `useCrud`, which calls `scheduleSemanticSync()` (`src/lib/semantic-sync.ts`); the server drains `semantic_pending` → `aiEmbed` → `semantic_upsert` (`src/server/semantic.server.ts`). Rows written elsewhere are picked up by the next search, Settings "Indeks ulang" or n8n maintenance `semantic_index`. Demo mode uses `hashEmbedding` (no provider).
- **Soft delete**: tasks, notes and projects set `deleted_at`. Archive sets `archived_at` (tasks and notes). List hooks exclude both, and `/archive` restores or purges (30-day trash retention). Never hard-delete from normal views.
- **Pagination**: use `usePaged` / `LoadMore` (`src/components/common/LoadMore.tsx`).
- **Layout**: every authenticated page wraps its content in `PageContainer` (and usually `PageHeader`).
- **Drag & drop**: `@dnd-kit/core` for kanban and calendar. Timeline bars use raw pointer events.
- **Team access**: enforced in RLS with the security-definer `is_project_member`, `is_project_owner` and `can_access_task`. Never write policies that query `projects` or `project_members` directly (recursion).
- **Google Calendar**: the deployment's own Google OAuth 2.0 client (code + PKCE, encrypted `state`, offline access, scope `calendar.events`; `src/server/googleOAuth.server.ts`). Refresh tokens are AES-GCM-encrypted with `TOKEN_ENCRYPTION_KEY` in `app_user_connections` (service role only), refreshed server-side (`src/server/googleCalendar.server.ts`). They never reach the browser or n8n.
- **n8n endpoints**: `/api/public/n8n/*` (bot, capture, digest, reminders, maintenance, backup, calendar/sync, events) go through `handleN8n` (`src/server/n8n/http.server.ts`: `x-api-key` = `N8N_API_KEY`, zod, error mapping). They use `supabaseAdmin` and must scope every query to the resolved user (`src/server/n8n/service.server.ts`); task writes reuse the server-side rules (blocked check, auto-shift, recurrence, `runAutomationRules`). Idempotency via `n8n_events`. Schedules live in n8n; Vercel Cron / pg_cron are fallbacks only.
- **Collaboration**: Yjs over the **private** Supabase Realtime channel `note-collab:<id>` (`src/hooks/use-note-collaboration.ts`), authorized by `realtime.messages` policies via `can_access_note` (migration 0009). Durable state is still `notes.blocks`.
- **Ownership**: `user_id` is immutable on update (trigger, migration 0010). Members edit shared rows, but only the row creator or project owner may trash/restore/delete, and only the project owner edits a project. New member policies must be per-operation and use `(select auth.uid())`.

## Directory map

```
src/routes/__root.tsx            HTML shell, SW registration
src/routes/_authenticated.tsx    auth guard + app shell (nav, Cmd+K, Q quick task, capture, idle logout)
src/routes/index.tsx             public landing (/; signed-in users → /today)
src/routes/_authenticated/*      pages: today inbox tasks calendar timeline projects.* notes.* graph
                                 canvas automations reports templates archive activity settings
src/routes/api/public/*          public HTTP endpoints: telegram/webhook (app mode), hooks/reminders (cron
                                 fallback), n8n/* (x-api-key)
src/routes/oauth/google-calendar/return.tsx   OAuth popup return
src/features/<entity>/          data layer: api.ts (columns, queryOptions), hooks.ts (queries + mutations), types.ts
src/lib/data.ts                  re-export barrel of src/features (keeps `@/lib/data` imports working)
src/lib/*.functions.ts           createServerFn (ai, automations, googleCalendar)
src/lib/*.server.ts, src/server/ server-only helpers (AI provider, Telegram Bot API, Google OAuth, token
                                 crypto, automation engine, n8n/ services)
src/lib/blocks.ts, nlp.ts        note block engine; NL task parser
src/components/{tasks,notes,projects,common,ui}
src/integrations/supabase/       client.ts (browser/SSR), client.server.ts (service role), auth middleware
integrations/n8n/                n8n workflow templates + endpoint contracts (README)
supabase/tests/                  SQL regression checks (run in a throwaway Postgres)
drizzle/migrations/              SQL migrations (schema.ts is intentionally blank)
public/                          manifest.webmanifest, offline.html, icons (sw.js is generated by vite-plugin-pwa)
```

## Gotchas

- **Git history**: never force-push or rebase, amend or squash pushed commits (the repo was imported from Lovable; keep this as good practice). Keep `main` buildable.
- **Releases**: Release Please generates `CHANGELOG.md`, the `package.json` version and GitHub Releases from Conventional Commits on `main` (`release-please-config.json`). Don't edit `CHANGELOG.md` or the version by hand; write Conventional Commit messages and PR titles (`feat:`, `fix:`, `perf:`, `docs:`, `chore:` …, `!` for breaking).
- `src/routeTree.gen.ts` is generated by the router plugin when the dev server or build runs. Don't edit it.
- `src/integrations/supabase/types.ts` is generated (`supabase gen types`) and `drizzle/schema.ts` is intentionally blank. The other Supabase helpers there are normal, hand-maintained code.
- `vite.config.ts` lists every plugin explicitly (Tailwind, tsconfig paths, TanStack Start with the `src/server.ts` entry, Nitro for builds only, React). Don't register any of them twice. Add newly discovered heavy deps to `optimizeDeps.include`.
- Nitro defaults to the `vercel` preset (`.vercel/output`). Override with `NITRO_PRESET` (e.g. `node-server`).
- AI goes through `src/lib/ai.server.ts` (`AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_VISION_MODEL`, `AI_EMBEDDING_MODEL`, `AI_TRANSCRIBE_MODEL`, `AI_TRANSCRIBE_MODE`, `AI_TRANSCRIBE_BASE_URL`, `AI_TRANSCRIBE_API_KEY`). Voice uses `/audio/transcriptions` by default, or `chat` mode (Chat Completions + `input_audio`), which is auto-selected for Gemini (`generativelanguage.googleapis.com`, no transcription endpoint). With no key, AI functions throw "AI belum dikonfigurasi" before the rate limiter.
- Client error boundaries report through `src/lib/error-reporting.ts` (`reportError`). Optional Sentry is wired in via `setErrorReporter` by `src/lib/monitoring.ts` (lazy `@sentry/browser` chunk + web-vitals, only with `VITE_SENTRY_DSN`); server errors go through `captureServerError` (`src/server/sentry.server.ts`, `@sentry/core` + fetch, only with `SENTRY_DSN`). Everything sent passes `scrubEvent` (user id only, no bodies/headers/query/content); keep it that way. Self-hosted Sentry needs its ingest host in the CSP `connect-src`.
- Telegram: `src/lib/telegram.server.ts` calls the Bot API with `TELEGRAM_BOT_TOKEN` (never log the URL). Account linking always goes through one-time codes (`src/server/telegramLink.server.ts`), in app mode and n8n mode.
- `APP_TIMEZONE` (default `Asia/Jakarta`) defines "today" on the server; use `src/server/n8n/time.server.ts` instead of local `Date` math in server code.
- Server-only code: put it in `*.server.ts` and load it with `await import(...)` inside handlers so it never reaches the client bundle. Never import `client.server.ts` (`supabaseAdmin`, which bypasses RLS) from client code.
- `src/start.ts` defines global middleware. Keep `attachSupabaseAuth` and the CSRF middleware.
- `VITE_*` env vars are inlined at build time. Server secrets come from `process.env[...]`.
- The reminder endpoint (GET/POST) authenticates with `src/server/cronAuth.server.ts`: `SECOND_BRAIN_CRON_SECRET`, `SECOND_BRAIN_CRON_SECRET_PREVIOUS`, `CRON_SECRET` (Vercel Cron), falling back to the legacy `app_config.cron_token`.
- Outgoing requests to user-supplied URLs must go through `safeWebhookPost` / `assertSafeUrl` (`src/server/ssrf.server.ts`).
- New AI server functions must call the per-user limiter (`enforceRateLimit` with `AI_RATE_LIMIT`, `src/server/rateLimit.server.ts`) and put `.max()` on every text input.
- Security headers live in `src/server/securityHeaders.ts` (applied by `src/server.ts` in production) and are mirrored in `vercel.json`; a test fails if they drift. The resource CSP is report-only, so add new browser-side origins there before enforcing it.
- Demo mode (`APP_MODE`/`VITE_APP_MODE=demo`): client checks use `isDemo()` (`src/lib/app-mode.ts`) and wrap switched-off controls in `DemoDisabled`; the real boundary is server-side: `assertNotDemo(feature)` / `isDemoMode()` (`src/server/demo/mode.server.ts`) in server functions and endpoints, `handleN8n(..., { allowInDemo })` (n8n is 404 in demo by default), and the per-IP limiter in `src/server.ts`. New integrations that reach people or third parties must be guarded the same way. AI is simulated in demo: `ai.server.ts` (`aiText` with a `demoKind`, `aiParseBrainDump`, `aiTranscribe`) answers from `src/server/demo/ai-fixtures.server.ts` before reading any `AI_*` config (use `assertAiAvailable()`, not `aiConfigFromEnv()`, to gate AI), and every AI form shows `<DemoExamples>` with the example inputs from `src/lib/demo-examples.ts` (shared with the demo seed). New AI features need a fixture too.
- Bun's `minimumReleaseAge` (24 h) guard is in `bunfig.toml`. Ask the user before adding exclusions.
- `docs/n8n/` is unrelated reference material (git-ignored). This app's n8n templates go in `integrations/n8n/`.

## How to add a migration

1. Create `drizzle/migrations/NNNN_descriptive_name.sql` with the next number. Prefer idempotent SQL (`IF NOT EXISTS`).
2. For new tables: `ENABLE ROW LEVEL SECURITY`, add policies (owner `auth.uid() = user_id`, plus `is_project_member(project_id, auth.uid())` for project-scoped data), `GRANT ... TO authenticated` and `GRANT ALL ... TO service_role`, and an `audit_row_change` trigger if the table should appear in the activity log.
3. Add an entry to `drizzle/migrations/meta/_journal.json`.
4. Update `src/integrations/supabase/types.ts` (regenerate with `supabase gen types`).
5. If the entity is listed in the UI, add a query key in `src/features/shared/query-keys.ts`, queryOptions/hooks in `src/features/<entity>/`, and re-export them from `src/lib/data.ts`. Exclude `deleted_at` and `archived_at` rows if the table soft-deletes.

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

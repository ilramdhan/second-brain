# Contributing to Second Brain

Thanks for your interest in improving Second Brain. This guide covers everything you need to go
from a fresh clone to a merged pull request.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues
must be reported privately as described in [SECURITY.md](SECURITY.md), never in public issues.

## Table of contents

1. [Ways to contribute](#ways-to-contribute)
2. [Development setup](#development-setup)
3. [Project tour](#project-tour)
4. [Architecture rules](#architecture-rules)
5. [Common tasks](#common-tasks)
6. [Code style](#code-style)
7. [Testing](#testing)
8. [Branches and commits](#branches-and-commits)
9. [Pull request flow](#pull-request-flow)
10. [Review checklist](#review-checklist)
11. [CI/CD](#cicd)
12. [Lovable sync caveats](#lovable-sync-caveats)
13. [Documentation](#documentation)

---

## Ways to contribute

- **Report bugs** with the [bug report form](../../issues/new?template=bug_report.yml).
- **Suggest features** with the [feature request form](../../issues/new?template=feature_request.yml).
  For anything large (new tables, new views, new integrations) please open an issue first so the
  design can be agreed before you write code.
- **Improve docs**: README, this guide, [ACCESSIBILITY.md](ACCESSIBILITY.md), code comments.
- **Write tests**: pure modules such as `src/lib/nlp.ts` and `src/lib/blocks.ts` have little
  coverage today and are great first contributions.
- **Fix accessibility gaps** listed in [ACCESSIBILITY.md](ACCESSIBILITY.md#known-gaps).

Issues labelled `good first issue` or `help wanted` are a good starting point.

---

## Development setup

### Prerequisites

| Tool                  | Version                                       | Notes                                                               |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| [Bun](https://bun.sh) | 1.2+ (CI uses the version in `.bun-version`)  | Package manager and script runner. `bun.lock` is the only lockfile. |
| Node.js               | 22 (see `.nvmrc`)                             | Needed by some tooling; Bun covers most workflows.                  |
| Supabase              | Cloud project or local CLI (`supabase start`) | Postgres with the `vector` extension available.                     |
| Git                   | any recent                                    |                                                                     |

> Please don't add `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`. Dependency changes must
> update `bun.lock`.

`bunfig.toml` enables a 24-hour `minimumReleaseAge` supply-chain guard: Bun will not install
package versions published less than a day ago. Don't add exclusions without discussing it with a
maintainer in the PR.

### 1. Clone and install

```bash
git clone https://github.com/ilramdhan/second-brain.git
cd second-brain
bun install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in at least the Supabase variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and
`LOVABLE_DB_MIGRATION_URL`. AI, Telegram and Google Calendar need their own secrets; the rest of
the app works without them. See the [environment variable table](README.md#environment-variables).

`.env` is git-ignored. Never commit real keys, and never expose a server secret through a `VITE_*`
variable (those are inlined into the browser bundle).

### 3. Set up the database

Using a Supabase cloud project:

```bash
bunx drizzle-kit migrate      # applies drizzle/migrations/*.sql using LOVABLE_DB_MIGRATION_URL
```

Using the local Supabase CLI:

```bash
supabase start                # prints the local API URL, anon key and service role key
# Point .env at the local stack, e.g.
#   VITE_SUPABASE_URL=http://127.0.0.1:54321
#   LOVABLE_DB_MIGRATION_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
bunx drizzle-kit migrate
```

In Supabase **Auth → URL Configuration**, add `http://localhost:<port>` to the redirect URLs.

### 4. Run the app

```bash
bun run dev
```

The dev server prints its URL. Sign up with an email address, then explore.

### Useful scripts

| Command                             | What it does                                                          |
| ----------------------------------- | --------------------------------------------------------------------- |
| `bun run dev`                       | Vite dev server (SSR + HMR). Also regenerates `src/routeTree.gen.ts`. |
| `bun run build`                     | Production build (client + Nitro server bundle).                      |
| `bun run lint`                      | ESLint (includes the Prettier rule).                                  |
| `bun run format`                    | Prettier, writes changes.                                             |
| `bunx prettier --check .`           | Prettier, check only (what CI runs).                                  |
| `bunx tsc --noEmit`                 | Type-check the whole project.                                         |
| `bun run test`                      | Vitest, single run. `bun run test:watch` for watch mode.              |
| `node scripts/check-migrations.mjs` | Checks that `drizzle/migrations` and `meta/_journal.json` agree.      |

---

## Project tour

```
src/routes/__root.tsx            HTML shell, service worker registration
src/routes/_authenticated.tsx    auth guard + app shell (nav, Cmd+K, quick task, capture, idle logout)
src/routes/_authenticated/*      pages (Today, inbox, tasks, calendar, timeline, projects, notes, …)
src/routes/api/public/*          public HTTP endpoints (Telegram webhook, reminder cron)
src/lib/data.ts                  TanStack Query hooks + mutations (central data layer)
src/lib/*.functions.ts           server functions (createServerFn): ai, automations, googleCalendar
src/lib/*.server.ts, src/server/ server-only helpers (AI gateway, Telegram, crypto)
src/lib/blocks.ts, nlp.ts        note block engine; natural-language task parser
src/components/                  feature components + shadcn/ui primitives in components/ui
src/integrations/supabase/       Supabase clients, auth middleware, generated types
drizzle/migrations/              SQL migrations + drizzle journal
public/                          PWA manifest, service worker, icons
```

The [README](README.md#architecture) has a full architecture overview and the data model.

---

## Architecture rules

These rules come from [AGENTS.md](AGENTS.md), which is authoritative. PRs that break them will
be asked to change.

- **Data access goes through hooks in `src/lib/data.ts`** (TanStack Query keys
  `tasks/projects/notes/milestones/…`). Don't add ad-hoc `useQuery` calls for these entities.
  One cache keeps list, kanban, calendar and timeline in sync with optimistic updates.
- **Tasks are created and edited only through the global `TaskDialogProvider`**
  (`useTaskDialog().newTask/openTask`), mounted in the `_authenticated` layout. Every view opens
  the same editor.
- **All task mutations go through `useTaskActions()`**. It runs blocked checks, cycle rejection,
  auto-shift of dependents (`task_dependencies`), recurrence, unblock notifications and the
  `runAutomations` trigger.
- **Automations are evaluated server-side** in `runAutomations`
  (`src/lib/automations.functions.ts`). Actions write directly and must never re-trigger rules.
  Webhook and Telegram secrets stay on the server.
- **Team access is enforced in RLS** using the security-definer helpers `is_project_member`,
  `is_project_owner` and `can_access_task`. Never write policies that query `projects` or
  `project_members` directly (that causes recursive policies).
- **Notes store `blocks` (jsonb with stable block ids) as the source of truth** and mirror
  markdown into `content` (`content = toMarkdown(blocks)`). `[[links]]`, `((refs))` and queries
  are parsed client-side in `src/lib/blocks.ts`.
- **Natural-language task parsing is a local regex parser** (`src/lib/nlp.ts`). Don't replace it
  with AI calls.
- **Drag and drop** uses `@dnd-kit/core` (kanban, calendar). Timeline bars use raw pointer events
  because dnd-kit lacks resize semantics.
- **Every authenticated page uses `PageContainer`** (usually with `PageHeader`).
- **Google Calendar** uses the per-user App User Connector. Connection handles are AES-GCM
  encrypted server-side and never reach the browser.
- **Note collaboration** uses Yjs updates over Supabase Realtime; durable state stays in
  `notes.blocks`.
- **Deletes are soft** (`deleted_at`); archiving sets `archived_at`. List hooks exclude both, and
  `/archive` restores or purges. Never hard-delete from normal views.
- **Long lists paginate client-side** with `usePaged` / `LoadMore`
  (`src/components/common/LoadMore.tsx`).

If your change needs to break or extend one of these rules, say so in the PR and update
`AGENTS.md` (and `CLAUDE.md`) in the same PR.

### Generated files – don't hand-edit

- `src/routeTree.gen.ts` (regenerated by the TanStack Router plugin on `dev`/`build`; commit the
  regenerated file with your route changes)
- `src/integrations/supabase/{client,client.server,auth-middleware,auth-attacher,cron-auth,types}.ts`
- `drizzle/schema.ts`

### Build config

`vite.config.ts` uses `@lovable.dev/vite-tanstack-config`, which already includes TanStack Start,
React, Tailwind, tsconfig paths, Nitro and devtools. **Don't add these plugins again**; duplicates
break the app. Pass extra Vite options through `defineConfig({ vite: { … } })`.

---

## Common tasks

### Add a database migration

1. Create `drizzle/migrations/NNNN_descriptive_name.sql` using the next number. Prefer idempotent
   SQL (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, …).
2. For a new table:
   - `ALTER TABLE … ENABLE ROW LEVEL SECURITY;`
   - Owner policy (`user_id = auth.uid()`), plus `public.is_project_member(project_id, auth.uid())`
     for project-scoped data.
   - `GRANT … TO authenticated;` and `GRANT ALL … TO service_role;`
   - An `audit_row_change` trigger if the table should appear in the activity log.
   - `deleted_at` / `archived_at` columns if users can delete or archive rows.
3. Any `SECURITY DEFINER` function must set `SET search_path = public` and must check
   `auth.uid()` itself, because it bypasses RLS.
4. Register the migration in `drizzle/migrations/meta/_journal.json` (next `idx`, matching `tag`,
   increasing `when`). Run `node scripts/check-migrations.mjs` to verify.
5. Regenerate types:
   `supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts`
   (or `--local` against `supabase start`).
6. If the entity is shown in the UI, add a hook and query key in `src/lib/data.ts`, excluding
   soft-deleted and archived rows.
7. Never edit a migration that has already been merged. Add a new one instead.

### Add a route (page)

1. Create `src/routes/_authenticated/foo.tsx` → `/foo` (auth-guarded). Use `$param` for dynamic
   segments. See `src/routes/README.md` for the file-naming conventions.
2. Export the route and wrap the content in `PageContainer`:

   ```tsx
   export const Route = createFileRoute("/_authenticated/foo")({
     head: () => ({ meta: [{ title: "Foo — Second Brain" }] }),
     component: Foo,
   });

   function Foo() {
     return <PageContainer>{/* … */}</PageContainer>;
   }
   ```

3. For a sidebar entry, add it to `NAV` in `src/routes/_authenticated.tsx` and add i18n keys in
   `src/lib/preferences.tsx` (Indonesian and English).
4. Run `bun run dev` or `bun run build` so `src/routeTree.gen.ts` is regenerated, then commit it.
   CI fails if the committed route tree is stale.

### Add a public HTTP endpoint

Public endpoints live under `src/routes/api/public/…` and use
`server: { handlers: { POST: async ({ request }) => … } }`. They have **no session**: you must
authenticate the caller yourself (shared-secret header or token compared on the server), validate
the body, and scope every `supabaseAdmin` query explicitly.

### Add a server function

```ts
// src/lib/foo.functions.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const doFoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]) // context.supabase (RLS as the user), context.userId
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { helper } = await import("./foo.server"); // server-only code + secrets
    return helper(context.supabase, data.id);
  });
```

- Always use `requireSupabaseAuth` and validate input with zod.
- Put code that reads secrets in `*.server.ts` and load it with `await import(…)` inside the
  handler so it never reaches the client bundle.
- Use `supabaseAdmin` (service role, bypasses RLS) only when unavoidable, and scope its queries to
  `context.userId`. Never import `client.server.ts` from client code.
- Keep the global middleware in `src/start.ts` (`attachSupabaseAuth` and the CSRF middleware).

### Add UI text

UI strings are mostly Indonesian, with an English option via `src/lib/preferences.tsx`. When you
add text that goes through the i18n layer, add both languages.

---

## Code style

- **TypeScript strict mode** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `noPropertyAccessFromIndexSignature` (use `process.env["NAME"]`, not `process.env.NAME`).
- **Prettier** (`.prettierrc`: 100 columns, double quotes, trailing commas) and **ESLint**
  (`eslint.config.js`). Run `bun run format` on the files you touch.
  > Much of the code imported from Lovable is not yet Prettier-formatted, so CI's format check is
  > currently non-blocking. Please format only the files you change, to keep diffs reviewable; a
  > single repo-wide formatting commit will be done separately.
- **Path alias** `@/` maps to `src/`.
- **Components**: reuse shadcn/ui primitives in `src/components/ui` (Radix-based, accessible by
  default) before building custom widgets.
- **Styling**: Tailwind utilities with the design tokens from `src/styles.css`. Don't hard-code
  colors; use `bg-background`, `text-muted-foreground`, etc. so light and dark themes keep
  sufficient contrast.
- `.editorconfig` defines whitespace basics for any editor.

---

## Testing

- Vitest + jsdom + Testing Library. Config: `vitest.config.ts`, setup: `src/test/setup.ts`.
- Tests live next to the code or in `src/test/`, matching `src/**/*.{test,spec}.{ts,tsx}`.
- Add unit tests for pure logic (parsers, date math, block engine, automation conditions) and
  component tests for user-visible behavior. Prefer queries by role and label
  (`getByRole("button", { name: … })`), which also catch accessibility regressions.
- Bug fixes should come with a regression test when practical.

Before opening a PR, run:

```bash
bun run lint
bunx tsc --noEmit
bun run test
bun run build      # required for routing, server function, config or dependency changes
```

CI runs the same checks plus a Prettier check, a migration-journal check, CodeQL and dependency
review.

---

## Branches and commits

### Branches

Branch from `main` and use a short, descriptive name with a type prefix:

```
feat/kanban-keyboard-moves
fix/timeline-resize-off-by-one
docs/contributing-setup
chore/deps-radix
```

### Commits – Conventional Commits

Commit messages follow [Conventional Commits 1.0](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary in the imperative>

<optional body: what and why>

<optional footer: Closes #123, BREAKING CHANGE: …>
```

| Type       | Use for                                                 |
| ---------- | ------------------------------------------------------- |
| `feat`     | A new user-facing feature                               |
| `fix`      | A bug fix                                               |
| `docs`     | Documentation only                                      |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                                 |
| `test`     | Adding or fixing tests                                  |
| `build`    | Build system or dependencies                            |
| `ci`       | GitHub Actions and other CI config                      |
| `chore`    | Maintenance that doesn't fit elsewhere                  |
| `revert`   | Reverts a previous commit                               |

Suggested scopes: `tasks`, `kanban`, `calendar`, `timeline`, `notes`, `graph`, `inbox`, `ai`,
`automations`, `projects`, `auth`, `db`, `telegram`, `gcal`, `pwa`, `a11y`, `i18n`, `deps`.

Examples:

```
feat(timeline): allow resizing bars with the keyboard
fix(db): add missing GRANT on templates for service_role
docs: document the reminder cron setup
```

Mark breaking changes with `!` (`feat(db)!: …`) and a `BREAKING CHANGE:` footer that explains the
migration path.

---

## Pull request flow

1. **Open or find an issue** for non-trivial changes and mention that you're working on it.
2. **Fork** the repo (external contributors) or create a branch (maintainers).
3. **Make focused changes.** One logical change per PR; avoid drive-by reformatting of unrelated
   files.
4. **Run the checks** listed in [Testing](#testing).
5. **Update docs and `CHANGELOG.md`** (under _Unreleased_) when behavior changes.
6. **Open the PR** against `main` using the template. Use a Conventional Commit style title; PRs
   are usually squash-merged, so the title becomes the commit message on `main`.
7. **CI must be green.** Respond to review comments by pushing new commits to your branch.
   Don't force-push once review has started, so reviewers can see what changed.
8. A maintainer merges once approved. Code owners (see `.github/CODEOWNERS`) are requested
   automatically.

Draft PRs are welcome for early feedback.

---

## Review checklist

Reviewers (and authors, before requesting review) check:

**Correctness**

- [ ] The change does what the PR says, and edge cases (empty states, nulls, time zones,
      recurrence, blocked tasks) are handled.
- [ ] Tests cover the new logic or the fixed bug.

**Architecture**

- [ ] Data goes through `src/lib/data.ts` hooks; tasks through `TaskDialogProvider` /
      `useTaskActions`.
- [ ] Views stay in sync (list, kanban, calendar, timeline) and optimistic updates roll back on
      error.
- [ ] Soft delete / archive semantics are respected; long lists use `usePaged` / `LoadMore`.
- [ ] Pages use `PageContainer`.

**Security**

- [ ] New tables have RLS enabled, policies and grants; project-scoped access uses the
      security-definer helpers.
- [ ] Server functions use `requireSupabaseAuth` and validate input.
- [ ] Secrets stay in server-only modules; nothing sensitive is added to `VITE_*` or logged.
- [ ] Public endpoints authenticate callers; `supabaseAdmin` queries are explicitly scoped.
- [ ] No new dependency without a good reason (check size, maintenance and license).

**UX and accessibility**

- [ ] Keyboard reachable, visible focus, labelled controls (`aria-label` for icon-only buttons).
- [ ] Works in light and dark mode and at mobile widths.
- [ ] Indonesian and English strings provided where i18n applies.

**Housekeeping**

- [ ] Generated files were regenerated, not hand-edited (`routeTree.gen.ts`, Supabase types).
- [ ] Migrations registered in the journal; no edits to merged migrations.
- [ ] Docs and changelog updated.

---

## CI/CD

GitHub Actions workflows live in `.github/workflows/`:

| Workflow                | Trigger                     | What it does                                                                                                                                                                                                |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | push / PR to `main`         | ESLint, Prettier check (currently non-blocking, see below), `tsc --noEmit`, Vitest, `vite build` with placeholder `VITE_*` values plus a stale `routeTree.gen.ts` check, and `scripts/check-migrations.mjs` |
| `codeql.yml`            | push / PR to `main`, weekly | CodeQL `security-extended` analysis for JavaScript/TypeScript                                                                                                                                               |
| `dependency-review.yml` | PR to `main`                | Fails on new dependencies with high or critical advisories                                                                                                                                                  |
| `deploy.yml`            | push / PR to `main`         | Optional Vercel CLI deploy (preview for PRs, production for `main`)                                                                                                                                         |

Shared setup (Bun from `.bun-version`, install cache, `bun install --frozen-lockfile`) is in
`.github/actions/setup`.

**Deployments.** Vercel's Git integration deploys previews and production on its own once the repo
is imported in Vercel; no GitHub secrets are needed for that. `deploy.yml` is an alternative for
when you want deploys to run from Actions. It only runs when the repository secrets
`VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are all set (get the IDs from
`.vercel/project.json` after `bunx vercel link`) and skips with a notice otherwise, including for
PRs from forks. It sets `NITRO_PRESET=vercel` and pulls app env vars from the Vercel project. If
you enable it, turn off automatic Git deployments in Vercel to avoid deploying twice.

**Prettier.** The code imported from Lovable is not Prettier-formatted yet, so the `format` job
uses `continue-on-error: true`. After a one-off `bun run format` commit, remove that line to make
formatting blocking.

---

## Lovable sync caveats

This repository is connected to [Lovable](https://lovable.dev), which mirrors the git history of
`main` into its editor.

- **Never rewrite published history.** No force-pushes to `main`, and no rebasing, amending or
  squashing of commits that are already on `main`. Lovable would lose the project history.
  (Rebasing your own unmerged feature branch is fine.)
- **Every commit on `main` syncs to Lovable**, so `main` must always build. Only merge green PRs.
- Changes made in the Lovable editor arrive as normal commits on `main`. Pull before you branch,
  and rebase or merge `main` into your feature branch if you fall behind.
- Lovable applies migrations itself in its environment; your migration must still be correct for
  `drizzle-kit migrate`.
- Don't add Vite plugins that `@lovable.dev/vite-tanstack-config` already provides.

---

## Documentation

| File                                 | Purpose                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| [README.md](README.md)               | Features, architecture, data model, setup, deployment            |
| [AGENTS.md](AGENTS.md)               | Authoritative architecture rules (also read by AI coding agents) |
| [CLAUDE.md](CLAUDE.md)               | Practical notes for AI coding agents                             |
| [SECURITY.md](SECURITY.md)           | Vulnerability reporting and security architecture                |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | Accessibility target, current state and known gaps               |
| [CHANGELOG.md](CHANGELOG.md)         | Release notes (Keep a Changelog)                                 |

When you change behavior, update the relevant document in the same PR. Architecture changes must
update `AGENTS.md`.

Thank you for contributing!

# Security Policy

Second Brain stores personal tasks, notes and calendar data, so we take security reports
seriously. Thank you for helping keep users safe.

## Supported versions

The project is pre-1.0 and ships from `main`. Only the latest code on `main` (and the most recent
tagged release, once releases exist) receives security fixes.

| Version                | Supported |
| ---------------------- | --------- |
| `main` (latest)        | Yes       |
| Latest `0.x` release   | Yes       |
| Older releases / forks | No        |

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for security problems.**

Report privately through GitHub Security Advisories:
**[Report a vulnerability](https://github.com/ilramdhan/second-brain/security/advisories/new)**
(repository → _Security_ → _Advisories_ → _Report a vulnerability_).

> Maintainer note: private vulnerability reporting must be enabled under
> _Settings → Code security → Private vulnerability reporting_.

Please include:

- A description of the issue and its impact (what an attacker can read, change or do).
- Steps to reproduce or a proof of concept, including the affected route, server function, table
  or migration.
- The commit hash you tested, and whether it was local, self-hosted or a Lovable preview.
- Any suggested fix.

Please test only against your own deployment and accounts. Don't access other users' data,
degrade service for others, or run automated scanners against deployments you don't own.

### Response targets

| Stage                                 | Target                                  |
| ------------------------------------- | --------------------------------------- |
| Acknowledge receipt                   | within 3 business days                  |
| Initial assessment and severity       | within 7 business days                  |
| Fix or mitigation for critical / high | within 30 days                          |
| Fix for medium / low                  | next planned release, or within 90 days |

This is a volunteer-maintained project, so these are goals rather than guarantees. We will keep
you updated, agree on a disclosure date with you, and credit you in the advisory unless you prefer
to stay anonymous.

## Scope

**In scope**

- Code in this repository: the TanStack Start app (`src/`), server functions
  (`src/lib/*.functions.ts`), public API routes (`src/routes/api/public/*`), SQL migrations and
  RLS policies (`drizzle/migrations/`), the service worker (`public/sw.js`) and CI workflows
  (`.github/`).
- Authorization bypasses (reading or writing another user's or another project's data), secret
  leakage to the browser, injection, SSRF, XSS, CSRF, and insecure defaults that ship with the
  repository.

**Out of scope**

- Vulnerabilities in Supabase, Vercel, Lovable or other third-party services themselves (report
  those to the vendor), unless our configuration or usage causes the issue.
- Misconfiguration of a specific self-hosted deployment (for example leaving
  `TELEGRAM_WEBHOOK_SECRET` unset), except where the documentation is wrong or misleading.
- Denial of service by volume, missing rate limiting without a demonstrated impact, social
  engineering, physical attacks.
- Findings from automated tools without a demonstrated exploit path.
- `docs/n8n/` reference material (not part of this app).

## Security architecture

This section describes how the app is meant to be secure, so reporters and contributors can
reason about it. It reflects the code at the time of writing; please report any place where the
code doesn't match.

### Authentication

- Supabase Auth handles sign-up and sign-in. The browser client uses the **publishable (anon)
  key** only (`VITE_SUPABASE_*`).
- `src/start.ts` registers `attachSupabaseAuth` as global function middleware (attaches the user's
  access token to server function calls) and TanStack Start's **CSRF middleware** for server
  functions.
- An optional idle-logout timer (`src/hooks/use-idle-logout.ts`) signs users out after a
  configurable period of inactivity.

### Authorization: Row Level Security

- **Every table in `public` has RLS enabled** (all 23 tables created by the migrations).
- Personal data uses owner policies (`user_id = auth.uid()`).
- Shared projects are handled by `SECURITY DEFINER` helpers defined in
  `0002_workspace_features.sql`: `is_project_owner`, `is_project_member` and `can_access_task`.
  Policies for tasks, notes, milestones, comments and members call these helpers instead of
  querying `projects` / `project_members` directly, which avoids recursive policy evaluation.
  Tasks, notes and milestones in a shared project are visible to its members.
- Other `SECURITY DEFINER` functions (`accept_project_invites`, `list_project_people`,
  `search_semantic_documents`, the sign-up trigger, audit and note-version triggers) all pin
  `SET search_path = public` and constrain results with `auth.uid()`.
- Service-role-only tables: `app_config` (holds `cron_token`) and `app_user_connections` (encrypted
  connector handles) have RLS enabled with no policies for `authenticated`, and grants only to
  `service_role`.

### Server functions

- All 12 server functions (`ai.functions.ts`, `automations.functions.ts`,
  `googleCalendar.functions.ts`) use the `requireSupabaseAuth` middleware, which builds a
  **per-user Supabase client** so queries run under the caller's RLS. Inputs are validated with
  zod.
- The service-role client (`supabaseAdmin`, `src/integrations/supabase/client.server.ts`) bypasses
  RLS. It is only imported dynamically inside server handlers and must always be scoped to the
  authenticated user or to an authenticated public-endpoint caller.

### Secrets

- Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `TELEGRAM_API_KEY`,
  `TELEGRAM_WEBHOOK_SECRET`, `GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY`,
  `APP_USER_CONNECTION_KEY_SECRET`) are read only via `process.env[...]` in server-only modules
  (`*.server.ts`, `src/server/`, server function handlers, API routes). They are never prefixed
  with `VITE_` and never sent to the browser.
- Automation actions that need secrets (Telegram messages, outgoing webhooks) run on the server
  in `runAutomations`.

### Encrypted connector handles (Google Calendar)

- Per-user Google Calendar access uses the Lovable App User Connector. The resulting connection
  handle is encrypted with **AES-256-GCM** (random 96-bit IV per value) in
  `src/server/connectionKeyCrypto.server.ts`, keyed by `APP_USER_CONNECTION_KEY_SECRET`, and stored
  in `app_user_connections`, which only `service_role` can access. Handles never reach the browser
  and are not shared between users.

### Public API routes

These routes have no user session and authenticate the caller themselves:

| Route                               | Authentication                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/public/telegram/webhook` | If `TELEGRAM_WEBHOOK_SECRET` is set, requires a matching `X-Telegram-Bot-Api-Secret-Token` header.                                                                    |
| `POST /api/public/hooks/reminders`  | Requires `Authorization: Bearer <token>` where the token equals `app_config.cron_token` (a random UUID created by migration `0001`, readable only by `service_role`). |

### Outgoing requests

- Automation webhooks only allow `https:` URLs.
- AI, Telegram and Google Calendar calls go to Lovable gateways (`ai.gateway.lovable.dev`,
  `connector-gateway.lovable.dev`) with server-side keys.

## Known hardening items

These are known weaknesses or missing defenses. They are tracked here so self-hosters can assess
risk; contributions are welcome (please coordinate via an issue or a private advisory for the
first three).

1. **Telegram `/link <email>` has no verification.** The webhook links the sending Telegram chat
   to whichever account has that email address. Anyone who knows a user's email can link their
   own chat, then add items to that user's Inbox and receive that user's deadline reminders and
   automation messages. Fix: issue a one-time code from the signed-in app (Settings) and require
   `/link <code>` instead. The lookup also uses a single unpaginated
   `auth.admin.listUsers()` call, so it won't find users beyond the first page on larger
   instances.
2. **Telegram webhook secret is optional.** If `TELEGRAM_WEBHOOK_SECRET` is unset, anyone can POST
   forged updates to the webhook. Self-hosters should always set it; the code should probably fail
   closed in production.
3. **Note collaboration channels are not private.** `use-note-collaboration.ts` joins the Supabase
   Realtime channel `note-collab:<noteId>` without `private: true` or Realtime Authorization
   policies, so a client with the public anon key that knows a note's UUID could subscribe to its
   broadcast updates and inject changes into open editors (persistence still goes through RLS).
   Fix: private channels plus `realtime.messages` policies based on note access.
4. **Reminder cron token.** The token is static (no rotation or expiry), compared with a plain
   string comparison rather than a constant-time one, and the generated `cron-auth.ts` helper
   (`LOVABLE_CRON_SECRET`) is unused. Rotate it with
   `update app_config set value = gen_random_uuid()::text where key = 'cron_token'` if leaked.
5. **Outgoing webhook SSRF surface.** Automation webhooks accept any `https:` URL, including hosts
   that resolve to private or link-local addresses. Consider blocking private ranges and adding a
   timeout.
6. **No application-level rate limiting** on AI server functions or public endpoints; AI usage is
   billed to the deployment's `LOVABLE_API_KEY`.
7. **No Content-Security-Policy or other security headers** are set by the app. Configure them at
   the hosting layer (for example `vercel.json` headers) for production deployments.

## Hardening checklist for self-hosters

- Set `TELEGRAM_WEBHOOK_SECRET` and register it with Telegram's `setWebhook`.
- Keep `SUPABASE_SERVICE_ROLE_KEY` and `APP_USER_CONNECTION_KEY_SECRET` only in server
  environment variables; never in `VITE_*`.
- Restrict Supabase Auth redirect URLs to your own domains.
- Enable email confirmation in Supabase Auth so invites and links are tied to verified emails.
- Add security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`)
  at the hosting layer.
- Keep dependencies updated (Dependabot is configured) and review CodeQL alerts.

## Automated checks

- **CodeQL** (`.github/workflows/codeql.yml`) with the `security-extended` query suite on pushes,
  PRs and weekly.
- **Dependency review** (`.github/workflows/dependency-review.yml`) blocks PRs that add
  dependencies with known high or critical vulnerabilities.
- **Dependabot** (`.github/dependabot.yml`) for Bun packages and GitHub Actions.
- Bun's `minimumReleaseAge` (24 h) in `bunfig.toml` guards against freshly published malicious
  package versions.

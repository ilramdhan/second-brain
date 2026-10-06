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
- The commit hash you tested, and whether it was local or self-hosted (Vercel or another host).
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
  RLS policies (`drizzle/migrations/`), the service worker (Workbox config in `vite.config.ts`) and CI workflows
  (`.github/`).
- Authorization bypasses (reading or writing another user's or another project's data), secret
  leakage to the browser, injection, SSRF, XSS, CSRF, and insecure defaults that ship with the
  repository.

**Out of scope**

- Vulnerabilities in Supabase, Vercel, Lovable or other third-party services themselves (report
  those to the vendor), unless our configuration or usage causes the issue.
- Misconfiguration of a specific self-hosted deployment (for example exposing
  `SUPABASE_SERVICE_ROLE_KEY`), except where the documentation is wrong or misleading.
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

- **Every table in `public` has RLS enabled** (every table created by the migrations, including `rate_limits` from `0011`).
- Personal data uses owner policies (`user_id = auth.uid()`).
- Shared projects are handled by `SECURITY DEFINER` helpers defined in
  `0002_workspace_features.sql`: `is_project_owner`, `is_project_member` and `can_access_task`.
  Policies for tasks, notes, milestones, comments and members call these helpers instead of
  querying `projects` / `project_members` directly, which avoids recursive policy evaluation.
  Tasks, notes and milestones in a shared project are visible to its members.
- Shared-project rows have separate select/insert/update/delete policies
  (`0010_member_ownership_guards.sql`, all using `(select auth.uid())`):
  - Inserts require `user_id = auth.uid()` and membership of the target project.
  - A `BEFORE UPDATE` trigger (`prevent_user_id_change`) rejects any change of `user_id` by an
    end-user role on projects, tasks, notes, milestones, canvas tables, comments and
    dependencies.
  - Members may edit and archive shared tasks, notes, milestones and boards. Trashing or
    restoring (`deleted_at`, enforced by the `guard_project_row_update` trigger) and hard deletes
    are limited to the row's creator or the project owner. Rows can only be moved into projects
    the user belongs to. Canvas nodes and edges are updated only by their author.
  - Only the project owner can update or delete a project.
- Other `SECURITY DEFINER` functions (`accept_project_invites`, `list_project_people`,
  `search_semantic_documents`, the sign-up trigger, audit and note-version triggers) all pin
  `SET search_path = public` and constrain results with `auth.uid()`.
- Service-role-only tables: `app_config` (holds `cron_token`), `app_user_connections` (encrypted
  OAuth tokens), `rate_limits` and `n8n_events` (idempotency ledger) have RLS enabled with no
  policies for `authenticated`, and grants only to `service_role`. The helpers
  `n8n_user_id_by_email` and `consume_rate_limit_for` are executable only by `service_role`.

### Realtime

- Note collaboration uses the **private** channel `note-collab:<noteId>`
  (`src/hooks/use-note-collaboration.ts`, `config.private = true`, JWT refreshed with
  `supabase.realtime.setAuth()`). Realtime Authorization policies on `realtime.messages`
  (`0009_private_note_collab_channels.sql`) allow SELECT (join/receive) and INSERT
  (broadcast/presence) only when `can_access_note` holds for the topic's note: the caller owns the
  note or is a member of its project, and the note is not in the trash. Topics that are not
  `note-collab:<uuid>` are denied without raising.
- The client ignores collaboration payloads that do not arrive on the live private channel.

### Server functions

- All server functions (`ai.functions.ts`, `automations.functions.ts`,
  `googleCalendar.functions.ts`, `telegram.functions.ts`) use the `requireSupabaseAuth`
  middleware, which builds a **per-user Supabase client** so queries run under the caller's RLS.
  Inputs are validated with zod.
- AI server functions cap their inputs (brain dump 20k characters, paraphrase 5k, meeting notes
  50k, audio 10 MB, images 8 MB; base64 sizes are checked before decoding) and share a per-user
  budget of **30 calls per 10 minutes**. The budget is enforced by the `SECURITY DEFINER`
  function `consume_rate_limit(bucket, max, window_seconds)` (migration `0011_rate_limits`),
  which always uses `auth.uid()`; the `rate_limits` table has RLS on and no client privileges.
  The limiter fails closed if the database call errors.
- The service-role client (`supabaseAdmin`, `src/integrations/supabase/client.server.ts`) bypasses
  RLS. It is only imported dynamically inside server handlers and must always be scoped to the
  authenticated user or to an authenticated public-endpoint caller.

### Secrets

- Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY`, `SECOND_BRAIN_CRON_SECRET`,
  `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GOOGLE_CLIENT_SECRET`,
  `TOKEN_ENCRYPTION_KEY`, `N8N_API_KEY`) are read only via `process.env[...]` in server-only
  modules (`*.server.ts`, `src/server/`, server function handlers, API routes). They are never
  prefixed with `VITE_` and never sent to the browser. The Telegram token is part of the Bot API
  URL, so `telegram.server.ts` never logs request URLs.
- Automation actions that need secrets (Telegram messages, outgoing webhooks) run on the server
  in the automation engine (`src/server/automationEngine.server.ts`).

### Google Calendar OAuth tokens

- Each deployment uses its own Google OAuth 2.0 web client (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`) with the authorization code flow, PKCE (S256), `access_type=offline` and
  the single scope `calendar.events`.
- The OAuth `state` is AES-256-GCM encrypted and contains the user id, a nonce, the PKCE verifier
  and a 10-minute expiry. The callback page only forwards `code` and `state` to its opener
  (same-origin `postMessage`) and clears them from the URL; the server completes the flow only
  for the signed-in user the state was issued to, so a leaked or injected code cannot connect a
  calendar to a different account, and the verifier never reaches the browser.
- The code is exchanged server-side. The refresh token (and the cached access token) is encrypted
  with **AES-256-GCM** (random 96-bit IV per value, `src/server/tokenCrypto.server.ts`, key
  `TOKEN_ENCRYPTION_KEY`, base64 of 32 bytes) and stored in `app_user_connections`, which only
  `service_role` can access. Tokens never reach the browser or n8n and are not shared between
  users. `invalid_grant` on refresh deletes the connection; disconnect revokes the token at Google.

### Public API routes

These routes have no user session and authenticate the caller themselves:

| Route                                    | Authentication                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/public/telegram/webhook`      | Fails closed: requires `TELEGRAM_WEBHOOK_SECRET` to be set and a matching `X-Telegram-Bot-Api-Secret-Token` header (constant-time comparison); otherwise 401.                                                                                                                                                                                                                                                                     |
| `/api/public/n8n/*`                      | Fails closed: header `x-api-key` must match `N8N_API_KEY` (or `N8N_API_KEY_PREVIOUS` during rotation) in constant time; 500 when no key is configured, 401 otherwise. Bodies and queries are validated with zod, bodies are capped at 1 MB. The service-role client is scoped to the user resolved from `profiles.telegram_chat_id` or the sender email; tasks/notes of shared projects are included only for owners and members. |
| `GET`/`POST /api/public/hooks/reminders` | Requires `Authorization: Bearer <token>` matching `SECOND_BRAIN_CRON_SECRET`, `SECOND_BRAIN_CRON_SECRET_PREVIOUS` (rotation) or `CRON_SECRET` (Vercel Cron), compared in constant time. The legacy `app_config.cron_token` still works and is only looked up when a bearer token is present and no env secret matched.                                                                                                            |

### Telegram account linking

- A chat is linked to an account only with a one-time code issued to the signed-in user in
  Settings (`createTelegramLinkCode`). Codes have 8 characters from a 32-symbol alphabet
  (40 bits), expire after 10 minutes, work once, and a new code invalidates the previous unused
  ones.
- Only the SHA-256 hash is stored in `telegram_link_codes`. RLS lets users read and insert their
  own rows; clients cannot set `expires_at` or `used_at`. The bot redeems a code with one
  conditional update (unused and unexpired), so concurrent attempts cannot reuse it.
- The bot gives the same reply for wrong, expired and used codes and never looks up users by
  email. App mode (`/api/public/telegram/webhook`) and n8n mode (`/api/public/n8n/bot`) share the
  same redemption code (`src/server/telegramLink.server.ts`); n8n additionally enforces
  `TELEGRAM_ALLOWED_CHAT_IDS` (empty = deny all).

### n8n integration

- n8n is a relay: it never receives Supabase keys, Google tokens or `TOKEN_ENCRYPTION_KEY`; it only
  holds `N8N_API_KEY`, the Telegram bot token and its own credentials (Google Drive, SMTP, IMAP).
- Retries are idempotent: `n8n_events (source, external_id)` stores the first response for a
  Telegram `update_id` or capture `external_id`.
- Backups (`GET /api/public/n8n/backup`) contain all user data but never `app_user_connections`,
  `app_config`, link codes or idempotency rows. The backup workflow stores no execution data;
  protect the Google Drive folder and the backup mailbox accordingly.
- AI calls made for a user from n8n (`/sum`, long-email summaries) spend that user's AI budget via
  `consume_rate_limit_for`.

### Outgoing requests

- Automation webhooks go through an SSRF guard (`src/server/ssrf.server.ts`): `https:` only, no
  credentials in the URL, port 443 or 8443 only, internal hostnames (`localhost`, `*.local`,
  `*.internal`, `metadata.google.internal`, single-label names) and literal private IPs are
  rejected, and every A/AAAA record of the host must be a public address (private, loopback,
  link-local incl. `169.254.169.254`, CGNAT, multicast, unspecified, documentation, NAT64/6to4
  and IPv4-mapped IPv6 are blocked). Redirects are not followed (3xx is a failure), requests time
  out after 5 seconds and at most 64 KB of the response is read. The payload contains only the
  task's id, title, status, priority, due date, project id, tags and a link.
- Residual risk: on runtimes without `node:dns` (Cloudflare Workers) the DNS step is skipped and
  only the static checks apply; Workers cannot reach private networks, so this mainly matters
  on Node hosts. DNS rebinding between the check and the request is mitigated, not eliminated,
  by the redirect, timeout and size limits.
- AI calls go directly to the configured provider (`AI_BASE_URL`, default `api.openai.com`) with
  a server-side key; OpenAI requests set `store: false`. Telegram goes to `api.telegram.org` and
  Google to `oauth2.googleapis.com` / `www.googleapis.com` directly; these URLs are fixed, not
  user-supplied.

## Known hardening items

These are known weaknesses or missing defenses. They are tracked here so self-hosters can assess
risk; contributions are welcome (please coordinate via an issue or a private advisory for the
first one).

1. **CSP resources are report-only.** Only framing, `<base>`, plugin and form-target directives
   are enforced; the full resource policy is sent as `Content-Security-Policy-Report-Only` (see
   "Content Security Policy").
2. **Public endpoints are not rate limited** at the application level (the AI functions are).
   Use the hosting provider's firewall or rate limiting for `/api/public/*`.

### Fixed

- **Outgoing automation webhooks allowed SSRF** (any `https:` URL, including internal hosts,
  followed redirects, no timeout) and sent the full task row. Fixed with the SSRF guard and a
  minimal payload. See "Outgoing requests".
- **Reminder cron token** was compared with a plain string comparison and queried the database
  on every unauthenticated request. Fixed with constant-time env secrets (with rotation) and a
  legacy fallback that is only consulted for requests carrying a token.
- **AI server functions had no input limits or rate limit.** Fixed with zod limits and a
  per-user budget. See "Server functions".
- **Sign-out kept the query cache**, so the next user of a shared device could briefly see the
  previous user's data. The cache is cleared on every sign-out path.
- **Backup restore upserted raw rows**, letting a crafted file set any column (including
  `user_id`) on rows that RLS allowed, including shared-project rows. Restores now validate each
  table with a zod schema, drop unknown columns, force `user_id` to the current user, cap the file
  (20 MB, 10,000 rows per table) and never update rows owned by someone else.
- **No security headers were sent.** See "Security headers".

- **Note collaboration channels were public** (anyone with the anon key and a note UUID could
  read live edits and inject Yjs updates that the victim's editor autosaved). The channel is now
  private and authorized by `realtime.messages` policies. See "Realtime".
- **Project members could take over a project** by setting `projects.user_id` to themselves, and
  could insert or reassign tasks, notes, milestones and canvas rows as other users, or trash and
  delete other members' rows. Fixed with immutable `user_id`, per-operation policies and
  owner-only project updates. See "Authorization: Row Level Security".

- **Telegram `/link <email>` had no verification** (anyone who knew a user's email could link
  their own chat, receive that user's reminders and write to their Inbox; replies also revealed
  whether an email was registered). Replaced by one-time codes from Settings; the email lookup
  and `auth.admin.listUsers()` call were removed. See "Telegram account linking".
- **Telegram webhook secret was optional** (forged updates were accepted when
  `TELEGRAM_WEBHOOK_SECRET` was unset). The webhook now fails closed and compares the header in
  constant time.

### Security headers

`src/server/securityHeaders.ts` defines one header set. `src/server.ts` adds it to every SSR and
API response in production builds on any host (routes may set their own values, which win;
`SECURITY_HEADERS=off` disables it), and `vercel.json` applies the same set to static assets on
Vercel (a unit test keeps both in sync). `vite dev` does not send them, so HSTS is never pinned
on localhost and dev tooling is not blocked by the CSP.

| Header                                | Value                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security`           | `max-age=63072000; includeSubDomains`                                                          |
| `X-Content-Type-Options`              | `nosniff`                                                                                      |
| `X-Frame-Options`                     | `DENY`                                                                                         |
| `Referrer-Policy`                     | `strict-origin-when-cross-origin`                                                              |
| `Permissions-Policy`                  | only `microphone=(self)` (voice capture); camera, geolocation etc. off                         |
| `Content-Security-Policy`             | **enforced:** `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'` |
| `Content-Security-Policy-Report-Only` | full resource policy, see below                                                                |

#### Content Security Policy

The resource policy is **report-only** for now:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:; font-src 'self' data:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co; media-src 'self' blob:;
worker-src 'self'; manifest-src 'self'; frame-src 'self'; frame-ancestors 'none';
base-uri 'self'; object-src 'none'; form-action 'self'
```

Why report-only: TanStack Start emits inline hydration scripts without a nonce (so
`script-src` needs `'unsafe-inline'`), the browser talks to Supabase directly (a custom Supabase
domain needs its own `connect-src` entry). AI, Telegram and Google calls run on the server, so
the browser needs no AI provider or Google origins. To enforce: open the deployed app, use every feature (login, realtime notes,
voice capture, Google Calendar connect, PWA install) with the console open, add any reported
origin, then move the policy from `CSP_REPORT_ONLY` to `CSP_ENFORCED` in
`src/server/securityHeaders.ts` and regenerate the `vercel.json` entry (the unit test fails until
both match).

## Hardening checklist for self-hosters

- Set `TELEGRAM_WEBHOOK_SECRET` and register it with Telegram's `setWebhook` (`secret_token`).
  Without it the bot webhook rejects every update.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`,
  `TELEGRAM_BOT_TOKEN` and `N8N_API_KEY` only in server environment variables; never in `VITE_*`.
- Use a long random `N8N_API_KEY` (`openssl rand -hex 32`), keep n8n behind HTTPS, set
  `TELEGRAM_ALLOWED_CHAT_IDS` and `EMAIL_ALLOWED_SENDERS`, and rotate via `N8N_API_KEY_PREVIOUS`.
- Restrict Supabase Auth redirect URLs to your own domains.
- Enable email confirmation in Supabase Auth so invites and links are tied to verified emails.
- Set `SECOND_BRAIN_CRON_SECRET` or `CRON_SECRET` (`openssl rand -hex 32`) for the reminder cron and
  stop relying on `app_config.cron_token`. To rotate, move the old value to
  `SECOND_BRAIN_CRON_SECRET_PREVIOUS` until every scheduler uses the new one.
- Check the browser console for `Content-Security-Policy-Report-Only` violations on your domain
  before enforcing the full CSP (see "Content Security Policy").
- In Supabase _Realtime → Settings_, consider disabling "Allow public access" so every channel
  must be private.
- Keep dependencies updated (Dependabot is configured) and review CodeQL alerts.

## Automated checks

- **CodeQL** (`.github/workflows/codeql.yml`) with the `security-extended` query suite on pushes,
  PRs and weekly.
- **Dependency review** (`.github/workflows/dependency-review.yml`) blocks PRs that add
  dependencies with known high or critical vulnerabilities.
- **Dependabot** (`.github/dependabot.yml`) for Bun packages and GitHub Actions.
- Bun's `minimumReleaseAge` (24 h) in `bunfig.toml` guards against freshly published malicious
  package versions.

# Public demo deployment

Step-by-step guide for running the public demo at **https://demo-2ndbrain.ilramdhan.dev**. The demo
is a second deployment of this repository (same `main` branch) with its own Vercel project and its
own Supabase project. It never touches production data. Its behavior is switched by environment
variables, not by a fork:

- `APP_MODE=demo` + `VITE_APP_MODE=demo`: demo notice card (top of the app, landing and login; dismissible for the browser session), demo login, integrations off (Telegram, Google
  Calendar, outgoing webhooks, n8n endpoints, backup restore), simulated AI, per-IP rate limit,
  `noindex`.
- Database guards (migration 0019): per-user row limits, text-size caps and a write quota, and the
  demo account's email/password cannot be changed or deleted.
- A **daily reset at 00:00 WIB** (`/api/public/n8n/demo/reset`): it hard-deletes everything the demo
  account owns and inserts fresh example data for every page (`src/server/demo/seed-data.ts`), with
  dates relative to the reset day.

Shared login (shown on `/login`): `demo@ilramdhan.dev` / `demo2ndbrain`.

> You only need to do steps 1–6 once. After that the demo maintains itself.

## Contents

1. [Supabase project](#1-supabase-project)
2. [Run the migrations](#2-run-the-migrations)
3. [Vercel project and environment variables](#3-vercel-project-and-environment-variables)
4. [Domain (Cloudflare → Vercel)](#4-domain-cloudflare--vercel)
5. [First seed](#5-first-seed)
6. [Check the Vercel Cron job](#6-check-the-vercel-cron-job)
7. [Optional: n8n workflow 09](#7-optional-n8n-workflow-09)
8. [Show the demo button in production](#8-show-the-demo-button-in-production)
9. [Rotate the demo password](#9-rotate-the-demo-password)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Supabase project

1. In [Supabase](https://supabase.com/dashboard) create a **new project** (Free tier), e.g.
   `second-brain-demo`. Pick the region closest to your visitors (e.g. Singapore). Save the database
   password in your password manager.
2. **Authentication → Sign In / Providers → Email**:
   - turn **off** _Allow new users to sign up_ (visitors use the shared account; the reset creates it
     through the admin API, which is not affected by this switch);
   - leave _Confirm email_ as it is: the reset creates the account already confirmed.
3. **Authentication → URL Configuration**:
   - _Site URL_: `https://demo-2ndbrain.ilramdhan.dev`
   - _Redirect URLs_: add `https://demo-2ndbrain.ilramdhan.dev/**`. Add your Vercel preview pattern
     too if you test previews (e.g. `https://*-<team>.vercel.app/**`).
4. **Project Settings → API Keys**: copy the project URL, the **publishable** (anon) key and the
   **secret** (service-role) key. You need them in step 3.
5. **Project Settings → Database → Connect**: copy the **Session pooler** connection string (works
   over IPv4) for step 2.

Do not create the demo user by hand: the first reset does it (step 5).

## 2. Run the migrations

From a local checkout of `main`, with the connection string from step 1.5 (password filled in):

```bash
DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  npx drizzle-kit migrate
```

(`bunx drizzle-kit migrate` works the same.) This applies every file in `drizzle/migrations/` up to
`0019_demo_limits.sql`. The demo limits stay inactive until the first reset writes
`demo_mode = 'on'` to `public.app_config`.

Run the same command again whenever a later release adds a migration.

## 3. Vercel project and environment variables

1. In [Vercel](https://vercel.com/new) → **Add New… → Project** → import the **same GitHub
   repository** again. Name it e.g. `second-brain-demo`.
2. Build settings (same as production): Framework preset _Other_, install command `bun install`,
   build command `bun run build`, output directory empty (Nitro writes `.vercel/output`).
3. **Settings → Environment Variables**: add the variables below for **Production** (and Preview if
   you use previews), then deploy.

### Set these

| Variable                         | Value                                                   | Where it comes from                                                                     |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `APP_MODE`                       | `demo`                                                  | Fixed. Server guards **and**, at build time, registers the daily Vercel Cron            |
| `VITE_APP_MODE`                  | `demo`                                                  | Fixed. Demo UI (banner, demo login, disabled controls)                                  |
| `VITE_SUPABASE_URL`              | `https://<demo-ref>.supabase.co`                        | Demo Supabase → Project Settings → API (step 1.4)                                       |
| `VITE_SUPABASE_PUBLISHABLE_KEY`  | `sb_publishable_…` (or the legacy anon key)             | Same page, publishable key                                                              |
| `SUPABASE_URL`                   | same as `VITE_SUPABASE_URL`                             | Same page                                                                               |
| `SUPABASE_PUBLISHABLE_KEY`       | same as `VITE_SUPABASE_PUBLISHABLE_KEY`                 | Same page                                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`      | `sb_secret_…` (or the legacy service-role key)          | Same page, secret key. **Secret**                                                       |
| `CRON_SECRET`                    | random, `openssl rand -hex 32`                          | Generate it. Vercel Cron sends it as `Authorization: Bearer …`; you use it in step 5    |
| `APP_URL`                        | `https://demo-2ndbrain.ilramdhan.dev`                   | Fixed (public base URL)                                                                 |
| `VITE_PROD_URL`                  | `https://2ndbrain.ilramdhan.dev`                        | Optional (this is the default). Linked from the demo banner                             |
| `VITE_DEMO_EMAIL`                | `demo@ilramdhan.dev`                                    | Optional (default). Shown on `/login`                                                   |
| `VITE_DEMO_PASSWORD`             | `demo2ndbrain`                                          | Optional (default). Shown on `/login`; public, not a secret                             |
| `DEMO_EMAIL` / `DEMO_PASSWORD`   | same as the two above                                   | Optional. Used by the reset when it creates the account; falls back to the `VITE_` pair |
| `APP_TIMEZONE`                   | `Asia/Jakarta`                                          | Optional (default). Defines "today" for the seed dates                                  |
| `DEMO_IP_RATE_LIMIT`             | `120`                                                   | Optional (default). Requests per minute per IP to `/_serverFn/*` and `/api/*`           |
| `N8N_API_KEY`                    | random, `openssl rand -hex 32`, **different from prod** | Only if you use n8n workflow 09 (step 7)                                                |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | a separate Sentry project/environment                   | Optional                                                                                |

`APP_MODE` must be set **before** the build: Vercel exposes project env vars to the build, and
`vite.config.ts` only adds the cron job (`0 17 * * *` UTC = 00:00 WIB →
`/api/public/n8n/demo/reset`) to `.vercel/output/config.json` when `APP_MODE=demo`. If you add it
later, redeploy. The production project never gets this cron, so its Hobby cron slot stays free.

### Do NOT set these on the demo

| Variable                                                                                        | Why                                                                         |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_VISION_MODEL`, `AI_TRANSCRIBE_*`    | AI is simulated with fixtures in demo mode; a key would only be a liability |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`                        | Telegram is disabled in the demo                                            |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URL`, `TOKEN_ENCRYPTION_KEY` | Google Calendar is disabled in the demo                                     |
| `SECOND_BRAIN_CRON_SECRET`, `SECOND_BRAIN_CRON_SECRET_PREVIOUS`                                 | Not needed (`CRON_SECRET` covers the reset); never reuse production secrets |
| `N8N_API_KEY_PREVIOUS`, and **any production secret or Supabase key**                           | The demo must not be able to reach production                               |
| `VITE_DEMO_URL`                                                                                 | Production only (the landing page's "Coba Demo" button), see step 8         |
| `VITE_ALLOW_SIGNUP`                                                                             | Sign-up is always hidden in demo mode                                       |
| `DATABASE_URL`                                                                                  | Tooling only (migrations from your machine); the app never reads it         |
| `NITRO_PRESET`                                                                                  | Leave unset (Vercel preset); another preset would not write the cron        |

## 4. Domain (Cloudflare → Vercel)

1. **Vercel → demo project → Settings → Domains → Add**: type `demo-2ndbrain.ilramdhan.dev`
   **without** `https://` and without a trailing slash. Choose "Connect to an environment:
   Production". Vercel shows the DNS record it expects.
2. **Cloudflare → ilramdhan.dev → DNS → Records → Add record**:
   - Type `CNAME`, Name `demo-2ndbrain`, Target `cname.vercel-dns.com`
   - **Proxy status: DNS only (grey cloud)**. An orange-cloud proxy breaks Vercel's certificate
     issuance and adds a second CDN in front of Vercel.
   - TTL Auto.
3. Back in Vercel the domain turns "Valid Configuration" and the certificate is issued within a few
   minutes.

## 5. First seed

The reset endpoint creates the demo account if it does not exist, switches demo mode on in the
database, and seeds the data. After the first successful deploy, run once:

```bash
curl -sS -X POST https://demo-2ndbrain.ilramdhan.dev/api/public/n8n/demo/reset \
  -H "Authorization: Bearer $CRON_SECRET"
```

(`GET` works too; that is what Vercel Cron uses.) A successful response looks like:

```json
{
  "ok": true,
  "user_id": "…",
  "created_user": true,
  "today": "2026-10-06",
  "inserted": { "projects": 8, "tasks": 48, "notes": 17, "…": "…" },
  "ms": 2400
}
```

Then open https://demo-2ndbrain.ilramdhan.dev/login → **Masuk sebagai demo** and click through
Today, Inbox, Tasks, Calendar, Timeline, Projects, Notes, Graph, Canvas, Automations, Reports,
Templates, Archive and Activity.

What the reset does (`src/server/demo/seed.server.ts`):

1. `ensureDemoUser()`: creates `demo@ilramdhan.dev` (confirmed) and two teammate accounts shown as
   project members (`rina.demo@example.com`, `budi.demo@example.com`, random passwords, they never
   sign in) if they are missing, **then** upserts `app_config` `demo_user_email` and
   `demo_mode = 'on'`. An existing account's password is never touched.
2. Hard-deletes every row the three accounts own, children first (soft-deleted rows would still
   count toward the row limits), plus rate-limit windows, n8n events and the audit log.
3. Inserts the seed with the service role (which bypasses RLS and the demo limits), batched per
   table; a reset takes a few seconds, far below the Vercel function timeout.

Running it again at any time is safe: the result is the same data for that day.

Alternative from your machine (same effect, no deploy needed):

```bash
APP_MODE=demo SUPABASE_URL=https://<demo-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=sb_secret_… \
  npx bun@1.4.2 scripts/demo-seed.ts
```

## 6. Check the Vercel Cron job

**Vercel → demo project → Settings → Cron Jobs** (older dashboards: the _Cron Jobs_ tab) should
list:

| Path                         | Schedule     |
| ---------------------------- | ------------ |
| `/api/public/n8n/demo/reset` | `0 17 * * *` |

`0 17 * * *` is 17:00 UTC = **00:00 WIB**. On the Hobby plan Vercel runs daily crons once per day
somewhere within the scheduled hour, so the reset happens between 00:00 and 00:59 WIB. Use **Run**
next to the job to trigger it manually, and the function logs (_Logs_, filter `demo/reset`) to see
the result.

If the list is empty: `APP_MODE` was not set at build time → set it and redeploy (see
[Troubleshooting](#10-troubleshooting)). Cron jobs only run on the production deployment, not on
previews.

## 7. Optional: n8n workflow 09

Vercel Cron is enough. Use n8n only if you want a second, exact-time scheduler (or prefer to see the
runs next to the other workflows):

1. Set `N8N_API_KEY` on the **demo** Vercel project (a new random value, not the production key)
   and redeploy.
2. In n8n: _Settings → Variables_ (or the instance env) → `SB_DEMO_APP_URL =
https://demo-2ndbrain.ilramdhan.dev`.
3. _Credentials → New → Header Auth_ named **Second Brain Demo API**: name `x-api-key`, value = the
   demo `N8N_API_KEY`.
4. Import `integrations/n8n/09-second-brain-demo-reset.json`, select the credential, activate. It
   runs every day at 00:00 Asia/Jakarta (`POST /api/public/n8n/demo/reset`, 3 retries).

Running both Vercel Cron and n8n is harmless (the reset is idempotent), just redundant.

## 8. Show the demo button in production

In the **production** Vercel project (`2ndbrain.ilramdhan.dev`) add

```
VITE_DEMO_URL=https://demo-2ndbrain.ilramdhan.dev
```

for Production (and Preview if wanted), then **Redeploy** (it is a build-time variable). The landing
page then shows **Coba Demo** in the hero, the header and the mobile menu. Do not set it on the demo
project itself.

## 9. Rotate the demo password

While `demo_mode = 'on'` the database refuses every password/email change and delete of the demo
account, even through the admin API. To change it:

1. Pick a time away from 00:00 WIB (a reset in between switches demo mode back on).
2. Demo Supabase → **SQL Editor**:

   ```sql
   update public.app_config set value = 'off' where key = 'demo_mode';
   ```

3. **Authentication → Users** → `demo@ilramdhan.dev` → _Reset password_ / set a new password (or
   use the admin API).
4. Switch the guard back on:

   ```sql
   update public.app_config set value = 'on' where key = 'demo_mode';
   ```

5. In the demo Vercel project set `VITE_DEMO_PASSWORD` (and `DEMO_PASSWORD` if you use it) to the new
   value and **redeploy**, so `/login` shows the right password.

To rename the account, do the same with `demo_mode` off: delete the old user, set `VITE_DEMO_EMAIL`
/ `DEMO_EMAIL`, redeploy and run the reset (step 5), which creates the new account and updates
`demo_user_email`.

## 10. Troubleshooting

| Symptom                                                         | Cause / fix                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `curl` returns `404 {"error":"not found"}`                      | `APP_MODE` is not `demo` on this deployment (the endpoint does not exist outside the demo). Set `APP_MODE=demo` and `VITE_APP_MODE=demo`, redeploy.                            |
| `401 {"error":"unauthorized"}`                                  | Wrong or missing `Authorization: Bearer` value: it must equal the demo project's `CRON_SECRET` (no quotes, no trailing newline). For n8n: wrong `x-api-key`.                   |
| `500 {"error":"N8N_API_KEY not configured"}`                    | You called it with `x-api-key` but the demo has no `N8N_API_KEY`. Use the Bearer `CRON_SECRET` or set the key.                                                                 |
| `500 {"error":"reset failed"}`                                  | Check the function log. Usual causes: migrations not applied (step 2), wrong `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (the publishable key does not work), project paused. |
| No cron job in Vercel                                           | `APP_MODE=demo` was missing during the build, or `NITRO_PRESET` is set. Fix the env and redeploy; the build output's `config.json` then contains `crons`.                      |
| Cron listed but data not reset                                  | Hobby runs within the hour (00:00–00:59 WIB). Check _Logs_; a 401 means `CRON_SECRET` changed without a redeploy.                                                              |
| Login fails with "Invalid login credentials"                    | The account does not exist yet (run step 5), or `VITE_DEMO_PASSWORD` differs from the real password (step 9).                                                                  |
| "Batas demo: email dan kata sandi akun demo tidak bisa diubah." | Expected while `demo_mode` is on; see step 9.                                                                                                                                  |
| Visitors hit "Batas demo: …" errors                             | Row limit or hourly write quota reached; the next reset clears it. Tune with `app_config` keys `demo_limit:<table>`, `demo_write_max`, `demo_write_window` (migration 0019).   |
| Supabase project paused                                         | Free projects pause after a week without traffic; the daily reset normally keeps it active. Restore it in the dashboard, then run step 5.                                      |
| Domain stuck on "Invalid Configuration"                         | Cloudflare record is proxied (orange cloud) or points elsewhere. It must be `CNAME demo-2ndbrain → cname.vercel-dns.com`, **DNS only**.                                        |
| Dates look a day off                                            | `APP_TIMEZONE` differs from the visitors' zone; the seed uses `APP_TIMEZONE` (default `Asia/Jakarta`).                                                                         |

Smoke test against the live demo (Playwright, skipped unless the URL is set):

```bash
E2E_DEMO_BASE_URL=https://demo-2ndbrain.ilramdhan.dev npx playwright test e2e/demo.spec.ts
```

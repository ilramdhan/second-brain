# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is `0.x`,
minor releases may contain breaking changes; they are called out under **Changed** or
**Removed**.

## [Unreleased]

### Added

- MIT license.
- Community and governance docs: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant
  2.1), `SECURITY.md` (private reporting and security architecture), `ACCESSIBILITY.md` (WCAG 2.2
  AA target, current state and known gaps).
- GitHub Actions: CI (ESLint, Prettier check, TypeScript, Vitest, build, migration journal check),
  CodeQL, dependency review, and an optional Vercel deploy workflow that skips when secrets are
  missing.
- Dependabot for Bun packages and GitHub Actions, issue forms, pull request template and
  CODEOWNERS.
- `.env.example`, `.editorconfig`, `.nvmrc`, `.bun-version` and
  `scripts/check-migrations.mjs`.
- n8n workflow templates in `integrations/n8n/`.
- `README.md` and `CLAUDE.md` project documentation.
- "Hubungkan Telegram" in Settings: generates a one-time Telegram link code (8 characters,
  10-minute TTL, single use) and shows the linked status once the bot confirms. New table
  `telegram_link_codes` (migration `0008_telegram_link_codes`).

### Changed

- **Breaking:** the Telegram bot links accounts with `/link <code>` instead of `/link <email>`.
  Users who are already linked stay linked.

### Security

- Telegram webhook fails closed: requests are rejected with 401 when `TELEGRAM_WEBHOOK_SECRET`
  is unset or the `X-Telegram-Bot-Api-Secret-Token` header does not match (constant-time
  comparison). Deployments must set the secret and re-register it with `setWebhook`.
- Telegram account linking no longer trusts an email address, which let anyone link their chat to
  another user's account and revealed whether an email was registered. The `auth.admin.listUsers()`
  lookup was removed.

## [0.1.0] - 2026-10-05

Initial import of the project from Lovable.

### Added

- **Inbox and AI capture**: text, voice, photo and Telegram input; AI splits brain dumps into
  tasks, issues and notes (Lovable AI Gateway).
- **Tasks** with list, kanban, calendar and Gantt-style timeline views sharing one TanStack Query
  cache; subtasks, priorities, review status, assignees, recurrence, time-blocking, time entries
  and a focus timer.
- **Dependencies** (`task_dependencies`) with blocked checks, cycle rejection and automatic
  shifting of dependents.
- **Automations** evaluated server-side, with Telegram and outgoing HTTPS webhook actions.
- **Block-based notes** with `[[wiki links]]`, `((block references))`, transclusion, backlinks,
  Dataview-style queries, a note graph, version snapshots and real-time collaboration (Yjs over
  Supabase Realtime).
- **Projects** with milestones, team members, email invites and task comments, enforced by Row
  Level Security.
- **Canvas boards**, reports, activity log with audit triggers, templates, archive and trash
  (soft delete with 30-day retention).
- **Integrations**: per-user Google Calendar via the Lovable App User Connector (encrypted
  connection handles), Telegram bot and reminder cron endpoint.
- Semantic search with pgvector.
- Installable PWA, Indonesian and English UI, light and dark themes.
- Database schema as SQL migrations `0000`–`0007` in `drizzle/migrations/`.

[Unreleased]: https://github.com/ilramdhan/second-brain/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ilramdhan/second-brain/releases/tag/v0.1.0

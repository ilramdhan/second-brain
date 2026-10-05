# Second Brain

[![CI](https://github.com/ilramdhan/second-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/ilramdhan/second-brain/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ilramdhan/second-brain/actions/workflows/codeql.yml/badge.svg)](https://github.com/ilramdhan/second-brain/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A personal and team **task & notes management PWA**: capture thoughts quickly (text, voice, photo, Telegram), let AI turn raw brain dumps into structured tasks and notes, then plan the work across list, kanban, calendar and Gantt-style timeline views. A block-based notes editor provides bidirectional links, block references, a graph view and live collaboration.

Built with TanStack Start (React 19 SSR + server functions) on Supabase (Postgres + Auth + Realtime). The project is synced with [Lovable](https://lovable.dev).

> The default UI language is Indonesian, and you can switch to English in Settings. AI prompts and Telegram bot replies are in Indonesian.

---

## Table of contents

1. [Why Second Brain](#why-second-brain)
2. [Features](#features)
3. [Tech stack](#tech-stack)
4. [Architecture](#architecture)
5. [Directory structure](#directory-structure)
6. [Data model](#data-model)
7. [Environment variables](#environment-variables)
8. [Local setup](#local-setup)
9. [Scripts](#scripts)
10. [Database migrations](#database-migrations)
11. [Deployment to Vercel](#deployment-to-vercel)
12. [Integrations](#integrations)
13. [Testing](#testing)
14. [Lovable sync caveat](#lovable-sync-caveat)
15. [Contributing / Community](#contributing--community)
16. [License](#license)

---

## Why Second Brain

- **Capture everywhere, sort later.** Every input (typed, spoken, photographed or sent from Telegram) lands in one Inbox. AI then splits it into tasks, issues and notes and groups them by project.
- **One task model, many views.** List, kanban, calendar and timeline views all read the same query cache. A change in one view appears in all of them right away.
- **Notes that connect.** Block-level IDs make `[[wiki links]]`, `((block references))`, transclusion, backlinks, a note graph and Dataview-style queries possible without extra tables.
- **Built for teams.** You can share projects with collaborators by email. Row Level Security (RLS) controls access to tasks, notes, milestones, comments and canvases in shared projects.
- **Safe by default.** Deletes are soft (trash with 30-day retention), archived items can be restored, notes keep version snapshots, a database trigger writes an activity audit log, and you can export everything to a JSON backup.

---

## Features

### Today dashboard (`/`)

A daily agenda that shows overdue tasks, tasks due today and this week, upcoming milestones and pending inbox items.

### Inbox & AI brain-dump processing (`/inbox`)

- Inbox items come from manual entry, Telegram, voice or OCR (`inbox_items.source`).
- **AI → structure** (`parseBrainDump`): the AI splits an item into separate `task` / `issue` / `note` entries. Each entry gets a priority, an ISO due date (relative dates like "besok"/"Jumat" are resolved), 1–3 tags, a short paraphrased description and a project name. The parser matches existing projects by name and creates missing ones. Tasks and notes are then inserted, and the item is marked `processed`.
- **Paraphrase** (`paraphrasePoint`): expands a terse point into a 2–4 sentence description. The original text is kept in `ai_summary`.
- You can archive items.

### Quick capture (global)

- A floating capture button (center of the mobile bottom nav) and a capture sheet in `QuickCapture.tsx`:
  - **Text**: saved straight to the Inbox.
  - **Voice**: records with `MediaRecorder`, then transcribes server-side (`transcribeVoice`, max 10 MB).
  - **Photo / OCR**: extracts text from whiteboard photos or handwriting (`ocrImage`) and marks unreadable parts with `[?]`.
- **Quick task** (press `Q` anywhere outside an input): one-line task entry with a live natural-language preview (see NLP below).

### Natural-language task parsing (`src/lib/nlp.ts`)

A local regex parser for Indonesian and English. It makes no AI call and costs nothing. It extracts:

- Dates: `hari ini/today`, `besok/tomorrow`, `lusa`, `minggu depan/next week`, `bulan depan`, `3 hari lagi`, `in 2 weeks`, weekdays (`senin`, `friday`, `jumat depan`), `12 agustus 2026`, `12/8`, `tgl 12`
- Time: `jam 10 pagi`, `14:30`, `7pm`, `nanti malam`
- `#tag`, `@assignee`, `+Project`, priority `!tinggi` / `!high` / `p1`
- Recurrence: `setiap hari`, `every week`, `tiap bulan`

Example: `Meeting evaluasi besok jam 10 pagi #urgent @budi !tinggi +Website`

### Tasks (`/tasks`, project pages)

- Fields: title, description, status (`todo` → `in_progress` → `review` → `done`), priority, start and due dates, tags, project, milestone, assignee (a project member or a free-text name), estimate in minutes, time-block end, recurrence (daily, weekly or monthly).
- **Views**: list, kanban board (drag & drop with `@dnd-kit`), and upcoming. You can filter by search, status, priority, project, tag and assignee.
- **Subtasks** (`parent_id`). Deleting a parent also soft-deletes its subtasks, and restoring the parent restores them.
- **Comments** on each task (`task_comments`). Automations can also post comments.
- **Recurring tasks**: when you complete a recurring task, the app creates the next occurrence with its dates shifted.
- **Single editor**: the global `TaskDialogProvider` handles all task creation and editing from every view. It also hosts dependencies, subtasks, comments, the focus timer and Google Calendar sync.

### Task dependencies

- `task_dependencies` stores blocker → blocked pairs.
- **Blocked check**: you cannot move a task out of `todo` while it still has an open blocker. The UI shows "Terkunci" (locked).
- **Cycle rejection**: adding a dependency that would create a loop is rejected on the client.
- **Auto-shift**: pushing a blocker's due date later shifts every transitive dependent's start and due dates by the same amount.
- **Unblock notifications**: when a blocker is completed, the assignees (or owners) of freed tasks get a Telegram message (`notifyUnblocked`).

### Calendar (`/calendar`)

Day, week, month and year views. Drag a task to another day to move it, or drag its edge to change its duration (`@dnd-kit`).

### Timeline / Gantt (`/timeline`, project tab)

A Gantt-style timeline of projects, tasks, milestones and launch dates, with a "today" marker. You can drag bars to move them and use pointer events to resize either end.

### Projects & teams (`/projects`, `/projects/$projectId`)

- **PARA** classification (`project` / `area` / `resource` / `archive`), status, color, start, due and launch dates.
- Nested projects (`parent_id`) with **grid, kanban and tree** views.
- Each project page has tabs for overview, tasks, milestones, timeline, notes and team.
- **Sharing**: the owner invites people by email (`project_invites`). When an invited user signs in, `accept_project_invites()` turns the invitation into a `project_members` row. Members see and edit the project's tasks, notes, milestones and canvases. `list_project_people()` resolves names and emails.

### Notes (`/notes`, `/notes/$noteId`)

- Notes list in **grid or kanban** (by note status), with pinning and tags.
- **Block editor** (`BlockEditor.tsx`): paragraph, H1–H3, to-do, bullet, numbered, quote, code, divider, query and embed blocks. It supports Markdown shortcuts (`#`, `-`, `[]`, `>`, ` ``` `, `---`) and a slash menu.
- **Links**: `[[Note title]]` wiki links and `((blockId))` block references. **Embed blocks** transclude (mirror) another block.
- **Backlinks**: shows the notes that link to the current note or reference its blocks.
- **Properties**: key/value metadata (`notes.properties`) that queries can use.
- **Query blocks** (Dataview-like), evaluated on the client:
  `TABLE rating, genre FROM #buku WHERE rating > 4 AND genre = fiksi SORT rating DESC LIMIT 10`
  `LIST FROM "Project name"`, `TABLE status FROM tasks WHERE status != done`
- **AI meeting minutes** (`summarizeMeeting`): turns raw notes into Markdown minutes (summary, discussion points, action items).
- **Version history**: a database trigger snapshots the previous version at most every 10 minutes. You can restore any snapshot from a side sheet.
- Storage: `notes.blocks` (jsonb) is the source of truth. Markdown is mirrored into `notes.content` for search and AI.

### Real-time collaboration

When several users open the same note, edits sync through **Yjs** updates over a Supabase Realtime broadcast channel (`note-collab:<noteId>`). Presence shows how many people are active, and live cursors are rendered. Durable state is still saved to `notes.blocks`.

### Graph view (`/graph`)

An interactive force-directed graph (`d3-force`) of notes, with edges from wiki links and block references.

### Canvas (`/canvas`)

A basic visual board: add idea cards, edit their title and content, select two cards to connect them, and delete cards. Data lives in `canvas_boards`, `canvas_nodes` and `canvas_edges`. You can only edit your own nodes. (A richer infinite canvas with media embeds is still on the roadmap.)

### Automations (`/automations`)

If-this-then-that rules for tasks, evaluated server-side in `runAutomations`:

- **Triggers**: task created, status changed (optionally to a specific value), priority changed, assignee changed, due date changed.
- **Conditions**: priority, status, project, tag or assignee, with `eq`, `neq` or `contains`.
- **Actions**: set a field (priority, status or assignee), add a tag, shift the due date by N days, post a comment, send a Telegram message, or POST a JSON payload to an **HTTPS webhook** (payload `{ text, content, rule, event, project, task }`, compatible with Slack, Discord and n8n).
- Templates support `{{title}} {{status}} {{priority}} {{assignee}} {{project}} {{due}}`.
- Each run is logged to `automation_runs`, and `run_count` and `last_run_at` are updated. Actions write directly to the database, so they never trigger rules again.

### Focus timer & reports (`/reports`)

- A Pomodoro timer inside the task dialog counts down from the task's `estimate_minutes` and saves sessions to `time_entries`.
- Weekly report of focus time per project and per task (Recharts).

### Google Calendar (per user)

In **Settings**, each user connects their own Google Calendar through a popup OAuth flow (the Lovable App User Connector). The connection handle is encrypted with AES-GCM and stored server-side in `app_user_connections`, so it never reaches the browser. From the task dialog, you can push a scheduled task to Google Calendar as an event. The event is created the first time and updated after that (`tasks.google_event_id`).

### Telegram bot

- Users link their account in **Settings → Bot Telegram → Hubungkan Telegram**, which shows a one-time code (valid for 10 minutes, single use), and send `/link <code>` to the bot. After that, any message they send goes to their Inbox.
- The bot sends deadline reminders: a cron call to `/api/public/hooks/reminders` sends Telegram reminders for tasks due within 24 hours or overdue.
- Automations and unblock notifications can also send Telegram messages.

### Templates, archive & trash

- **Templates** (`/templates`): reusable task or note templates (`templates` table).
- **Archive** (`archived_at`) and **Trash** (`deleted_at`, soft delete) for tasks and notes. Projects support trash only. The `/archive` page restores items, permanently deletes them, and purges trash items older than **30 days**.

### Activity log (`/activity`)

A full audit trail. Database triggers on every main table log insert, update and delete actions, including the names of changed fields but never note or task content. The app also logs auth events (sign-in, sign-out, idle timeout).

### Settings (`/settings`)

- Theme (light, dark or system) and language (Indonesian or English).
- **Idle auto sign-out** after N minutes. Activity in any tab resets the timer.
- Telegram link status and unlink, Google Calendar connect and disconnect.
- **JSON backup and restore** (projects, tasks, notes, milestones, dependencies, automations). Restoring never deletes existing data.

### Command menu

Press `Cmd/Ctrl + K` to search tasks, projects and notes and jump to them, or to create a new task.

### PWA

`manifest.webmanifest` makes the app installable (standalone mode, maskable icons). `public/sw.js` caches the app shell and static images, fonts and the manifest, and falls back to the cached shell when a page is opened offline. Server function and `/api/` requests are never cached.

### Authentication

Supabase email/password sign-up and sign-in (`/login`). Every page under the `_authenticated` layout redirects to `/login` when there is no session.

---

## Tech stack

| Layer              | Technology                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Framework          | [TanStack Start](https://tanstack.com/start) 1.168 (SSR, file-based routing, server functions, server routes) |
| UI                 | React 19, Tailwind CSS 4, shadcn/ui (Radix primitives), lucide-react, sonner, cmdk, vaul                      |
| Data fetching      | TanStack Query 5 (shared cache, optimistic updates)                                                           |
| Routing            | TanStack Router 1.170 (generated `routeTree.gen.ts`)                                                          |
| Build              | Vite 8 (rolldown) via `@lovable.dev/vite-tanstack-config`, Nitro 3 (server bundling and deploy presets)       |
| Backend / DB       | Supabase: Postgres + RLS, Auth, Realtime (broadcast/presence), `pgvector`                                     |
| Migrations         | Hand-written SQL in `drizzle/migrations` tracked by drizzle-kit                                               |
| Drag & drop        | `@dnd-kit/core` / `sortable`                                                                                  |
| Collaboration      | Yjs over Supabase Realtime                                                                                    |
| Graph              | d3-force                                                                                                      |
| Charts             | Recharts                                                                                                      |
| AI                 | Vercel AI SDK (`ai`, `@ai-sdk/openai`) through the Lovable AI Gateway                                         |
| Forms / validation | react-hook-form, zod                                                                                          |
| Dates              | date-fns 4                                                                                                    |
| Testing            | Vitest 4, Testing Library, jsdom                                                                              |
| Lint / format      | ESLint 9 (typescript-eslint, react-hooks), Prettier                                                           |
| Package manager    | Bun (`bun.lock`, `bunfig.toml` with a 24 h minimum-release-age guard)                                         |

---

## Architecture

```
Browser (React 19 + TanStack Query)
 │  ├─ Supabase JS client ──────────────► Supabase Postgres (RLS enforced, anon/publishable key + user JWT)
 │  ├─ Supabase Realtime channel ───────► note-collab:<id> (Yjs updates, presence, cursors)
 │  └─ server function RPC (+ Bearer JWT via attachSupabaseAuth)
 ▼
TanStack Start server (Nitro)
 ├─ src/start.ts         global middleware: error page, CSRF (server fns), auth header attacher
 ├─ src/server.ts        SSR entry wrapper (normalizes swallowed h3 errors into an HTML 500 page)
 ├─ *.functions.ts       createServerFn + requireSupabaseAuth → per-request Supabase client as the user
 │     ai.functions.ts, automations.functions.ts, googleCalendar.functions.ts
 ├─ *.server.ts          server-only helpers (AI gateway, Telegram send, AES-GCM crypto)
 └─ src/routes/api/public/*   unauthenticated HTTP endpoints (Telegram webhook, reminder cron)
        └─ supabaseAdmin (service role) — bypasses RLS, used only on the server
 ▼
External: Lovable AI Gateway · Lovable connector gateway (Telegram, Google Calendar) · user webhooks
```

### Data flow

- **Reads and writes from the client** go through hooks in `src/lib/data.ts` (`useTasks`, `useProjects`, `useNotes`, `useMilestones`, `useDeps`, `useAutomations`, plus `use*Actions`). They share TanStack Query keys (`tasks`, `projects`, `notes`, `milestones`, `deps`, `automations`), so list, kanban, calendar and timeline update together. Updates are optimistic (`setQueryData`) and then invalidated.
- **Task mutations** all go through `useTaskActions()`. It handles blocked checks, auto-shifting dependents, recurring tasks, unblock notifications, and triggering `runAutomations` after create and update.
- **List hooks exclude** soft-deleted (`deleted_at`) and archived (`archived_at`) rows. `/archive` queries them directly.
- **Long lists** paginate on the client with `usePaged` / `LoadMore`.

### Server functions & auth

- `attachSupabaseAuth` (a global function middleware) adds the user's access token to every server-function RPC.
- `requireSupabaseAuth` validates the JWT (`auth.getClaims`) and gives handlers `context.supabase` (a client acting as the user, so RLS still applies) and `context.userId`.
- `supabaseAdmin` (service role, `client.server.ts`) is used only where RLS must be bypassed: the Telegram webhook, the reminder cron, reading other users' Telegram chat IDs for unblock notifications, and the encrypted connection store.
- CSRF middleware protects server functions.

### Row Level Security

- Every table has RLS enabled. Owner policies use `auth.uid() = user_id`.
- Team access uses the **security-definer** helpers `is_project_owner`, `is_project_member` and `can_access_task`. These avoid recursive policies. Tasks, notes, milestones, canvases, comments, dependencies and note versions in a shared project are visible to all members.
- `app_config` and `app_user_connections` have no policies, so only the service role can read them.

### Realtime

Only note collaboration uses Realtime: broadcast events `y-update` and `cursor`, plus presence on `note-collab:<noteId>`. Other views stay in sync through the TanStack Query cache, not `postgres_changes`.

### Database-side automation

- `handle_new_user` trigger creates a `profiles` row on sign-up.
- `audit_row_change` triggers write to `activity_logs`.
- `snapshot_note_change` writes `note_versions` (throttled to 10 minutes).

---

## Directory structure

```
.
├── AGENTS.md                  # Architecture rules (authoritative; read first)
├── CLAUDE.md                  # Guide for Claude Code
├── roadmap.md                 # Feature roadmap / status
├── package.json               # Scripts and dependencies (Bun)
├── vite.config.ts             # @lovable.dev/vite-tanstack-config wrapper (server entry → src/server.ts)
├── vitest.config.ts           # Vitest (jsdom, @ alias)
├── drizzle.config.ts          # drizzle-kit config (LOVABLE_DB_MIGRATION_URL)
├── drizzle/
│   ├── schema.ts              # Intentionally blank (auto-generated placeholder)
│   └── migrations/            # 0000–0007 SQL migrations + meta journal/snapshots
├── supabase/config.toml       # Supabase project id
├── public/
│   ├── manifest.webmanifest   # PWA manifest
│   ├── sw.js                  # Service worker (shell + static asset cache)
│   └── favicon.png, icon-192.png, icon-512.png, robots.txt
└── src/
    ├── server.ts              # SSR entry wrapper with error page fallback
    ├── start.ts               # TanStack Start instance: global middleware
    ├── router.tsx             # Router + QueryClient factory
    ├── routeTree.gen.ts       # GENERATED route tree — do not edit
    ├── styles.css             # Tailwind 4 theme tokens
    ├── routes/
    │   ├── __root.tsx         # HTML shell, meta, manifest, SW registration, providers
    │   ├── login.tsx          # Email/password sign-in & sign-up
    │   ├── _authenticated.tsx # Auth guard + app shell (sidebar, mobile nav, command menu, quick capture, idle logout)
    │   ├── _authenticated/    # index (Today), inbox, tasks, calendar, timeline, projects.*, notes.*,
    │   │                      # graph, canvas, automations, reports, templates, archive, activity, settings
    │   ├── oauth/google-calendar/return.tsx   # OAuth popup return → postMessage to opener
    │   └── api/public/
    │       ├── telegram/webhook.ts            # Telegram bot webhook (POST)
    │       └── hooks/reminders.ts             # Deadline reminder cron endpoint (POST)
    ├── server/
    │   └── connectionKeyCrypto.server.ts      # AES-GCM encrypt/decrypt of connector handles
    ├── lib/
    │   ├── data.ts                # Query hooks, CRUD/soft-delete, task actions, dependencies, date helpers
    │   ├── automations.functions.ts # runAutomations / notifyUnblocked server fns
    │   ├── automation-types.ts    # Shared trigger/condition/action types
    │   ├── ai.functions.ts        # AI server fns (brain dump, paraphrase, minutes, transcribe, OCR)
    │   ├── ai.server.ts           # Lovable AI Gateway client (AI SDK)
    │   ├── googleCalendar.functions.ts # Google Calendar connect/disconnect/status/sync server fns
    │   ├── telegram.server.ts     # sendTelegram via connector gateway
    │   ├── blocks.ts              # Block model, markdown, links/refs, graph, query engine
    │   ├── nlp.ts                 # Natural-language task parser (ID/EN)
    │   ├── preferences.tsx        # Theme + locale provider and i18n strings
    │   ├── activity.ts            # log_activity RPC helper
    │   ├── constants.ts           # Status/priority/PARA/recurrence/color enums
    │   └── error-*.ts, lovable-error-reporting.ts, utils.ts
    ├── components/
    │   ├── ui/                    # shadcn/ui primitives
    │   ├── common/                # PageContainer, PageHeader, LoadMore/usePaged, TagInput
    │   ├── tasks/                 # TaskDialogProvider, TaskViews, TaskItem, TaskFilters, QuickTask, FocusTimer
    │   ├── notes/                 # BlockEditor, NotesBoard
    │   ├── projects/              # ProjectDialog
    │   └── CommandMenu, Kanban, Timeline, QuickCapture
    ├── hooks/                     # use-note-collaboration (Yjs), use-idle-logout, use-mobile
    ├── integrations/
    │   ├── supabase/              # client (browser/SSR), client.server (service role), auth middleware,
    │   │                          # auth attacher, cron-auth, generated DB types
    │   └── lovable/appUserConnector.ts  # Lovable App User Connector (Google OAuth) gateway calls
    └── test/                      # Vitest setup + routing smoke test
```

---

## Data model

The source of truth is the SQL in `drizzle/migrations/` (`drizzle/schema.ts` is intentionally blank). Every table lives in `public`, and `user_id` references `auth.users(id)`.

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : "handle_new_user"
    AUTH_USERS ||--o{ PROJECTS : owns
    PROJECTS ||--o{ PROJECTS : "parent_id"
    PROJECTS ||--o{ PROJECT_MEMBERS : has
    PROJECTS ||--o{ PROJECT_INVITES : has
    PROJECTS ||--o{ MILESTONES : has
    PROJECTS ||--o{ TASKS : contains
    PROJECTS ||--o{ NOTES : contains
    PROJECTS ||--o{ CANVAS_BOARDS : contains
    PROJECTS ||--o{ TIME_ENTRIES : "project_id"
    MILESTONES ||--o{ TASKS : groups
    TASKS ||--o{ TASKS : "parent_id (subtasks)"
    TASKS ||--o{ TASK_COMMENTS : has
    TASKS ||--o{ TASK_DEPENDENCIES : "blocker_id"
    TASKS ||--o{ TASK_DEPENDENCIES : "blocked_id"
    TASKS ||--o{ TIME_ENTRIES : tracks
    NOTES ||--o{ NOTE_VERSIONS : snapshots
    AUTOMATIONS ||--o{ AUTOMATION_RUNS : logs
    CANVAS_BOARDS ||--o{ CANVAS_NODES : has
    CANVAS_BOARDS ||--o{ CANVAS_EDGES : has
    CANVAS_NODES ||--o{ CANVAS_EDGES : "source/target"
    AUTH_USERS ||--o{ INBOX_ITEMS : captures
    AUTH_USERS ||--o{ AUTOMATIONS : defines
    AUTH_USERS ||--o{ TEMPLATES : owns
    AUTH_USERS ||--o| CALENDAR_CONNECTIONS : has
    AUTH_USERS ||--o{ APP_USER_CONNECTIONS : has
    AUTH_USERS ||--o{ ACTIVITY_LOGS : generates
    AUTH_USERS ||--o{ SEMANTIC_DOCUMENTS : owns

    PROFILES {
        uuid id PK
        text display_name
        text telegram_chat_id
        text telegram_username
    }
    PROJECTS {
        uuid id PK
        uuid user_id
        text name
        text para_type "project|area|resource|archive"
        text description
        text color
        text status
        date start_date
        date due_date
        date launch_date
        uuid parent_id FK
        float position
        timestamptz deleted_at
    }
    PROJECT_MEMBERS {
        uuid id PK
        uuid project_id FK
        uuid user_id
        text role
    }
    PROJECT_INVITES {
        uuid id PK
        uuid project_id FK
        text email
        uuid invited_by
    }
    MILESTONES {
        uuid id PK
        uuid project_id FK
        uuid user_id
        text title
        date due_date
        bool done
    }
    TASKS {
        uuid id PK
        uuid user_id
        uuid project_id FK
        uuid parent_id FK
        uuid milestone_id FK
        text title
        text description
        text status "todo|in_progress|review|done"
        text priority "high|medium|low"
        timestamptz start_date
        timestamptz due_date
        timestamptz time_block_end
        int estimate_minutes
        text_arr tags
        uuid assignee_id
        text assignee_name
        text recurrence
        bool reminded
        text google_event_id
        float position
        timestamptz completed_at
        timestamptz archived_at
        timestamptz deleted_at
    }
    TASK_DEPENDENCIES {
        uuid id PK
        uuid blocker_id FK
        uuid blocked_id FK
        uuid user_id
    }
    TASK_COMMENTS {
        uuid id PK
        uuid task_id FK
        uuid user_id
        text content
    }
    NOTES {
        uuid id PK
        uuid user_id
        uuid project_id FK
        text title
        text content "markdown mirror"
        jsonb blocks "source of truth"
        jsonb properties
        text status
        text_arr tags
        bool pinned
        timestamptz archived_at
        timestamptz deleted_at
    }
    NOTE_VERSIONS {
        uuid id PK
        uuid note_id FK
        int version_number
        text title
        text content
        jsonb blocks
    }
    INBOX_ITEMS {
        uuid id PK
        uuid user_id
        text content
        text source "manual|telegram|voice|ocr"
        text status "pending|processed|archived"
        text ai_summary
    }
    AUTOMATIONS {
        uuid id PK
        uuid user_id
        text name
        bool enabled
        jsonb trigger
        jsonb conditions
        jsonb actions
        int run_count
        timestamptz last_run_at
    }
    AUTOMATION_RUNS {
        uuid id PK
        uuid automation_id FK
        uuid task_id
        bool ok
        text detail
    }
    TIME_ENTRIES {
        uuid id PK
        uuid user_id
        uuid task_id FK
        uuid project_id FK
        text mode
        timestamptz started_at
        timestamptz ended_at
        int duration_seconds
    }
    CANVAS_BOARDS {
        uuid id PK
        uuid user_id
        uuid project_id FK
        text title
        jsonb viewport
    }
    CANVAS_NODES {
        uuid id PK
        uuid board_id FK
        text node_type
        text title
        text content
        float x
        float y
    }
    CANVAS_EDGES {
        uuid id PK
        uuid board_id FK
        uuid source_id FK
        uuid target_id FK
        text label
    }
    TEMPLATES {
        uuid id PK
        uuid user_id FK
        text kind "task|note"
        text name
        jsonb payload
    }
    CALENDAR_CONNECTIONS {
        uuid id PK
        uuid user_id UK
        text calendar_id
        bool sync_enabled
    }
    APP_USER_CONNECTIONS {
        uuid id PK
        uuid user_id
        text connector_id
        text connection_key_ciphertext
    }
    ACTIVITY_LOGS {
        uuid id PK
        uuid user_id
        text action
        text entity_type
        uuid entity_id
        jsonb metadata
        text source
    }
    SEMANTIC_DOCUMENTS {
        uuid id PK
        uuid user_id
        text entity_type
        uuid entity_id
        text search_text
        vector embedding "1536"
    }
    APP_CONFIG {
        text key PK
        text value
    }
```

**Database functions (RPC / security definer):** `is_project_owner`, `is_project_member`, `can_access_task`, `accept_project_invites`, `list_project_people`, `log_activity`, `search_semantic_documents`.
**Triggers:** `handle_new_user` (auth.users), `audit_row_change` (all main tables), `snapshot_note_change` (notes).

> `semantic_documents` / `search_semantic_documents` (pgvector) exist in the schema, but the UI does not use them yet. Semantic search is still on the roadmap.

---

## Environment variables

Copy `.env.example` to `.env` locally (it is git-ignored) and set the same variables in your hosting provider.

| Variable                                               | Side                | Required                   | Purpose                                                                                                                                           |
| ------------------------------------------------------ | ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`                                    | Client (build-time) | Yes                        | Supabase project URL for the browser client                                                                                                       |
| `VITE_SUPABASE_PUBLISHABLE_KEY`                        | Client (build-time) | Yes                        | Supabase anon/publishable key for the browser client                                                                                              |
| `SUPABASE_URL`                                         | Server              | Yes                        | Supabase URL for SSR, auth middleware and the admin client                                                                                        |
| `SUPABASE_PUBLISHABLE_KEY`                             | Server              | Yes                        | Publishable key used by `requireSupabaseAuth` to build a per-user client                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`                            | Server (secret)     | Yes                        | Service-role client (`supabaseAdmin`) for the Telegram webhook, reminders, unblock notifications and the encrypted connection store               |
| `LOVABLE_API_KEY`                                      | Server (secret)     | For AI / Telegram / Google | Bearer key for the Lovable AI Gateway (`ai.gateway.lovable.dev`) and the connector gateway (`connector-gateway.lovable.dev`)                      |
| `TELEGRAM_API_KEY`                                     | Server (secret)     | For Telegram               | Connection key for the Lovable Telegram connector (`X-Connection-Api-Key`), not a raw BotFather token                                             |
| `TELEGRAM_WEBHOOK_SECRET`                              | Server (secret)     | Required for the bot       | The webhook rejects every request (401) unless this is set and the `X-Telegram-Bot-Api-Secret-Token` header matches                               |
| `GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY`    | Server (secret)     | For Google Calendar        | Client API key of the Lovable Google Calendar App User Connector                                                                                  |
| `APP_USER_CONNECTION_KEY_SECRET`                       | Server (secret)     | For Google Calendar        | **Base64-encoded 32-byte key** for AES-GCM encryption of per-user connection handles (`openssl rand -base64 32`)                                  |
| `LOVABLE_DB_MIGRATION_URL`                             | Tooling             | For migrations             | Postgres connection string used by `drizzle-kit`                                                                                                  |
| `LOVABLE_CRON_SECRET` / `LOVABLE_CRON_SECRET_PREVIOUS` | Server              | No (currently unused)      | Read by the generated `cron-auth.ts` helper, which no route uses yet. The reminder endpoint authenticates against `app_config.cron_token` instead |

`VITE_*` variables are inlined at build time. Rebuild after you change them.

---

## Local setup

Prerequisites: [Bun](https://bun.sh) ≥ 1.2 (Node 22+ also works with npm), and a Supabase project (cloud or `supabase start`) with the `vector` extension available.

```bash
git clone https://github.com/ilramdhan/second-brain.git
cd second-brain
bun install

# 1. Create .env with at least the Supabase variables
cat > .env <<'EOF'
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-or-publishable-key>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
LOVABLE_DB_MIGRATION_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
EOF

# 2. Apply the database schema (see "Database migrations")
bunx drizzle-kit migrate

# 3. Start the dev server
bun run dev
```

In Supabase **Auth → URL Configuration**, add `http://localhost:<port>` (the dev server prints the port) to the redirect URLs. AI, Telegram and Google Calendar features also need the matching secrets above.

---

## Scripts

| Command              | Description                                     |
| -------------------- | ----------------------------------------------- |
| `bun run dev`        | Start the Vite dev server (SSR + HMR)           |
| `bun run build`      | Production build (client + Nitro server bundle) |
| `bun run build:dev`  | Build in development mode                       |
| `bun run preview`    | Preview the production build                    |
| `bun run lint`       | ESLint                                          |
| `bun run format`     | Prettier write                                  |
| `bun run test`       | Vitest (single run)                             |
| `bun run test:watch` | Vitest watch mode                               |

---

## Database migrations

Migrations are plain SQL files in `drizzle/migrations/`, numbered and listed in `meta/_journal.json`:

| #    | File                               | Contents                                                                                                                                                                         |
| ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0000 | `initial_second_brain_schema`      | profiles (+ sign-up trigger), projects, inbox_items, tasks, notes, owner RLS                                                                                                     |
| 0001 | `app_config_cron_token`            | `app_config` with a random `cron_token` (service role only)                                                                                                                      |
| 0002 | `workspace_features`               | project fields, milestones, task fields (subtasks, review status, assignee, recurrence), note fields, members, invites, comments, membership helpers and RLS                     |
| 0003 | `deps_automations_blocks`          | task_dependencies, automations, automation_runs, `notes.blocks` and `properties` (backfilled from content)                                                                       |
| 0004 | `productivity_platform_extensions` | pgvector, task time-blocking and Google fields, activity_logs + audit trigger, note_versions, time_entries, canvas tables, calendar and app-user connections, semantic_documents |
| 0005 | `throttle_note_version_snapshots`  | Snapshot at most every 10 minutes                                                                                                                                                |
| 0006 | `complete_activity_audit_triggers` | Audit triggers on all main tables                                                                                                                                                |
| 0007 | `archive_trash_templates`          | `deleted_at` / `archived_at`, templates table                                                                                                                                    |

**Apply:** `bunx drizzle-kit migrate` (uses `LOVABLE_DB_MIGRATION_URL`). You can also run the files in order with `psql` or the Supabase SQL editor.

**Add a migration:** create `drizzle/migrations/NNNN_short_name.sql` with idempotent SQL where possible (`IF NOT EXISTS`). Enable RLS and add policies and `GRANT`s for `authenticated` and `service_role`. Register the file in `meta/_journal.json` (or let drizzle-kit generate it), then regenerate `src/integrations/supabase/types.ts` (for example `supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts`). On Lovable, Lovable applies the migrations itself.

---

## Deployment to Vercel

The build uses Nitro, configured through `@lovable.dev/vite-tanstack-config`. With no explicit option the target is **`cloudflare-module`** (the wrapper's `defaultPreset`; Lovable's sandbox always forces it). `vite.config.ts` selects the target from the environment, so no code change is needed per platform:

1. **Nitro preset (already configured).** When the `VERCEL` env var is set, which Vercel does automatically during builds, `vite.config.ts` pins `nitro: { preset: "vercel" }` and the build writes `.vercel/output` (Build Output API). `NITRO_PRESET=<preset>` overrides this for any target. Plain `bun run build` (local, CI, Lovable) still builds for Cloudflare. To reproduce a Vercel build locally: `VERCEL=1 bun run build`.
2. **Import the repo** in Vercel. Framework preset: _Other_. Install command: `bun install`. Build command: `bun run build`. Leave the output directory empty, because Nitro's Vercel preset writes `.vercel/output` (Build Output API).
3. **Set the environment variables** from the table above for Production and Preview. Put `VITE_*` and the server-side Supabase variables in both. The `nitro` devDependency (≥ 3.0.260603-beta) is already in `package.json`.
4. **Supabase Auth URLs:** in _Authentication → URL Configuration_, set the Site URL to `https://<your-app>.vercel.app` (or your custom domain), and add it plus `https://*-<team>.vercel.app/**` for previews to the redirect allow-list.
5. **Database:** run the migrations against the production database (`LOVABLE_DB_MIGRATION_URL=… bunx drizzle-kit migrate`).
6. **Telegram webhook:** register the webhook URL with a secret:
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<your-app>/api/public/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
   Outgoing messages go through the Lovable connector gateway (`LOVABLE_API_KEY` + `TELEGRAM_API_KEY`).
7. **Reminder cron:** schedule a `POST` to `https://<your-app>/api/public/hooks/reminders` with the header `Authorization: Bearer <app_config.cron_token>`. Read the token with `select value from app_config where key = 'cron_token'`. Vercel Cron only sends `GET` with `CRON_SECRET`, so use Supabase `pg_cron` + `pg_net`, n8n, or another scheduler (hourly is a sensible default).
8. **Google Calendar OAuth:** the flow runs through the Lovable App User Connector. The return URL is computed from the request origin: `https://<your-app>/oauth/google-calendar/return`. Make sure that URL is allowed for the connector, and set `GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY`, `APP_USER_CONNECTION_KEY_SECRET` and `LOVABLE_API_KEY`.

**Caveats**

- AI, Telegram and Google Calendar all call **Lovable gateways** (`ai.gateway.lovable.dev`, `connector-gateway.lovable.dev`). A Vercel deployment still needs a valid `LOVABLE_API_KEY` and connector keys, or those features fail and the rest of the app keeps working. Replacing them with direct OpenAI, Telegram Bot API or Google OAuth calls would require code changes.
- `cron-auth.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `client.ts` and `client.server.ts` are Lovable-generated. Avoid hand-editing them.
- Do not commit the `.vercel` directory (it is already git-ignored).

---

## Integrations

### Telegram

- Endpoint: `POST /api/public/telegram/webhook`
- Commands: `/start` (instructions) and `/link <code>`, which binds the chat to the account that generated the one-time code in Settings. Codes are 8 characters, expire after 10 minutes, work once and are stored only as SHA-256 hashes in `telegram_link_codes`. Wrong, expired and used codes get the same reply. Any other text is saved as an inbox item with `source = "telegram"`.
- Outbound messages: deadline reminders, the automation `telegram` action, and unblock notifications.
- `TELEGRAM_WEBHOOK_SECRET` is required: the webhook fails closed and returns 401 when it is unset or the `X-Telegram-Bot-Api-Secret-Token` header does not match. Register it with `setWebhook` (`secret_token`).

### Outgoing webhooks (automations)

The `webhook` action sends `POST` with JSON `{ text, content, rule, event, project, task }` to any **HTTPS** URL. `text` and `content` make it work with Slack and Discord incoming webhooks out of the box, and with n8n Webhook nodes.

### n8n

n8n workflow templates for this app will live in `integrations/n8n/`. Typical uses: receive automation webhooks, call the reminder endpoint on a schedule, or bridge other inputs into `inbox_items`. (`docs/n8n/` is reference material from another project and is not part of this app.)

### Google Calendar

See [Google Calendar](#google-calendar-per-user). Server functions: `googleCalendarStatus`, `startGoogleCalendarConnect`, `completeGoogleCalendarConnect`, `disconnectGoogleCalendar`, `syncTaskToGoogle`.

---

## Testing

- Vitest + jsdom + Testing Library (`vitest.config.ts`, setup in `src/test/setup.ts`). Test files match `src/**/*.{test,spec}.{ts,tsx}`.
- The current suite is a routing smoke test (`src/test/app-routing.test.tsx`). It checks that `/` resolves to a real route.
- Pure modules such as `src/lib/nlp.ts` and `src/lib/blocks.ts` (parser, query engine, graph) are good candidates for more unit tests.

```bash
bun run test
bun run lint
```

---

## Lovable sync caveat

This repository is connected to Lovable:

- **Never rewrite published history.** Do not force-push, and do not rebase, amend or squash commits that are already pushed. Lovable mirrors git history, and the project history would be lost.
- Commits pushed to the connected branch (`main`) sync back into the Lovable editor. Keep the branch buildable.
- Don't add Vite plugins that `@lovable.dev/vite-tanstack-config` already includes (TanStack Start, React, Tailwind, tsconfig paths, Nitro, and others), or the build breaks with duplicate plugins.
- `src/routeTree.gen.ts`, `src/integrations/supabase/*` and `drizzle/schema.ts` are generated.

---

## Contributing / Community

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, architecture rules, commit conventions and the PR flow.

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md): report vulnerabilities privately, never in public issues
- [Accessibility](ACCESSIBILITY.md): WCAG 2.2 AA target and known gaps
- [Changelog](CHANGELOG.md)
- [Technical analysis](docs/ANALYSIS.md) and [phased implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [n8n workflow templates](integrations/n8n/README.md)

---

## License

[MIT](LICENSE) © 2026 Ilhom

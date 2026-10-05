# Performance baseline

Phase 0.4 of [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md). These numbers are the reference point for the optimisation phases. Re-measure with the same method after each phase (see the plan's closing notes) and add a column or a dated section below. Do not overwrite the baseline.

## Measurement method

This follows [`ANALYSIS.md` Appendix A](./ANALYSIS.md#lampiran-a--cara-verifikasi-performa-setelah-perbaikan):

1. `bun install && bun run build`, then record the size of `.output/public/assets/*` (entry, vendor, per route).
2. Chrome DevTools > Network: count Supabase requests while navigating Today → Settings → Tasks, and when alt-tabbing back to the window. Target: 0 refetches within `staleTime`.
3. React Profiler: type 20 characters in a note with about 100 blocks. Target: under 8 ms per commit, and no `InlineText` renders in other blocks.
4. Supabase: `explain analyze` on the task list query as role `authenticated` (with `request.jwt.claims` set), before and after the index and policy refactor.
5. Lighthouse (mobile) on `/` after logging in: LCP, TBT, INP.

Bundle sizes (step 1) can be measured from a local build. Steps 2 to 5 need a running deployment with real data, so they are placeholders below.

## 1. Bundle size (client)

**Build:** commit `dbd3a73` (branch `phase-0-1/foundation-security`), 2026-10-05, `vite build` (Vite 8.1.5, rolldown) with the default `cloudflare-module` Nitro preset, Node 22.23.2. The client assets are the same with `VERCEL=1` (only the server output differs). Placeholder `VITE_SUPABASE_*` values were used, as in CI.

**How sizes were computed:** raw bytes on disk and gzip level 9 (Node `zlib`), in KiB (1024 bytes). Vite's build log reports kB (1000 bytes) with its own gzip, so its figures are about 2–4 % higher.

### Totals

| Metric                                                             | Raw (KiB) | Gzip (KiB) |
| ------------------------------------------------------------------ | --------: | ---------: |
| All JS (95 chunks)                                                 |    1162.8 |      377.1 |
| All CSS (1 file)                                                   |      93.6 |       15.1 |
| **Initial entry JS** (`index-*.js` + its static imports, 9 chunks) | **595.6** |  **175.6** |
| Initial entry JS + CSS                                             |     689.2 |      190.7 |
| `.output/public` total (incl. icons, `sw.js`)                      |  ~1.8 MiB |          – |

The initial entry is the static-import closure of `index-1UNHPJoH.js`: `index`, `client`, `createMiddleware`, `link`, `useRouter`, `useNavigate`, `useMatch`, `jsx-runtime` and `preload-helper`. Route chunks (`_authenticated`, page routes) load on top of this on first navigation.

### Top 15 largest JS/CSS assets

|   # | Asset                                             | Raw (KiB) | Gzip (KiB) |
| --: | ------------------------------------------------- | --------: | ---------: |
|   1 | `index-1UNHPJoH.js` (entry: React, router, Query) |     320.8 |       99.1 |
|   2 | `client-BYu5od-7.js` (Supabase client)            |     216.6 |       55.5 |
|   3 | `notes._noteId-Ck_GTs0y.js` (note editor, Yjs)    |     124.0 |       37.2 |
|   4 | `styles-BHH-Wp_T.css`                             |      93.6 |       15.1 |
|   5 | `select-4-78CPzI.js` (Radix primitives)           |      68.5 |       23.4 |
|   6 | `core.esm-DLHMDTNV.js` (@dnd-kit/core)            |      40.1 |       13.0 |
|   7 | `createMiddleware-DvVE9Cor.js`                    |      33.2 |       10.5 |
|   8 | `_authenticated-BpiGuZCA.js` (app shell)          |      32.3 |       11.5 |
|   9 | `button-BtQKE7tg.js`                              |      31.2 |       10.2 |
|  10 | `graph-CmrRph9Q.js`                               |      19.8 |        8.0 |
|  11 | `data-ChJQJM4O.js` (query hooks)                  |      19.8 |        6.0 |
|  12 | `TaskDialogProvider-AwDSrl7w.js`                  |      16.4 |        5.3 |
|  13 | `dist-DDsnxBoF.js`                                |      14.9 |        5.3 |
|  14 | `projects._projectId-D87iFVNl.js`                 |      12.6 |        4.1 |
|  15 | `automations-DlmjF-8v.js`                         |      12.2 |        4.0 |

Content hashes change on every code change. When comparing, match chunks by name prefix.

### Reproduce

```bash
bun run build
node -e '
const fs=require("fs"),z=require("zlib"),d=".output/public/assets";
const r=fs.readdirSync(d).filter(f=>/\.(js|css)$/.test(f)).map(f=>{const b=fs.readFileSync(d+"/"+f);return [f,b.length,z.gzipSync(b,{level:9}).length]}).sort((a,b)=>b[1]-a[1]);
for(const [f,raw,gz] of r.slice(0,15)) console.log(f,(raw/1024).toFixed(1),(gz/1024).toFixed(1));'
```

## 2. Supabase requests per navigation

_Placeholder: needs a deployed preview with a logged-in user._

| Scenario                                   | Requests | Notes    |
| ------------------------------------------ | -------: | -------- |
| Cold load `/` (Today)                      |      TBD |          |
| Today → Settings                           |      TBD |          |
| Settings → Tasks                           |      TBD |          |
| Alt-tab away and back (within `staleTime`) |      TBD | target 0 |

## 3. Note editor render cost (React Profiler)

_Placeholder: needs a note with about 100 blocks._

| Metric                                    | Value                  |
| ----------------------------------------- | ---------------------- |
| Avg commit duration while typing 20 chars | TBD ms (target < 8 ms) |
| Other blocks' `InlineText` re-rendered?   | TBD (target: no)       |

## 4. Database (`explain analyze`)

**Synthetic run, Phase 2 (2026-10-05).** Throwaway `public.ecr.aws/supabase/postgres:15.19.0.002` container on an Apple Silicon laptop (Docker). "Before" = migrations 0000–0012; "after" = plus 0013–0016 (indexes, `(select auth.uid())`, `my_project_ids()` policies, constraints). Script: [`supabase/perf/explain_lists.sql`](../supabase/perf/explain_lists.sql). It seeds 200 users, 400 projects, 600 memberships, 40 000 tasks and 10 000 notes (10 % trashed, 10 % archived), runs `ANALYZE`, then runs `EXPLAIN (ANALYZE, BUFFERS)` as role `authenticated` with `request.jwt.claims` set to one user. That user owns 200 tasks and sees 400 more through three shared projects. Everything is rolled back.

```bash
psql "$DATABASE_URL" -f supabase/perf/explain_lists.sql   # superuser, throwaway DB only
```

| Query                                                                   | Rows | Before: plan                                                  | Before: exec (ms) / buffers | After: plan                                                                                | After: exec (ms) / buffers |
| ----------------------------------------------------------------------- | ---: | ------------------------------------------------------------- | --------------------------: | ------------------------------------------------------------------------------------------ | -------------------------: |
| Q1 task list, `useTasks` (own + shared, active, order position/created) |  600 | Seq Scan, `is_project_member()` per row, 39 400 rows filtered |              86.7 / 100 293 | BitmapOr `tasks_user_active_idx` + `tasks_project_idx`; `my_project_ids()` once (InitPlan) |                 0.69 / 758 |
| Q2 tasks of one project (project page)                                  |  200 | Seq Scan, 39 800 rows filtered                                |                  1.97 / 797 | Bitmap Index Scan `tasks_project_idx`                                                      |                 0.12 / 202 |
| Q3 notes list, `useNotes` (active, order pinned desc, updated_at desc)  |   83 | Seq Scan, `is_project_member()` per row, 9 917 rows filtered  |               20.0 / 13 778 | BitmapOr `notes_user_active_idx` + `notes_project_idx`                                     |                 0.17 / 121 |
| Q4 tasks by user (service role, n8n / reminders; no RLS)                |  200 | Seq Scan, 39 800 rows filtered                                |                  2.03 / 797 | Bitmap Index Scan `tasks_user_active_idx`                                                  |                 0.11 / 204 |

Planning time stayed at 0.02–0.17 ms in both runs. Most of the old cost came from the per-row security-definer membership call (about 2.5 buffer hits per row), not from the sequential scan itself. Results come back in the same rows and order.

_Still to do:_ repeat Q1 and Q3 against staging or production data (same script queries, real `request.jwt.claims`) and add a dated row here.

## 5. Lighthouse (mobile, `/` after login)

_Placeholder: needs a live deployment (Vercel preview)._

| Metric                  | Value |
| ----------------------- | ----- |
| Performance score       | TBD   |
| LCP                     | TBD   |
| TBT                     | TBD   |
| INP (field or Timespan) | TBD   |
| CLS                     | TBD   |

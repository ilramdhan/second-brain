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

_Placeholder: run against the production or staging database before Phase 2 (indexes and policies)._

| Query                                              | Planning (ms) | Execution (ms) | Plan notes |
| -------------------------------------------------- | ------------: | -------------: | ---------- |
| Task list (`authenticated`, own + shared projects) |           TBD |            TBD |            |

## 5. Lighthouse (mobile, `/` after login)

_Placeholder: needs a live deployment (Vercel preview)._

| Metric                  | Value |
| ----------------------- | ----- |
| Performance score       | TBD   |
| LCP                     | TBD   |
| TBT                     | TBD   |
| INP (field or Timespan) | TBD   |
| CLS                     | TBD   |

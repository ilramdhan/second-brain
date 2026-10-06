# Implementation Plan — Phase Design Spec

> Sumber: [`docs/ANALYSIS.md`](./ANALYSIS.md) (audit), [`integrations/n8n/README.md`](../integrations/n8n/README.md) (kontrak endpoint n8n), [`AGENTS.md`](../AGENTS.md) (aturan arsitektur).
> Prinsip: setiap phase **bisa di-deploy sendiri**, branch `main` selalu dalam kondisi jalan (sinkron ke Lovable), tidak ada force-push. Satu task = satu PR kecil.

## Ringkasan Phase

| Phase | Tema                                          | Tujuan utama                                        | Estimasi      | Bergantung pada   |
| ----- | --------------------------------------------- | --------------------------------------------------- | ------------- | ----------------- |
| 0     | Fondasi & deploy                              | CI hijau, deploy Vercel jalan, baseline metrik      | 1–2 hari      | –                 |
| 1     | Security hotfix                               | Tutup celah Critical/High                           | 2–3 hari      | 0                 |
| 2     | Database hardening                            | Policy, index, trigger duplikat, constraint         | 2–3 hari      | 1                 |
| 3     | Performance quick wins                        | Web terasa cepat di semua halaman                   | 3–4 hari      | 0 (paralel dgn 2) |
| 4     | Performance deep fix                          | Editor catatan, list, Yjs, auth/SSR                 | 4–6 hari      | 3                 |
| 5     | Refactor & kualitas kode                      | Struktur feature-based, test, hapus dependency mati | 4–5 hari      | 3                 |
| 6 ✅  | Backend n8n                                   | Endpoint `/api/public/n8n/*` + aktifkan template    | 4–5 hari      | 1, 2              |
| 7 ✅  | Lepas dari lock-in Lovable gateway (opsional) | AI/Telegram/Calendar langsung ke provider           | 3–4 hari      | 6                 |
| 8     | Observability, PWA, a11y, SEO                 | Sentry, web-vitals, Workbox, WCAG 2.2 AA            | 3–4 hari      | 4                 |
| 9     | Fitur baru                                    | Roadmap fitur dari ANALYSIS §13                     | berkelanjutan | 5                 |
| 10    | Domain produksi & demo                        | `2ndbrain.ilramdhan.dev` + demo terbatas & reset    | 2–3 hari      | 6, 7              |

Definition of Done untuk setiap task: lint + typecheck + test + build lulus di CI, perubahan migration bisa dijalankan dari nol, dokumentasi (README/CLAUDE.md/CHANGELOG) diperbarui bila perilaku berubah.

---

## Phase 0 — Fondasi & Deploy

**Tujuan:** pipeline jalan dan ada angka baseline sebelum optimasi.

| #   | Status         | Task                    | Detail / acceptance                                                                                                                                                                                                                                                                           |
| --- | -------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ✅ done        | Rapikan CI agar hijau   | Workflow `.github/workflows/ci.yml` sudah ada; perbaiki kegagalan lint/format/typecheck yang dilaporkan. Format massal dilakukan di **satu commit terpisah** (`chore: format`). _Selesai: 4 error ESLint diperbaiki, format massal di commit tersendiri, job Prettier kini blocking._         |
| 0.2 | ✅ done        | Preset Vercel           | Tambah `nitro: { preset: "vercel" }` di `vite.config.ts` (atau env `NITRO_PRESET=vercel` di Vercel). Pastikan build Lovable tetap jalan. _Selesai: preset `vercel` otomatis saat env `VERCEL` ada (`NITRO_PRESET` tetap menang); build biasa/Lovable tetap `cloudflare-module`._              |
| 0.3 | ⏳ needs owner | Env & secrets di Vercel | Isi semua variabel dari `.env.example`. Supabase Auth → tambah redirect URL domain Vercel. Google OAuth redirect URI.                                                                                                                                                                         |
| 0.4 | ✅ done        | Baseline metrik         | Jalankan Lampiran A di ANALYSIS.md: ukuran bundle, jumlah request Supabase per navigasi, Lighthouse mobile (LCP/TBT/INP). Simpan hasil di `docs/perf-baseline.md`. _Ukuran bundle tercatat; metrik runtime (request Supabase, Profiler, Lighthouse) masih placeholder sampai ada deployment._ |
| 0.5 | ⏳ needs owner | Branch protection       | `main` wajib PR + CI lulus; Dependabot aktif. _`.github/dependabot.yml` sudah ada; branch protection harus diaktifkan owner di GitHub Settings._                                                                                                                                              |
| 0.6 | ✅ done        | Release Please          | Automated versioning, changelog dan GitHub Releases (`release-please.yml`, `release-please-config.json`). _Baseline `v0.1.0`; opsional secret `RELEASE_PLEASE_TOKEN` agar CI jalan di release PR._                                                                                            |

**Exit criteria:** preview deploy di Vercel bisa login dan CRUD tugas; angka baseline tercatat.

---

## Phase 1 — Security Hotfix (prioritas tertinggi)

| #   | Severity | Task                                                                                                                                                                                                                                                 | Acceptance                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Critical | Webhook Telegram **fail-closed**: tolak request jika `TELEGRAM_WEBHOOK_SECRET` kosong atau header tidak cocok (compare constant-time).                                                                                                               | Request tanpa/dengan secret salah → 401.                                                                                                                                                                                                                                                                                                                                                  |
| 1.2 | Critical | Ganti `/link <email>` dengan **one-time code**: tombol "Hubungkan Telegram" di Settings menghasilkan kode 6–8 karakter (TTL 10 menit, sekali pakai, tabel `telegram_link_codes`), bot menerima `/link <kode>`. Hapus pencarian user via `listUsers`. | Tidak mungkin menautkan akun tanpa login ke akun itu; tidak ada enumerasi email.                                                                                                                                                                                                                                                                                                          |
| 1.3 | High     | Channel realtime kolaborasi catatan jadi **private** + RLS di `realtime.messages` (hanya pemilik/anggota project catatan).                                                                                                                           | User lain tidak bisa subscribe/broadcast ke channel catatan. ✅ _Selesai (migration `0009`): channel `private: true` + `setAuth()`, policy `realtime.messages` via `can_access_note`; diuji di `supabase/tests/rls_phase1.sql`._                                                                                                                                                          |
| 1.4 | High     | Policy project: member tidak boleh mengubah `projects.user_id`; `tasks/notes_member_all` dipecah per operasi, `user_id` tidak bisa dipalsukan (`with check user_id = auth.uid()` saat insert, immutable saat update via trigger).                    | Test RLS (Phase 5) membuktikan member tidak bisa ambil alih project atau hapus baris milik orang lain (kecuali sesuai aturan). ✅ _Selesai (migration `0010`): trigger `user_id` immutable, policy per operasi, trash/hapus hanya pemilik baris atau owner proyek, project hanya diubah owner; diuji di `supabase/tests/rls_phase1.sql`._                                                 |
| 1.5 | High     | Webhook otomasi: guard SSRF (tolak IP private/loopback/link-local/metadata setelah resolve DNS), timeout 5 detik, batas ukuran respons, payload hanya field yang diperlukan.                                                                         | Unit test untuk URL berbahaya. ✅ _Selesai: `src/server/ssrf.server.ts` (https, tanpa kredensial, port 443/8443, hostname internal, resolve DNS A/AAAA dan tolak IP privat/loopback/link-local/CGNAT/metadata/IPv4-mapped; fallback cek statis bila `node:dns` tidak ada), `redirect: "manual"`, timeout 5 detik, baca respons ≤ 64 KB, payload minimal; diuji di `ssrf.server.test.ts`._ |
| 1.6 | Medium   | Cron reminders pakai `authenticateCronRequest` (constant-time, dukung rotasi secret).                                                                                                                                                                | ✅ _Selesai: `src/server/cronAuth.server.ts` (constant-time, `LOVABLE_CRON_SECRET`/`_PREVIOUS`/`CRON_SECRET`, fallback `app_config.cron_token`), GET untuk Vercel Cron, tanpa N+1; diuji di `cronAuth.server.test.ts`._                                                                                                                                                                   |
| 1.7 | Medium   | AI server functions: validasi zod dengan `max` panjang input, rate limit per user (tabel counter atau Upstash).                                                                                                                                      | ✅ _Selesai (migration `0011`): batas zod per input (base64 dicek sebelum decode), `consume_rate_limit` security definer, 30 panggilan AI / 10 menit per user, fail-closed; diuji di `rateLimit.server.test.ts` dan `supabase/tests/rate_limit.sql`._                                                                                                                                     |
| 1.8 | Medium   | Sign-out memanggil `queryClient.clear()`; restore backup memvalidasi skema dan memaksa `user_id = auth.uid()`.                                                                                                                                       | ✅ _Selesai: `queryClient.clear()` di tombol keluar, idle logout dan event `SIGNED_OUT`; restore lewat `src/lib/backup.ts` (zod per tabel, buang kolom asing, `user_id` dipaksa, batas 20 MB / 10.000 baris, baris milik orang lain dilewati); diuji di `backup.test.ts`._                                                                                                                |
| 1.9 | Medium   | Security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) via `vercel.json` atau middleware server.                                                                                                                  | Skor securityheaders.com ≥ A. ✅ _Selesai: `src/server/securityHeaders.ts` dipakai `src/server.ts` (semua host, produksi) dan `vercel.json`; HSTS, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, CSP enforced untuk frame-ancestors/base-uri/object-src/form-action dan CSP resource **report-only** (lihat SECURITY.md). Skor securityheaders.com dicek setelah deploy._       |

**Exit criteria:** tidak ada temuan Critical/High tersisa di ANALYSIS §3; `SECURITY.md` diperbarui.

---

## Phase 2 — Database Hardening

| #   | Task                                                                        | Catatan                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | Hapus trigger audit duplikat (0004 `<t>_audit` vs 0006 `audit_<t>_changes`) | Setiap write sekarang mencatat 2 baris audit. ✅ _Selesai (migration `0013`): `<t>_audit` di-drop, tersisa satu `audit_<t>_changes` (AFTER INSERT/UPDATE/DELETE) per tabel; update tanpa perubahan selain `updated_at` tidak dicatat; diuji di `supabase/tests/phase2.sql`._                                                                                                                                            |
| 2.2 | Tambah index                                                                | `user_id`, `project_id`, partial index `where deleted_at is null and archived_at is null`, `project_members(user_id, project_id)`, `task_dependencies(task_id)`/`(depends_on_id)`. Daftar lengkap di ANALYSIS §6.3. ✅ _Selesai (migration `0014`): index §6.3, index di setiap kolom FK, partial index list aktif, `profiles.telegram_chat_id` unique._                                                                |
| 2.3 | Policy pakai `(select auth.uid())`                                          | Mencegah evaluasi per baris. ✅ _Selesai (migration `0015`): semua policy pakai `(select auth.uid())`; policy SELECT/UPDATE member memakai `my_project_ids()` (STABLE, sekali per query); aturan 0010 tetap (`rls_phase1.sql` lulus)._                                                                                                                                                                                  |
| 2.4 | Constraint                                                                  | FK ke `auth.users` (on delete cascade), CHECK untuk `status`/`priority`/`role`, perluas sumber inbox (`email`, `google_calendar`, `webhook`) untuk n8n. ✅ _Selesai (migration `0016`; sumber inbox sudah di `0012`): FK `user_id` → `auth.users` on delete cascade (NOT VALID lalu VALIDATE), CHECK `projects.status`/`notes.status`/`project_members.role`/`tasks.recurrence` (`tasks.status`/`priority` sudah ada)._ |
| 2.5 | `drizzle/schema.ts`                                                         | Isi schema yang mencerminkan migration (opsional: dipakai untuk type generation), atau generate `supabase gen types`. _Tidak perlu perubahan: `types.ts` tetap konsisten (kolom tetap `text`); `drizzle/schema.ts` tetap kosong._                                                                                                                                                                                       |
| 2.6 | Verifikasi                                                                  | `explain analyze` query list utama sebelum/sesudah, catat di `docs/perf-baseline.md`. ✅ _Selesai: `supabase/perf/explain_lists.sql`, hasil di `docs/perf-baseline.md` §4 (task list 86,7 → 0,7 ms pada data sintetis)._                                                                                                                                                                                                |

Semua dalam migration baru (`0008_…`, `0009_…`), **jangan edit migration lama**.

---

## Phase 3 — Performance Quick Wins (penyebab utama "lambat di semua halaman")

| #   | Status  | Task                                                                                                                                                                                                                                                                                                                                                                 | Dampak                                                        |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 3.1 | ✅ done | Default `QueryClient`: `staleTime: 60_000`, `gcTime: 30 * 60_000`, `refetchOnWindowFocus: false`, `retry: 1`; `defaultPreloadStaleTime` jangan 0. _Selesai: `createQueryClient()` di `src/router.tsx`, `defaultPreload: "intent"`; alur yang menulis di luar hook (inbox AI, QuickCapture, restore backup, focus timer) meng-invalidate key terkait._                | Hilangkan refetch seluruh tabel tiap navigasi/alt-tab.        |
| 3.2 | ✅ done | `CommandMenu` tidak lagi memanggil `useTasks/useNotes/useProjects` saat tertutup; lazy-load saat dibuka + server search (`id, title`) dengan debounce. _Selesai: `useSearch()` (PostgREST `ilike`, 20 baris per entitas, tanpa migration), debounce 200 ms._                                                                                                         | Halaman Settings/Activity tidak ikut mengunduh semua catatan. |
| 3.3 | ✅ done | `React.lazy` untuk `TaskDialogProvider` (isi dialog), `QuickCapture`, `QuickTask`, `FocusTimer`, graph (d3-force), editor blok. _Selesai: `TaskEditor.tsx` (+FocusTimer) lazy, API provider tetap; d3-force/yjs/editor sudah di chunk route (autoCodeSplitting dipaksa aktif oleh TanStack Start)._                                                                  | Bundle awal lebih kecil.                                      |
| 3.4 | ✅ done | Kolom eksplisit, bukan `select *`. List catatan hanya `id, title, updated_at, excerpt, tags`; `blocks/content` diambil lewat `useNote(id)`. _Selesai: konstanta kolom di `data.ts`; list catatan tanpa `blocks` (`content` tetap untuk preview/pencarian sampai ada kolom `excerpt`), `useNote(id)` untuk editor, `useNoteBlocks()` hanya di route catatan & graph._ | Payload jauh lebih kecil.                                     |
| 3.5 | ✅ done | Mutasi pakai `setQueryData` optimistik + invalidasi terarah, bukan invalidasi seluruh list. _Selesai: helper murni di `src/lib/query-cache.ts`, rollback saat error._                                                                                                                                                                                                | Autosave catatan tidak lagi memicu refetch semua catatan.     |
| 3.6 | ✅ done | Hoist hook per baris: `useTaskActions`/`useDeps` di parent, map `subtasksByParent` dan `depsByTask` via `useMemo`, `React.memo` untuk `TaskRow`; komponen `Group` di Upcoming dipindah keluar render. _Selesai: `useTaskRowLookups` + `src/lib/task-maps.ts`; byDay kalender sekali hitung._                                                                         | Render list O(n), bukan O(n²).                                |
| 3.7 | ✅ done | Graph: update posisi via ref/canvas, bukan `setState` per tick d3. _Selesai: tick → satu `requestAnimationFrame` yang menulis atribut SVG lewat ref._                                                                                                                                                                                                                | –                                                             |

**Exit criteria:** dibanding baseline 0.4, jumlah request Supabase per navigasi turun ≥ 80% dan tidak ada refetch saat alt-tab; TBT turun signifikan.

---

## Phase 4 — Performance Deep Fix

| #   | Task                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | `BlockEditor`: autosize hanya untuk textarea yang berubah (`useLayoutEffect` dengan deps), `InlineText` menerima map judul catatan lewat props/context ter-memo, bukan subscribe `useNotes` per fragmen.                                                   |
| 4.2 | Backlinks: simpan kolom `links text[]` dan `refs text[]` (diisi saat simpan) + index GIN; query backlinks di server, bukan parse semua catatan per ketikan. `indexBlocks` dihitung sekali.                                                                 |
| 4.3 | Yjs granular: dokumen Y.Array/Y.Map per blok (bukan seluruh JSON per ketikan); hanya satu peer (leader) yang autosave, debounce 1,5–2 detik.                                                                                                               |
| 4.4 | Auth di `beforeLoad` route `_authenticated` (cookie-based SSR session atau `ssr: false` eksplisit), loader memanggil `ensureQueryData` agar data diambil paralel dengan render; `accept_project_invites` hanya saat login, bukan setiap perubahan session. |
| 4.5 | Auto-shift dependency dan recurrence dipindah ke RPC Postgres (satu round-trip, transaksional).                                                                                                                                                            |
| 4.6 | Virtualisasi list panjang (`@tanstack/react-virtual`) bila > 200 item, tetap kompatibel dengan `usePaged`/`LoadMore`.                                                                                                                                      |

---

## Phase 5 — Refactor, Struktur & Kualitas

| #   | Task                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | Pecah `src/lib/data.ts` menjadi `src/features/{tasks,notes,projects,milestones,automations}/{api,hooks,types}.ts`; `data.ts` sementara re-export agar perubahan bertahap (update AGENTS.md setelahnya).                                                                                                                                         |
| 5.2 | Hapus file shadcn yang tidak dipakai (±36) dan dependency mati (recharts, embla, input-otp, vaul, react-resizable-panels, react-hook-form, @hookform/resolvers, react-day-picker, @dnd-kit/sortable, ±20 paket radix) — verifikasi dengan `knip`. Hapus recharts dan react-day-picker alih-alih upgrade major (PR Dependabot #10, #13 ditutup). |
| 5.3 | Test: unit untuk `blocks.ts`, `nlp.ts`, evaluasi otomasi, SSRF guard; test RLS dengan Supabase lokal (pgTAP atau script vitest dengan 2 user); target coverage `src/lib` ≥ 70%.                                                                                                                                                                 |
| 5.4 | Typed Supabase client (`supabase gen types typescript`) dan hapus `any`.                                                                                                                                                                                                                                                                        |
| 5.5 | Error boundary per route + toast error yang konsisten.                                                                                                                                                                                                                                                                                          |
| 5.6 | Migrasi zod 4 (signature `z.record`, format error) — PR Dependabot #6 ditutup.                                                                                                                                                                                                                                                                  |
| 5.7 | Upgrade ESLint 10 + @eslint/js 10 + eslint-plugin-react-hooks 7 bersamaan (6 error core rules, 40 error React Compiler rules).                                                                                                                                                                                                                  |
| 5.8 | TypeScript 7 setelah TanStack Start/typescript-eslint mendukung.                                                                                                                                                                                                                                                                                |

---

## Phase 6 — Backend Integrasi n8n

Kontrak lengkap ada di `integrations/n8n/README.md`. Semua endpoint di `src/routes/api/public/n8n/*`, auth header `x-api-key` = `N8N_API_KEY` (constant-time compare), body divalidasi zod, idempotensi via `update_id`/`external_id` (`n8n_events`).

| #    | Status         | Endpoint / task                                                                                        | Dipakai workflow | Catatan                                                                                                                                                                                 |
| ---- | -------------- | ------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1  | ✅ done        | Helper auth + idempotency table `n8n_events`                                                           | semua            | `src/server/n8n/{auth,http}.server.ts` (`N8N_API_KEY`/`_PREVIOUS`, fail-closed, zod → 400), migration `0012`; diuji di `auth.server.test.ts`, `supabase/tests/n8n_integration.sql`.     |
| 6.2  | ✅ done        | `POST /api/public/n8n/bot` (command, teks, hasil OCR/transkrip, callback button)                       | 01               | `src/server/n8n/bot.server.ts`; `/link` memakai `telegramLink.server.ts` yang sama dengan mode app.                                                                                     |
| 6.3  | ✅ done        | `POST /api/public/n8n/capture` (inbox/task/note dari sumber apa pun)                                   | 01, 07, 08       | Inbox source `email`/`google_calendar`/`webhook` (migration `0012`); user via email (`n8n_user_id_by_email`) atau chat.                                                                 |
| 6.4  | ✅ done        | `GET /api/public/n8n/digest?kind=morning\|evening\|overdue\|weekly`                                    | 02               | Builder murni di `format.server.ts` (diuji); zona `APP_TIMEZONE`.                                                                                                                       |
| 6.5  | ✅ done        | `POST /api/public/n8n/reminders`, `POST /api/public/n8n/maintenance` (purge trash lama, dll.)          | 02               | Logika pengingat dibagi dengan `/api/public/hooks/reminders` (`reminders.server.ts`); maintenance juga membersihkan link code, `rate_limits`, `n8n_events`.                             |
| 6.6  | ✅ done        | `GET /api/public/n8n/backup` (export per user, berhalaman)                                             | 05               | Format = backup Settings; paging per user + 1000 baris/tabel; gzip.                                                                                                                     |
| 6.7  | ✅ done        | `POST /api/public/n8n/calendar/sync` (refactor `syncTaskToGoogle` jadi helper server berbasis user id) | 07               | `src/server/googleCalendar.server.ts` (`mode=linked\|all`).                                                                                                                             |
| 6.8  | ✅ done        | `POST /api/public/n8n/events` (opsional, event otomasi / error n8n)                                    | 03, 06           | → `activity_logs` (`source = 'n8n'`).                                                                                                                                                   |
| 6.9  | ⏳ needs owner | Uji import semua template di n8n staging, dokumentasikan hasilnya.                                     | –                | JSON tervalidasi (parse, id/nama unik, koneksi & `$('Node')` valid); impor nyata butuh instance n8n owner.                                                                              |
| 6.10 | ✅ done        | Auto backup ke Google Drive (Drive API) + email ringkasan via Resend SMTP, retensi, alert gagal        | 05               | Harian/mingguan (`BACKUP_FREQUENCY`), `.json.gz` ke `BACKUP_DRIVE_FOLDER_ID`, simpan `BACKUP_RETENTION` terbaru, email + lampiran ≤ `BACKUP_EMAIL_ATTACH_MAX_MB`, alert Telegram/email. |
| 6.11 | ✅ done        | Restore backup otomatis dari Settings                                                                  | –                | "Pulihkan JSON" menerima file multi-user dan `.json.gz`, memulihkan entri milik akun yang masuk.                                                                                        |
| 6.12 | ✅ done        | Template 01/02/03/06/07/08 diselaraskan dengan kontrak final + env app-named; jadwal di n8n            | semua            | Vercel Cron (Hobby 1×/hari) dan pg_cron hanya fallback.                                                                                                                                 |

Catatan: satu bot Telegram hanya punya satu webhook — pilih mode n8n **atau** mode app (lihat README n8n).

---

## Phase 7 — Lepas dari Lovable ✅ selesai

AI, Telegram, Google Calendar, build dan env tidak lagi memakai Lovable (`ai.gateway.lovable.dev` / `connector-gateway.lovable.dev` / `@lovable.dev/*`). Repo ter-deploy di Vercel Hobby + Supabase Free.

| #   | Status  | Task                  | Hasil                                                                                                                                                                                                      |
| --- | ------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | ✅ done | Build config          | `vite.config.ts` eksplisit (TanStack Start, React, Tailwind, tsconfig paths, Nitro preset `vercel` → `.vercel/output`), tanpa `@lovable.dev/vite-tanstack-config`.                                         |
| 7.2 | ✅ done | Env                   | Semua env bernama app/standar (`SECOND_BRAIN_CRON_SECRET`, `DATABASE_URL`, `AI_*`, `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_*`, `TOKEN_ENCRYPTION_KEY`, `N8N_API_KEY`); tabel BREAKING di CHANGELOG.           |
| 7.3 | ✅ done | AI                    | AI SDK langsung ke OpenAI atau provider OpenAI-compatible (`AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, …).                                                                                                   |
| 7.4 | ✅ done | Telegram              | Bot API langsung (`TELEGRAM_BOT_TOKEN`), mode app & mode n8n, deep link `TELEGRAM_BOT_USERNAME`.                                                                                                           |
| 7.5 | ✅ done | Google Calendar       | OAuth 2.0 sendiri (code + PKCE, state terenkripsi, offline, `calendar.events`), refresh token AES-GCM (`TOKEN_ENCRYPTION_KEY`), refresh di server, revoke saat putus; `src/integrations/lovable/` dihapus. |
| 7.6 | ✅ done | Dokumentasi self-host | README (Vercel Hobby + Supabase Free langkah demi langkah, Google Cloud, BotFather, Resend, n8n), `.env.example`, SECURITY.md, n8n README.                                                                 |

---

## Phase 8 — Observability, PWA, Aksesibilitas, SEO

| #   | Task                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 | Sentry (client + server) dengan source map upload di CI; `web-vitals` dikirim ke endpoint/analytics.                                                                                                                  |
| 8.2 | Ganti `public/sw.js` dengan Workbox (`vite-plugin-pwa`): precache asset, network-first untuk API, halaman offline, update prompt.                                                                                     |
| 8.3 | Aksesibilitas: alternatif keyboard untuk drag & drop (kanban/kalender/timeline), audit axe di CI (Playwright + `@axe-core/playwright`), `prefers-reduced-motion`, kontras token warna — mengikuti `ACCESSIBILITY.md`. |
| 8.4 | Hilangkan FOUC tema (script inline sebelum hydrate); `robots.txt` blokir route aplikasi; meta/OG untuk landing.                                                                                                       |
| 8.5 | E2E smoke test (Playwright) untuk alur login → buat tugas → buat catatan, jalan di CI pada preview deploy.                                                                                                            |
| 8.6 | **Landing page publik** di `/` (dikerjakan setelah 4.4 karena menyentuh struktur route auth). Detail di bawah.                                                                                                        |

### 8.6 Landing page (bento grid)

**Keputusan owner (2026-10-05):** `/` menjadi landing publik; dashboard "Hari Ini" pindah ke `/today`.

**Status:** ✅ 8.6.1–8.6.5 selesai (`src/routes/index.tsx` SSR, `src/components/landing/Landing.tsx`, `/today`, `robots.txt`, `sitemap.xml`); 8.6.6 unit test selesai, cek Lighthouse menunggu preview deploy.

| #     | Task                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.6.1 | Pindahkan `_authenticated/index.tsx` → `_authenticated/today.tsx`; update `NAV`, semua `to="/"`, redirect setelah login, link Telegram/n8n/digest yang menunjuk ke root, dan `start_url` di `manifest.webmanifest`.                                                                                                                                                                       |
| 8.6.2 | Route publik `src/routes/index.tsx`: user dengan sesi aktif langsung diarahkan ke `/today` (di `beforeLoad` setelah 4.4); tamu melihat landing. Tanpa query Supabase selain cek sesi.                                                                                                                                                                                                     |
| 8.6.3 | Desain bento grid responsif memakai token tema & komponen shadcn yang sama dengan dashboard (kartu, radius, tipografi, dark mode): hero + CTA (Masuk / Lihat demo), kartu fitur (Inbox & AI capture, Tasks list/kanban/kalender/timeline, Notes berblok + graph, Kolaborasi Yjs, Automations, Telegram & Google Calendar). Grid 1 kolom (mobile) → 2 → 4 kolom dengan kartu span berbeda. |
| 8.6.4 | Visual kartu berupa mockup ringan (HTML/CSS atau SVG/gambar statis teroptimasi), bukan komponen app sungguhan agar bundle landing kecil; `prefers-reduced-motion` dihormati.                                                                                                                                                                                                              |
| 8.6.5 | SEO/OG (gabung 8.4): `head()` dengan title/description/OG image, `robots.txt` mengizinkan `/` dan memblokir route app; teks landing lewat i18n `preferences.tsx`.                                                                                                                                                                                                                         |
| 8.6.6 | Test: unit render landing + redirect user login; cek Lighthouse (LCP < 2,5 s, CLS < 0,1) di preview.                                                                                                                                                                                                                                                                                      |

---

## Phase 9 — Fitur Baru (backlog, urut prioritas)

Diambil dari ANALYSIS §13, dikerjakan setelah Phase 1–5 stabil:

1. Semantic search memakai tabel embedding yang sudah ada (UI belum ada).
2. Login Google/magic link, 2FA, reset password.
3. Sinkronisasi Google Calendar dua arah.
4. Otomasi terjadwal (cron per rule) dan trigger untuk catatan.
5. Sharing read-only publik (link bertoken, bisa dicabut).
6. Laporan & grafik (fokus, burndown, throughput), habit tracker.
7. UX keyboard-first (j/k, aksi cepat di command palette, cheat-sheet).
8. i18n (ID/EN) — string saat ini campuran.
9. Mode offline penuh (antrian mutasi) setelah Workbox.

---

## Phase 10 — Domain produksi & deployment demo

**Domain:** produksi `2ndbrain.ilramdhan.dev` (keputusan owner 2026-10-06; `APP_URL`). Demo `2ndbrain-demo.ilramdhan.dev` (saran: satu level subdomain seperti produksi, berurutan di daftar DNS/Vercel, sertifikat & CNAME sama sederhananya). Alternatif setara: `demo.2ndbrain.ilramdhan.dev`.

**Prinsip demo:** deployment kedua dari branch yang sama (Vercel project terpisah) dengan **Supabase project terpisah** (Free tier kedua) — demo tidak pernah menyentuh data produksi; perilaku dibatasi lewat env, bukan fork kode.

| #    | Status  | Task                                                                                                                                                                                                                                |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.1 | ⏳ todo | Domain produksi: Vercel → Domains `2ndbrain.ilramdhan.dev` (CNAME `cname.vercel-dns.com`), `APP_URL`, Supabase Auth Site URL/redirect, Google OAuth redirect URI, `SECOND_BRAIN_URL` di n8n.                                        |
| 10.2 | ⏳ todo | Project demo: Vercel project kedua + Supabase project kedua, domain `2ndbrain-demo.ilramdhan.dev` (saran), env sendiri (Supabase keys, `N8N_API_KEY` berbeda, tanpa `GOOGLE_*`/`TELEGRAM_*`/`TOKEN_ENCRYPTION_KEY`).                |
| 10.3 | ⏳ todo | `APP_MODE=demo` (server) + `VITE_APP_MODE=demo` (UI): matikan OCR, voice, AI capture/ringkasan (tanpa `AI_API_KEY` atau provider gratis dengan kuota sangat kecil), Telegram, Google Calendar, webhook automations, restore backup. |
| 10.4 | ⏳ todo | Batas CRUD demo: kuota per user via `consume_rate_limit` (bucket `demo_write`), batas jumlah baris per tabel/user, ukuran teks lebih kecil; ditegakkan di server/DB (trigger), bukan hanya di UI.                                   |
| 10.5 | ⏳ todo | Akun demo: akun bersama read-mostly atau Supabase anonymous sign-in + CAPTCHA (Cloudflare Turnstile, didukung Supabase Auth) agar sign-up tidak di-abuse; nonaktifkan email sign-up biasa di project demo.                          |
| 10.6 | ⏳ todo | Reset DB terjadwal dari n8n: `POST /api/public/n8n/demo/reset` (hanya aktif bila `APP_MODE=demo`, `x-api-key`) → hapus data user demo + seed contoh (proyek, tugas, catatan berblok, dependensi); mis. tiap 6 jam / harian.         |
| 10.7 | ⏳ todo | UI demo: banner "Demo — data direset tiap N jam, fitur X dimatikan", tombol fitur nonaktif dengan tooltip, `robots` `noindex`, link ke produksi/repo.                                                                               |
| 10.8 | ⏳ todo | Test: unit untuk guard `APP_MODE`, SQL test untuk batas baris/trigger, smoke E2E demo (Phase 8.5) di preview.                                                                                                                       |

---

## Cara eksekusi (untuk sesi panjang / multi-agent)

- Setiap phase dibuka sebagai GitHub Milestone, setiap baris tabel = satu issue (template `feature_request`).
- Kerjakan per phase di branch `phase-N/<slug>`, PR ke `main`, squash merge **hanya sebelum push** (jangan rewrite history yang sudah ter-push — Lovable).
- Phase 2 dan 3 bisa berjalan paralel (database vs frontend). Phase 6 bisa paralel dengan 4–5 setelah Phase 1–2 selesai.
- Setelah tiap phase: perbarui `CHANGELOG.md`, centang tabel ini, ukur ulang metrik Phase 0.4.

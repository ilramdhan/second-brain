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
| 6     | Backend n8n                                   | Endpoint `/api/public/n8n/*` + aktifkan template    | 4–5 hari      | 1, 2              |
| 7     | Lepas dari lock-in Lovable gateway (opsional) | AI/Telegram/Calendar langsung ke provider           | 3–4 hari      | 6                 |
| 8     | Observability, PWA, a11y, SEO                 | Sentry, web-vitals, Workbox, WCAG 2.2 AA            | 3–4 hari      | 4                 |
| 9     | Fitur baru                                    | Roadmap fitur dari ANALYSIS §13                     | berkelanjutan | 5                 |

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

**Exit criteria:** preview deploy di Vercel bisa login dan CRUD tugas; angka baseline tercatat.

---

## Phase 1 — Security Hotfix (prioritas tertinggi)

| #   | Severity | Task                                                                                                                                                                                                                                                 | Acceptance                                                                                                                     |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | Critical | Webhook Telegram **fail-closed**: tolak request jika `TELEGRAM_WEBHOOK_SECRET` kosong atau header tidak cocok (compare constant-time).                                                                                                               | Request tanpa/dengan secret salah → 401.                                                                                       |
| 1.2 | Critical | Ganti `/link <email>` dengan **one-time code**: tombol "Hubungkan Telegram" di Settings menghasilkan kode 6–8 karakter (TTL 10 menit, sekali pakai, tabel `telegram_link_codes`), bot menerima `/link <kode>`. Hapus pencarian user via `listUsers`. | Tidak mungkin menautkan akun tanpa login ke akun itu; tidak ada enumerasi email.                                               |
| 1.3 | High     | Channel realtime kolaborasi catatan jadi **private** + RLS di `realtime.messages` (hanya pemilik/anggota project catatan).                                                                                                                           | User lain tidak bisa subscribe/broadcast ke channel catatan.                                                                   |
| 1.4 | High     | Policy project: member tidak boleh mengubah `projects.user_id`; `tasks/notes_member_all` dipecah per operasi, `user_id` tidak bisa dipalsukan (`with check user_id = auth.uid()` saat insert, immutable saat update via trigger).                    | Test RLS (Phase 5) membuktikan member tidak bisa ambil alih project atau hapus baris milik orang lain (kecuali sesuai aturan). |
| 1.5 | High     | Webhook otomasi: guard SSRF (tolak IP private/loopback/link-local/metadata setelah resolve DNS), timeout 5 detik, batas ukuran respons, payload hanya field yang diperlukan.                                                                         | Unit test untuk URL berbahaya.                                                                                                 |
| 1.6 | Medium   | Cron reminders pakai `authenticateCronRequest` (constant-time, dukung rotasi secret).                                                                                                                                                                | –                                                                                                                              |
| 1.7 | Medium   | AI server functions: validasi zod dengan `max` panjang input, rate limit per user (tabel counter atau Upstash).                                                                                                                                      | –                                                                                                                              |
| 1.8 | Medium   | Sign-out memanggil `queryClient.clear()`; restore backup memvalidasi skema dan memaksa `user_id = auth.uid()`.                                                                                                                                       | –                                                                                                                              |
| 1.9 | Medium   | Security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) via `vercel.json` atau middleware server.                                                                                                                  | Skor securityheaders.com ≥ A.                                                                                                  |

**Exit criteria:** tidak ada temuan Critical/High tersisa di ANALYSIS §3; `SECURITY.md` diperbarui.

---

## Phase 2 — Database Hardening

| #   | Task                                                                        | Catatan                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | Hapus trigger audit duplikat (0004 `<t>_audit` vs 0006 `audit_<t>_changes`) | Setiap write sekarang mencatat 2 baris audit.                                                                                                                                                                       |
| 2.2 | Tambah index                                                                | `user_id`, `project_id`, partial index `where deleted_at is null and archived_at is null`, `project_members(user_id, project_id)`, `task_dependencies(task_id)`/`(depends_on_id)`. Daftar lengkap di ANALYSIS §6.3. |
| 2.3 | Policy pakai `(select auth.uid())`                                          | Mencegah evaluasi per baris.                                                                                                                                                                                        |
| 2.4 | Constraint                                                                  | FK ke `auth.users` (on delete cascade), CHECK untuk `status`/`priority`/`role`, perluas sumber inbox (`email`, `google_calendar`, `webhook`) untuk n8n.                                                             |
| 2.5 | `drizzle/schema.ts`                                                         | Isi schema yang mencerminkan migration (opsional: dipakai untuk type generation), atau generate `supabase gen types`.                                                                                               |
| 2.6 | Verifikasi                                                                  | `explain analyze` query list utama sebelum/sesudah, catat di `docs/perf-baseline.md`.                                                                                                                               |

Semua dalam migration baru (`0008_…`, `0009_…`), **jangan edit migration lama**.

---

## Phase 3 — Performance Quick Wins (penyebab utama "lambat di semua halaman")

| #   | Task                                                                                                                                                                                                  | Dampak                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 3.1 | Default `QueryClient`: `staleTime: 60_000`, `gcTime: 30 * 60_000`, `refetchOnWindowFocus: false`, `retry: 1`; `defaultPreloadStaleTime` jangan 0.                                                     | Hilangkan refetch seluruh tabel tiap navigasi/alt-tab.        |
| 3.2 | `CommandMenu` tidak lagi memanggil `useTasks/useNotes/useProjects` saat tertutup; lazy-load saat dibuka + server search (`id, title`) dengan debounce.                                                | Halaman Settings/Activity tidak ikut mengunduh semua catatan. |
| 3.3 | `React.lazy` untuk `TaskDialogProvider` (isi dialog), `QuickCapture`, `QuickTask`, `FocusTimer`, graph (d3-force), editor blok.                                                                       | Bundle awal lebih kecil.                                      |
| 3.4 | Kolom eksplisit, bukan `select *`. List catatan hanya `id, title, updated_at, excerpt, tags`; `blocks/content` diambil lewat `useNote(id)`.                                                           | Payload jauh lebih kecil.                                     |
| 3.5 | Mutasi pakai `setQueryData` optimistik + invalidasi terarah, bukan invalidasi seluruh list.                                                                                                           | Autosave catatan tidak lagi memicu refetch semua catatan.     |
| 3.6 | Hoist hook per baris: `useTaskActions`/`useDeps` di parent, map `subtasksByParent` dan `depsByTask` via `useMemo`, `React.memo` untuk `TaskRow`; komponen `Group` di Upcoming dipindah keluar render. | Render list O(n), bukan O(n²).                                |
| 3.7 | Graph: update posisi via ref/canvas, bukan `setState` per tick d3.                                                                                                                                    | –                                                             |

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

| #   | Task                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | Pecah `src/lib/data.ts` menjadi `src/features/{tasks,notes,projects,milestones,automations}/{api,hooks,types}.ts`; `data.ts` sementara re-export agar perubahan bertahap (update AGENTS.md setelahnya).                                           |
| 5.2 | Hapus file shadcn yang tidak dipakai (±36) dan dependency mati (recharts, embla, input-otp, vaul, react-resizable-panels, react-hook-form, @hookform/resolvers, react-day-picker, @dnd-kit/sortable, ±20 paket radix) — verifikasi dengan `knip`. |
| 5.3 | Test: unit untuk `blocks.ts`, `nlp.ts`, evaluasi otomasi, SSRF guard; test RLS dengan Supabase lokal (pgTAP atau script vitest dengan 2 user); target coverage `src/lib` ≥ 70%.                                                                   |
| 5.4 | Typed Supabase client (`supabase gen types typescript`) dan hapus `any`.                                                                                                                                                                          |
| 5.5 | Error boundary per route + toast error yang konsisten.                                                                                                                                                                                            |

---

## Phase 6 — Backend Integrasi n8n

Kontrak lengkap ada di `integrations/n8n/README.md`. Semua endpoint di `src/routes/api/public/n8n/*`, auth header `x-api-key` = `N8N_API_KEY` (constant-time compare), body divalidasi zod, idempotensi via `update_id`/`message_id`.

| #   | Endpoint                                                                                               | Dipakai workflow |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| 6.1 | Helper auth + idempotency table `n8n_events`                                                           | semua            |
| 6.2 | `POST /api/public/n8n/bot` (command, teks, hasil OCR/transkrip, callback button)                       | 01               |
| 6.3 | `POST /api/public/n8n/capture` (inbox/task/note dari sumber apa pun)                                   | 01, 07, 08       |
| 6.4 | `GET /api/public/n8n/digest?kind=morning                                                               | evening          | overdue | weekly` | 02  |
| 6.5 | `POST /api/public/n8n/reminders`, `POST /api/public/n8n/maintenance` (purge trash lama, dll.)          | 02               |
| 6.6 | `GET /api/public/n8n/backup` (export per user, streaming JSON)                                         | 05               |
| 6.7 | `POST /api/public/n8n/calendar/sync` (refactor `syncTaskToGoogle` jadi helper server berbasis user id) | 07               |
| 6.8 | `POST /api/public/n8n/events` (opsional, event otomasi)                                                | 06               |
| 6.9 | Uji import semua template di n8n staging, dokumentasikan hasilnya.                                     | –                |

Catatan: satu bot Telegram hanya punya satu webhook — pilih mode n8n **atau** mode app-only (lihat README n8n).

---

## Phase 7 — Mengurangi Lock-in Lovable Gateway (opsional, untuk open-source)

Saat ini AI, Telegram, dan Google Calendar lewat `ai.gateway.lovable.dev` / `connector-gateway.lovable.dev`. Untuk kontributor open-source yang tidak punya akun Lovable:

- 7.1 Abstraksi provider: `src/server/providers/{ai,telegram,calendar}.ts` dengan dua implementasi (Lovable gateway vs langsung: OpenAI-compatible/Anthropic, Bot API dengan `TELEGRAM_BOT_TOKEN`, Google OAuth sendiri). Dipilih via env.
- 7.2 Dokumentasi self-host lengkap di README.

---

## Phase 8 — Observability, PWA, Aksesibilitas, SEO

| #   | Task                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 | Sentry (client + server) dengan source map upload di CI; `web-vitals` dikirim ke endpoint/analytics.                                                                                                                  |
| 8.2 | Ganti `public/sw.js` dengan Workbox (`vite-plugin-pwa`): precache asset, network-first untuk API, halaman offline, update prompt.                                                                                     |
| 8.3 | Aksesibilitas: alternatif keyboard untuk drag & drop (kanban/kalender/timeline), audit axe di CI (Playwright + `@axe-core/playwright`), `prefers-reduced-motion`, kontras token warna — mengikuti `ACCESSIBILITY.md`. |
| 8.4 | Hilangkan FOUC tema (script inline sebelum hydrate); `robots.txt` blokir route aplikasi; meta/OG untuk landing.                                                                                                       |
| 8.5 | E2E smoke test (Playwright) untuk alur login → buat tugas → buat catatan, jalan di CI pada preview deploy.                                                                                                            |

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

## Cara eksekusi (untuk sesi panjang / multi-agent)

- Setiap phase dibuka sebagai GitHub Milestone, setiap baris tabel = satu issue (template `feature_request`).
- Kerjakan per phase di branch `phase-N/<slug>`, PR ke `main`, squash merge **hanya sebelum push** (jangan rewrite history yang sudah ter-push — Lovable).
- Phase 2 dan 3 bisa berjalan paralel (database vs frontend). Phase 6 bisa paralel dengan 4–5 setelah Phase 1–2 selesai.
- Setelah tiap phase: perbarui `CHANGELOG.md`, centang tabel ini, ukur ulang metrik Phase 0.4.

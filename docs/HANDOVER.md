# Handover — Status Pengerjaan Second Brain

> Dokumen ini adalah titik awal untuk sesi AI berikutnya. Baca berurutan: `CLAUDE.md` → `AGENTS.md` → dokumen ini → bagian phase yang relevan di `docs/IMPLEMENTATION_PLAN.md`.
> Jangan memuat `docs/ANALYSIS.md` utuh; cukup cari section yang dirujuk plan (mis. `§2.4`, `§6.3`).
> Terakhir diperbarui: 2026-10-05.

## 1. Gambaran singkat

- **App:** Second Brain, PWA untuk task dan notes. Stack: TanStack Start + React 19 + Vite 8 + Supabase + TanStack Query + Tailwind 4 + shadcn/ui. Package manager: bun (`bun.lock`).
- **Deploy:** Vercel Hobby + Supabase Free.
  - Repo sudah **lepas dari Lovable**: tidak ada lagi env `LOVABLE_*` maupun `@lovable.dev/*`.
  - AI langsung ke provider (`AI_*`), Telegram langsung ke Bot API, Google Calendar lewat OAuth sendiri.
- **Integrasi:** n8n (opsional, owner punya server sendiri).
  - Endpoint `/api/public/n8n/*` dengan header `x-api-key`.
  - Template workflow ada di `integrations/n8n/`.
  - Semua jadwal (reminder, digest, maintenance, backup ke Google Drive + email via Resend SMTP) dijalankan dari n8n.
- **Repo:** https://github.com/ilramdhan/second-brain, maintainer Ilham Ramadhan (`@ilramdhan`), lisensi MIT.

## 2. Status phase

| Phase                        | Status                                   | Catatan                                                                                                                    |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0 Fondasi & deploy           | ✅ (0.3, 0.5 menunggu owner)             | CI, CodeQL, dependency review, deploy Vercel, Dependabot, Release Please                                                   |
| 1 Security hotfix            | ✅                                       | Migration 0008–0011                                                                                                        |
| 2 Database hardening         | ✅ merged (PR #16)                       | Migration 0013–0016 **belum dijalankan di Supabase produksi**                                                              |
| 3 Performance quick wins     | 🔍 PR #17 terbuka, menunggu review owner | Lihat §4                                                                                                                   |
| 4 Performance deep fix       | ⏭ berikutnya                             | Editor/Yjs, backlinks kolom `links/refs`, auth `beforeLoad`, RPC auto-shift, virtualisasi                                  |
| 5 Refactor & kualitas        | ⏳                                       | Termasuk 5.6–5.8: zod 4, ESLint 10 + react-hooks 7, TypeScript 7; hapus dependency mati (recharts, react-day-picker, dll.) |
| 6 Backend n8n                | ✅ (6.9 uji import di n8n: owner)        |                                                                                                                            |
| 7 Lepas dari Lovable         | ✅                                       |                                                                                                                            |
| 8 Observability/PWA/a11y/SEO | ⏳                                       |                                                                                                                            |
| 9 Fitur baru                 | ⏳ backlog                               |                                                                                                                            |
| 10 Domain + demo             | ⏳ rencana                               | Diusulkan sub-agent: `second-brain.ilramdhan.dev` dan demo terbatas. **Belum dikonfirmasi owner.**                         |

## 3. Aturan kerja (wajib)

- **Git & PR:**
  - Jangan force-push dan jangan rewrite history di `main`.
  - Satu phase atau topik = satu branch (`phase-N/<slug>`) = satu PR.
- **Merge:**
  - Pakai **Squash and merge**, dengan judul PR berformat Conventional Commit (`feat:`, `fix:`, `perf:`, …). Release Please tidak membaca commit "Merge pull request #…".
  - Owner yang me-review dan merge PR fitur. AI boleh merge sendiri hanya untuk PR CI/chore kecil jika diminta.
- **Jangan edit `CHANGELOG.md` manual**: file ini dibuat otomatis oleh Release Please.
- **Commit message:**
  - Conventional Commit, dengan body yang menjelaskan _kenapa_.
  - Diakhiri baris `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Sebelum commit:** jalankan `eslint .`, `prettier --check .`, `tsc --noEmit`, `vitest run`, `vite build`, `node scripts/check-migrations.mjs`. bun tidak ada di PATH mesin owner, jadi pakai `npx bun@1.4.2 …` atau `node_modules/.bin/*`.
- **Migration:**
  - Selalu buat migration baru (yang terakhir `0016`). Jangan edit migration lama.
  - Update `drizzle/migrations/meta/_journal.json` dan buat snapshot minimal.
  - Validasi di container sementara `public.ecr.aws/supabase/postgres:15.19.0.002` dengan `supabase/tests/*.sql` (ada `realtime_stub.sql`), lalu hapus container-nya.
- **Pola kerja:** sub-agent driven agar hemat token.
  - Orkestrator hanya membagi tugas dan merangkum hasil.
  - Sub-agent yang berjalan paralel bekerja di worktree terpisah (`.claude/` di-gitignore).
  - Laporan akhir sub-agent dibuat singkat.
- **Bahasa:** dokumen plan/analisis dan UI memakai Bahasa Indonesia, dokumen open-source (README, CONTRIBUTING, dll.) memakai bahasa Inggris.

## 4. PR terbuka: #17 (Phase 3, performa)

https://github.com/ilramdhan/second-brain/pull/17. CI hijau, Vercel preview ter-deploy, belum di-merge.

- **Isi:**
  - Default QueryClient: staleTime 60 detik, tanpa refetch saat fokus.
  - CommandMenu lazy dengan pencarian `ilike`.
  - Layout lazy: TaskEditor, QuickTask, QuickCapture.
  - List notes tanpa `blocks`; ada `useNote(id)` dan `useNoteBlocks()` untuk halaman note/graph.
  - Update cache optimistik.
  - Hook per baris di-hoist ke parent, `React.memo` untuk baris.
  - Posisi graph lewat ref, bukan setState per tick.
- **Bundle:** entry + layout 269,7 → 219,5 KiB gzip (−19%).
- **Risiko:**
  - Write yang gagal sekarang di-rollback dengan toast.
  - Perubahan dari user lain atau n8n bisa telat sampai 60 detik.
  - Auto-shift dependency, recurrence dan cek blocked sekarang memakai data cache.
- **QA:** checklist lengkap ada di body PR. Fokus pada Today/Tasks, Kanban, task dialog, editor note (autosave, `[[`/`((`, backlinks, restore versi), graph, Cmd+K, inbox AI, archive, restore backup.
- **Belum selesai:** list notes masih membawa `content` untuk preview dan pencarian. Excerpt sungguhan butuh migration; kandidat Phase 4.

## 5. Checklist manual owner (belum dikonfirmasi selesai)

1. **Supabase:**
   - Jalankan migration 0008–0016 (`DATABASE_URL=… bunx drizzle-kit migrate`) saat sepi pengguna.
   - Cek constraint yang masih `NOT VALID` (query ada di PR #16).
   - Set Auth redirect URL ke domain Vercel.
2. **Vercel:** isi env sesuai `.env.example`, hapus env lama Lovable/connector.
3. **Google Cloud:**
   - Aktifkan Calendar API dan Drive API.
   - Buat OAuth client dengan redirect `https://<domain>/oauth/google-calendar/return`.
   - Buat credential Drive untuk n8n.
4. **Telegram:**
   - Bot dari BotFather.
   - Set `TELEGRAM_WEBHOOK_SECRET`; tanpa secret ini bot menolak semua update.
   - Pilih mode n8n (workflow 01) atau mode app (`setWebhook` dengan `secret_token`).
5. **Resend:** verifikasi domain dan buat API key. SMTP `smtp.resend.com:465`, user `resend`.
6. **n8n:**
   - Buat credential.
   - Import workflow dengan urutan 03 → 04 → 01 → 02 → 05 → 06 → 07 → 08.
   - Set 03 sebagai error workflow.
   - Tes 04 dan 05.
7. **GitHub:**
   - Release Please sudah bisa membuat release PR (PR #18 `chore(main): release 0.2.0`). Opsional: tambahkan secret `RELEASE_PLEASE_TOKEN` (fine-grained PAT; Contents, PR, Issues read/write) agar CI juga jalan di release PR. Merge release PR untuk menerbitkan tag dan GitHub Release.
   - Aktifkan branch protection `main`, Private vulnerability reporting dan Discussions.
8. **Tes dengan layanan sungguhan:**
   - Kolaborasi note dengan 2 anggota dan 1 orang luar (harus diblokir).
   - Telegram `/link <kode>`.
   - Reconnect Google Calendar (wajib sekali per user).
   - Backup ke Drive.
   - Laporan CSP di console. Setelah bersih, ubah CSP resource dari report-only ke enforce (lihat SECURITY.md).
   - Isi metrik runtime di `docs/perf-baseline.md`.

## 6. Urutan kerja berikutnya (rekomendasi)

1. Tindak lanjuti review PR #17: perbaiki temuan QA owner, lalu owner merge.
2. **Phase 4**, dipecah per PR:
   - (a) hot path editor: autosize, `InlineText`;
   - (b) kolom `links/refs` + excerpt (migration) + backlinks di server;
   - (c) Yjs granular + autosave dari satu leader;
   - (d) auth di `beforeLoad` + loader `ensureQueryData`;
   - (e) RPC auto-shift/recurrence;
   - (f) virtualisasi list.
3. **Phase 5:** pecah `data.ts` per fitur, hapus dependency mati (pakai `knip`), test RLS dan unit test, typed Supabase client, lalu upgrade zod 4 / ESLint 10 / TS 7 (5.6–5.8).
4. **Phase 8:** Sentry + web-vitals, Workbox (`vite-plugin-pwa`), a11y (keyboard DnD, axe di CI, reduced motion), Playwright E2E.
5. **Phase 10 / 9:** tunggu keputusan owner.

## 7. Peta dokumen

| File                                                      | Isi                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `CLAUDE.md`, `AGENTS.md`                                  | Konvensi dan aturan arsitektur                                         |
| `docs/IMPLEMENTATION_PLAN.md`                             | Plan Phase 0–10 dengan status per baris                                |
| `docs/ANALYSIS.md`                                        | Audit lengkap (performa, keamanan, ERD, fitur); rujuk per section      |
| `docs/perf-baseline.md`                                   | Angka bundle, explain DB sebelum/sesudah, metrik runtime (placeholder) |
| `integrations/n8n/README.md`                              | Workflow, env n8n, kontrak endpoint                                    |
| `SECURITY.md`, `ACCESSIBILITY.md`, `CONTRIBUTING.md`      | Kebijakan dan proses                                                   |
| `supabase/tests/*.sql`, `supabase/perf/explain_lists.sql` | Tes RLS/DB dan skrip explain                                           |

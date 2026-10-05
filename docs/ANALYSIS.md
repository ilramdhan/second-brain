# Analisis Teknis — Second Brain

> Cakupan: performa, keamanan, database/ERD, arsitektur, kualitas kode, UI/UX, PWA, observability, SEO, i18n, katalog fitur, dan rekomendasi.
> Metode: analisis statis (read-only) atas `src/`, `drizzle/migrations/`, `public/`, dan konfigurasi. `node_modules` tidak ada (repo memakai `bun.lock`), jadi **`npm run build` tidak dijalankan** dan ukuran chunk belum diverifikasi. Lihat §2.9 untuk cara memverifikasinya.
> Notasi bukti: `file:baris`. Severity: **Critical / High / Medium / Low**.

---

## 0. Ringkasan Eksekutif

Aplikasi terasa lambat dan berat di **semua halaman** walaupun datanya sedikit. Penyebabnya bukan volume data. Penyebabnya adalah **pola akses data dan render**:

1. **QueryClient tanpa default** (`staleTime: 0`, `refetchOnWindowFocus: true`). Setiap pindah halaman atau fokus tab memicu refetch ulang _seluruh_ tabel tasks/notes/projects/milestones/deps/automations dengan `select *`.
2. **Layout mengambil semua data secara eager.** `CommandMenu` selalu ter-mount (walau tertutup) dan memanggil `useTasks/useNotes/useProjects`. Karena itu _setiap_ halaman, termasuk Settings atau Activity, mengunduh semua catatan lengkap dengan `blocks` jsonb **dan** `content` (dobel).
3. **Setiap mutasi langsung invalidate seluruh list.** Autosave catatan tiap 700 ms memicu refetch semua notes, lalu backlinks, index blok, dan editor dihitung ulang dari nol.
4. **Hot-path render yang mahal**, misalnya `TaskRow` memanggil `useTaskActions()` → `useAutomations()` + `useServerFn` per baris, `autosize` dijalankan untuk semua textarea pada setiap render, `InlineText` berlangganan `useNotes` per fragmen, dan graph melakukan `setState` per tick simulasi.
5. **Auth gating murni di client.** SSR hanya merender spinner, lalu urutannya menjadi waterfall: hydrate → `getSession` → RPC `accept_project_invites` → baru query data.

Di sisi keamanan ada beberapa celah serius. Webhook Telegram _fail-open_ dan `/link email` bisa membajak kanal notifikasi akun lain. Kanal kolaborasi Yjs bersifat **publik** (tidak `private`), sehingga pihak luar bisa menyuntik isi catatan. RLS `projects_member_update` membuat anggota proyek bisa **mengambil alih kepemilikan proyek**. Webhook otomasi rentan SSRF dan tidak punya timeout.

---

## 1. Top 15 Aksi (Prioritas)

| #   | Aksi                                                                                                                                                                                                                           | Severity | Area           | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------- | ------ |
| 1   | Webhook Telegram: wajibkan secret (fail-closed) dan ganti `/link email` dengan kode one-time dari halaman Settings                                                                                                             | Critical | Security       | S      |
| 2   | Kanal `note-collab:*` dijadikan `private: true`, tambah RLS di `realtime.messages`, validasi peserta = anggota note                                                                                                            | High     | Security       | M      |
| 3   | Kunci kolom `user_id` di projects/tasks/notes/canvas_nodes (trigger `BEFORE UPDATE` atau pisahkan policy owner/member) agar anggota tidak bisa mengambil alih kepemilikan                                                      | High     | Security/DB    | S      |
| 4   | Set default QueryClient: `staleTime` 60–300 s, `gcTime` 30 m, `refetchOnWindowFocus: false` (atau tetap aktif tapi dengan staleTime), `retry: 1`; atur `defaultPreloadStaleTime`                                               | High     | Perf           | XS     |
| 5   | Hentikan fetch global dari layout: `CommandMenu` di-mount hanya saat `open` (lazy), `useAutomations` hanya dipanggil saat mutasi, hook per-baris (`useTaskActions`, `useDeps`) dipindah ke induk list                          | High     | Perf           | S      |
| 6   | Kurangi payload: kolom eksplisit untuk list; list notes tanpa `blocks`/`content` penuh (pakai `excerpt`); detail note di-fetch per id                                                                                          | High     | Perf           | M      |
| 7   | Mutasi menulis langsung ke cache (`.select().single()` + `setQueryData`), bukan invalidate seluruh list; autosave catatan tidak boleh refetch semua notes                                                                      | High     | Perf           | M      |
| 8   | Perbaiki hot-path editor catatan: `autosize` hanya untuk blok yang berubah, hoist hook `InlineText`, `useDeferredValue` untuk backlinks, update Yjs inkremental (Y.Array/Y.Text)                                               | High     | Perf           | M      |
| 9   | Pindahkan auth ke `beforeLoad` router (session di router context) dan set `ssr: false` untuk `_authenticated` (atau SSR auth via cookie); `accept_project_invites` hanya saat `SIGNED_IN`; `queryClient.clear()` saat sign-out | High     | Perf/Security  | M      |
| 10  | Migrasi DB: index untuk filter RLS/list, `(select auth.uid())` di policy, **hapus trigger audit duplikat**, cek constraint/enum                                                                                                | High     | DB/Perf        | S      |
| 11  | Webhook otomasi: blokir IP privat/loopback (resolve DNS), `redirect: "manual"`, timeout 5 s; AI serverFn: batas ukuran input dan rate limit per user                                                                           | High     | Security       | S      |
| 12  | Cron reminders: pakai `authenticateCronRequest` (constant-time, env secret), hilangkan N+1 (join profiles), index parsial                                                                                                      | Medium   | Security/Perf  | S      |
| 13  | Verifikasi code-splitting lewat build; lazy-load dialog berat (TaskEditor, QuickCapture, cmdk); hapus ±36 komponen shadcn dan dependensi yang tidak dipakai                                                                    | Medium   | Perf/Bundle    | S      |
| 14  | Deploy Vercel: preset nitro `vercel`, header keamanan + CSP, perbaiki strategi Service Worker (cache aset hashed atau nonaktifkan)                                                                                             | Medium   | Infra/Security | S      |
| 15  | Pecah `data.ts` per fitur, tambah unit test (`blocks.ts`, `nlp.ts`, automations, dependency logic), pasang Sentry dan web-vitals                                                                                               | Medium   | Quality/Obs    | M      |

---

## 2. Performance Root Causes

### 2.1 [High] QueryClient tanpa defaultOptions → refetch terus-menerus

- **Bukti:** `src/router.tsx:6` `new QueryClient()` tanpa opsi; `src/router.tsx:12` `defaultPreloadStaleTime: 0`. Hanya `useMe` yang punya `staleTime` (`src/lib/data.ts:39`).
- **Mekanisme:** default TanStack Query adalah `staleTime: 0`, `refetchOnMount: true`, dan `refetchOnWindowFocus: true`. Setiap navigasi me-mount ulang komponen halaman yang memanggil `useTasks/useProjects/useMilestones/useNotes`, sehingga semua di-refetch. Setiap alt-tab kembali ke aplikasi juga me-refetch 4–6 query `select *` secara bersamaan.
- **Dampak:** spinner/flash di setiap navigasi, trafik jaringan konstan, dan re-render seluruh view saat data datang (identitas array baru).
- **Fix:**
  ```ts
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
  ```
  Opsional: tambahkan Supabase Realtime `postgres_changes` (terfilter `user_id`) untuk invalidasi yang tepat sasaran, bukan polling via focus.

### 2.2 [High] Layout `_authenticated` mengambil semua data di setiap halaman

- **Bukti:** `src/routes/_authenticated.tsx:227` `<CommandMenu open={cmd} …/>` selalu dirender. `src/components/CommandMenu.tsx:12-14` memanggil `useTasks()`, `useProjects()`, `useNotes()` tanpa syarat `open`. `TaskDialogProvider` (`src/components/tasks/TaskDialogProvider.tsx:48-75`) dan `QuickCapture`/`QuickTask` diimpor eager di layout (`_authenticated.tsx:32-35`).
- **Dampak:** halaman ringan (Settings, Activity, Reports) tetap mengunduh **seluruh notes**, termasuk `blocks` jsonb dan `content` markdown (data yang sama tersimpan dua kali), plus seluruh tasks. Ini _root cause_ utama keluhan "semua halaman berat".
- **Fix:** render `CommandMenu` hanya saat `cmd === true` (`{cmd && <CommandMenu …/>}`) dan lazy-load komponennya (`React.lazy`). Di dalamnya, pakai query ringan `select("id,title")` atau pencarian server-side (`ilike`/FTS). Lakukan hal yang sama untuk dialog Capture/Quick.

### 2.3 [High] Over-fetching `select("*")` tanpa batas

- **Bukti:** `src/lib/data.ts:47` (tasks `*`), `:57` (projects `*`), `:67` (notes `*` termasuk `blocks` + `content` + `properties`), `:77` (milestones `*`, tanpa filter soft-delete/proyek terhapus), `:87` (semua `task_dependencies`), `:97` (automations). `src/routes/_authenticated/inbox.tsx:48` mengambil projects `*` lagi lewat `useState` (di luar cache, tanpa filter `deleted_at`). `src/routes/_authenticated/settings.tsx:178` backup `select *`.
- **Dampak:** payload notes tumbuh linear terhadap total isi catatan karena konten disimpan dobel (`blocks` + `content`). Parsing JSON besar terjadi di main thread setiap refetch.
- **Fix:** definisikan konstanta kolom per view, misalnya `TASK_LIST_COLS = "id,title,status,priority,project_id,parent_id,due_date,start_date,tags,assignee_id,assignee_name,recurrence,position,completed_at,estimate_minutes,time_block_end,created_at,updated_at"`. Untuk notes list cukup `id,title,tags,status,pinned,project_id,updated_at,position` + `excerpt` (kolom generated `left(content, 300)`). Ambil `useNote(id)` terpisah untuk editor. Backlinks dihitung via tabel/kolom `links` (lihat §2.6).

### 2.4 [High] Setiap mutasi meng-invalidate seluruh list (refetch penuh)

- **Bukti:** `src/lib/data.ts:139` (`await invalidate()` di `create`, user menunggu refetch sebelum dialog tertutup), `:147` (`update` → `invalidate()`), `:157-158`, `:164-165`. Auto-shift dependents memanggil `crud.update` secara serial dalam loop (`:228`), jadi N update menghasilkan N refetch penuh. `setStatus` → `update` → invalidate, lalu `automate` invalidate lagi (`:192-194`). Autosave catatan: `notes.$noteId.tsx:75` → `actions.update` → invalidate `["notes"]`, dan ini terjadi **setiap 700 ms saat mengetik** (`:81`).
- **Dampak:** setiap centang tugas atau setiap jeda mengetik memicu download ulang semua tasks/notes. Array baru → semua komponen yang memakai `useNotes` re-render, dan backlinks/index dihitung ulang.
- **Fix:** gunakan `useMutation` dengan `onMutate` (optimistic), `onError` (rollback), dan `onSuccess` yang memanggil `setQueryData` dengan baris hasil `.select().single()`. Hapus `invalidate()` untuk update biasa. Untuk auto-shift, kirim batch via RPC `shift_dependents(task_id, delta)` di DB.

### 2.5 [High] Hook berat per item list (N× subscription & N× computation)

- **Bukti:**
  - `src/components/tasks/TaskItem.tsx:61` `TaskRow` → `useTaskActions()` → `useCrud` + `useAutomations()` + 2× `useServerFn` (`data.ts:170-178`) **per baris**.
  - `TaskItem.tsx:24` `useBlocked` → `useDeps()` per baris; `openBlockers` melakukan `deps.filter` + `tasks.find` per baris (`data.ts:105-110`), sehingga kompleksitasnya O(n·d).
  - `TaskItem.tsx:62,87` `allTasks.filter(t => t.parent_id === task.id)` per baris → O(n²). `projects.find` per baris (`:79,93`).
  - `TaskViews.tsx:28-31` filter + sort tanpa `useMemo`. `Upcoming` menjalankan `tasks.filter` 14× (`TaskViews.tsx:106-107`) dan membuat komponen `Group` baru di dalam render (`:88`), sehingga remount setiap render.
  - `calendar.tsx:83` `m.set(k, [...(m.get(k) ?? []), t])` menyalin array per hari, jadi O(n·hari²). `colorFor` memanggil `projects.find` per chip (`:97-100`).
- **Fix:** hitung peta sekali di induk (`subsByParent`, `blockersById`, `projectById`) dengan `useMemo`, lalu kirim lewat props atau context. `setStatus` diambil dari satu hook di induk. Bungkus `TaskRow`/`TaskCard` dengan `React.memo`. Komponen di dalam render (`Group`, `Row`, `Picker` di `TaskDialogProvider.tsx:286,297`) dipindah ke top-level.

### 2.6 [High] Editor catatan: hot path per ketikan sangat mahal

- **Bukti:**
  - `src/components/notes/BlockEditor.tsx:120` `useEffect(() => { refs.current.forEach(autosize); })` **tanpa deps**. Setiap render, untuk setiap blok, dilakukan set `height=0` lalu baca `scrollHeight` (`:400-403`), yang memaksa layout reflow N kali per ketikan (layout thrashing).
  - `BlockEditor.tsx:31-34` `InlineText` memanggil `useOpenTitle()` (→ `useNotes`, `useNoteActions`, `useNavigate`) **dan** `useNotes()` per instance, termasuk rekursif untuk block refs (`:53`). Untuk setiap `[[link]]`, `notes.some(...)` scan semua notes (`:41`).
  - `notes.$noteId.tsx:89-107` backlinks: `useMemo` bergantung pada `blocks`. Setiap ketikan me-loop **semua** notes → `loadBlocks(n)` (regex `fromLine` per blok `p`, `blocks.ts:48-53`) → `linksOf` per blok, ditambah `n.content.toLowerCase().includes`.
  - `indexBlocks(notes)` dihitung dua kali (`notes.$noteId.tsx:108` dan `BlockEditor.tsx:105`), masing-masing mem-parse ulang semua notes.
  - `QueryView` (`BlockEditor.tsx:67-71`) berlangganan notes+tasks+projects dan menjalankan `runQuery` ulang setiap kali cache berubah.
  - Kolaborasi: `use-note-collaboration.ts:29` meng-_set_ seluruh `JSON.stringify(blocks)` ke Y.Map per ketikan, sehingga update Yjs = seluruh dokumen dan broadcast seluruh dokumen per ketikan (tanpa CRDT granular). Penerima melakukan `setBlocks` + `schedule()` (`notes.$noteId.tsx:85`), jadi **setiap klien juga autosave**. Dua editor menulis bersamaan memperbanyak write, dan trigger `snapshot_note_change` + audit berjalan setiap kali.
- **Dampak:** input lag yang terasa di catatan berukuran sedang, CPU tinggi, dan semakin buruk seiring jumlah catatan.
- **Fix:** autosize hanya di `onChange` blok tersebut (atau CSS `field-sizing: content`). Hoist `notes`/`titleSet` ke context editor dan kirim `Set` judul ke `InlineText`. Backlinks dihitung dari server (kolom `links text[]`/`refs text[]` yang diisi saat save + index GIN) atau minimal dengan `useDeferredValue(blocks)` dan hanya bergantung pada `note.title`. Gunakan `Y.Array<Y.Map>` + `Y.Text` per blok. Hanya satu klien (pengubah lokal) yang autosave.

### 2.7 [High] Auth gating client-only → SSR terbuang dan waterfall

- **Bukti:** `src/routes/_authenticated.tsx:59-81`: `session` awalnya `undefined`, sehingga SSR **selalu** merender spinner `Brain` (`:75-80`). Setelah hydrate: `getSession()` → render Shell → komponen halaman memulai query. `:70-73` `accept_project_invites` RPC dipanggil setiap objek `session` berubah, termasuk `TOKEN_REFRESHED` (tiap ±1 jam) dan setiap `onAuthStateChange`. `setSession(s)` objek baru (`:64`) me-re-render seluruh layout.
- **Dampak:** TTFB SSR ditambah unduh bundle, hydrate, `getSession`, lalu query. Konten pertama baru muncul setelah ±3 round-trip. SSR tidak memberi manfaat tetapi tetap membebani server (cold start serverless).
- **Fix:** `beforeLoad` di route `_authenticated` (cek session, `redirect` ke `/login`), simpan session di router context, dan set `ssr: false` untuk subtree terautentikasi (atau gunakan SSR cookie-based Supabase supaya loader bisa `ensureQueryData`). Tambahkan `loader: ({context}) => context.queryClient.ensureQueryData(tasksQuery)` per route agar fetch paralel dengan render chunk.

### 2.8 [Medium] Knowledge graph: setState per tick simulasi

- **Bukti:** `src/routes/_authenticated/graph.tsx:77` `.on("tick", () => tick(t => t + 1))` memicu re-render React untuk seluruh SVG ±300 kali per settle. `:62` `nodes.some` di dalam `edges.filter` → O(E·N). `noteGraph` mem-parse semua blok semua notes (`blocks.ts:102-119`).
- **Fix:** throttle via `requestAnimationFrame`, atau update atribut DOM langsung lewat ref. Gunakan `Set` untuk node id. Hitung edges dari kolom `links` server-side.

### 2.9 [Medium] Code splitting dan bundle

- **Bukti:** tidak ada `React.lazy` sama sekali (grep). Plugin `tanstackStart` umumnya mengaktifkan `autoCodeSplitting` per route (perlu diverifikasi via build), tetapi **semua yang diimpor dari layout masuk ke chunk utama**: `TaskDialogProvider` (+ `FocusTimer`, `syncTaskToGoogle`, `date-fns/locale`), `CommandMenu` (cmdk), `QuickCapture` (`ai.functions` stub), `QuickTask` (nlp), Sheet, Dialog (`_authenticated.tsx:32-38`).
- Dependensi **tidak dipakai** di kode aplikasi (hanya di file `components/ui/*` yang tidak diimpor): `recharts` (chart.tsx), `embla-carousel-react`, `input-otp`, `vaul`, `react-resizable-panels`, `react-hook-form`, `@hookform/resolvers` (tidak dipakai sama sekali), `react-day-picker`, `@dnd-kit/sortable` (tidak dipakai), serta ±20 paket `@radix-ui/*`. **36 dari 46 komponen `src/components/ui` tidak pernah diimpor**. Yang dipakai hanya button, command, dialog, dropdown-menu, input, select, sheet, switch, tabs, textarea.
- Dampaknya ke bundle produksi kecil (tree-shaking), tetapi besar ke waktu install/CI, `optimizeDeps` dev, dan permukaan supply-chain.
- **Verifikasi:** `bun install && bun run build`, lalu periksa `.output/public/assets/*.js` (`ls -lS`) atau `npx vite-bundle-visualizer`. Target: chunk entry < 200 KB gzip, `yjs` hanya di chunk route notes, `d3-force` hanya di chunk graph.
- **Fix:** `const CommandMenu = lazy(() => import(...))` dan sejenisnya untuk TaskEditor/QuickCapture. Hapus dependensi dan file UI yang tidak dipakai.

### 2.10 [Medium] Overhead tulis di database per perubahan kecil

- **Bukti:** `0004_productivity_platform_extensions.sql:226-232` membuat trigger `%I_audit`. `0006_complete_activity_audit_triggers.sql:12-13` hanya men-drop `audit_%I_changes` lalu membuat trigger **dengan nama berbeda**, sehingga 15 tabel kini punya **dua trigger audit**. Setiap insert/update/delete menulis **dua** baris `activity_logs`. Notes juga punya `BEFORE UPDATE` snapshot (`0005:17-20`, query `max()` per update).
- **Dampak:** setiap autosave (tiap 700 ms) menghasilkan 1 update + 2 insert audit + 1 agregat. `activity_logs` tumbuh 2× tanpa retensi.
- **Fix:** `DROP TRIGGER IF EXISTS <t>_audit ON public.<t>` untuk ke-15 tabel. Skip audit jika hanya `updated_at`/`position` yang berubah. Tambahkan retensi `activity_logs` (cron hapus > 90 hari).

### 2.11 [Medium] RLS mahal per baris

- **Bukti:** policy memanggil `public.is_project_member(project_id, auth.uid())` per baris (`0002:147-157`). Ada dua policy permissive per tabel (`tasks_owner` + `tasks_member_all`) yang dievaluasi dengan OR. `auth.uid()` tidak dibungkus `(select auth.uid())`. Tidak ada index `tasks(user_id)`, `notes(user_id)`, `tasks(project_id)`, dll. (lihat §6.3).
- **Fix:** `USING (user_id = (select auth.uid()) OR project_id IN (select private.my_project_ids()))` dengan fungsi `STABLE` yang mengembalikan set id proyek sekali per query, plus index.

### 2.12 [Low] Service worker

- **Bukti:** `public/sw.js:9-11` navigasi network-first dengan fallback ke `/` yang di-cache saat install (`:2-3`). `:13` hanya cache image/font/manifest, **tidak** cache JS/CSS. `src/routes/__root.tsx:125` memanggil `registration.update()` setiap load (fetch `sw.js` ekstra).
- **Dampak:** SW tidak mempercepat apa pun dan tidak memblokir. Fallback offline `/` berisi HTML SSR spinner dengan hash aset lama, yang setelah deploy menunjuk ke file yang sudah tidak ada (offline rusak). Tidak ada versioning otomatis (`CACHE` manual `v2`).
- **Fix:** gunakan `vite-plugin-pwa`/Workbox: precache aset hashed (cache-first), `NetworkFirst` untuk HTML dengan timeout, prompt update. Hapus `registration.update()` paksa.

### 2.13 [Low] Lain-lain

- Tema diterapkan di `useEffect` setelah hydrate (`src/lib/preferences.tsx:46-55`), menyebabkan **flash tema terang** (FOUC) di mode gelap. Fix: inline script di `<head>` (RootShell).
- `QuickCapture` memakai `supabase.auth.getUser()` (network round-trip ke Auth) setiap simpan (`QuickCapture.tsx:29-31`), begitu juga `inbox.tsx:60-62`. Cukup pakai `getSession()` atau `getUid()`.
- Preview Lovable: `brokeredPreviewStorage` `getItem` punya timeout 2 s + retry 250 ms (`previewAuthStorage.ts:31,58-66`), jadi **di preview Lovable** load awal bisa tertunda hingga ±4 s. Ini tidak terjadi di domain produksi.
- Tidak ada font eksternal (bagus). CSS: `backdrop-blur` hanya di header mobile (`_authenticated.tsx:172`), dampaknya kecil.

---

## 3. Keamanan

| ID  | Severity     | Temuan                                                                                          | Bukti                                                                                                                                     | Dampak                                                                                                                                                                                                                                                         | Fix                                                                                                                                                                                                                          |
| --- | ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Critical** | Webhook Telegram _fail-open_: secret hanya dicek jika env ada                                   | `src/routes/api/public/telegram/webhook.ts:35-38`                                                                                         | Jika `TELEGRAM_WEBHOOK_SECRET` tidak di-set (roadmap: bot belum terhubung), siapa pun bisa POST update palsu                                                                                                                                                   | `if (!secret \|\| header !== secret) return 401` dengan perbandingan constant-time                                                                                                                                           |
| S2  | **Critical** | `/link email` menautkan chat ke akun mana pun **tanpa verifikasi kepemilikan**                  | `webhook.ts:62-71`                                                                                                                        | Penyerang mengirim `/link korban@mail.com` lalu menerima semua reminder/otomasi Telegram korban (judul tugas, deadline) dan dapat menyuntik item ke Inbox korban. Juga user enumeration (`:73`). `listUsers()` hanya membaca halaman pertama (default 50 user) | Settings membuat kode one-time (`profiles.telegram_link_code` + expiry), lalu bot menerima `/link <kode>`. Pesan respons dibuat seragam                                                                                      |
| S3  | **High**     | Realtime kolaborasi catatan memakai kanal broadcast publik                                      | `src/hooks/use-note-collaboration.ts:18` (tanpa `config: { private: true }`)                                                              | Siapa pun dengan anon key + `noteId` bisa subscribe (membaca isi catatan live) dan mengirim `y-update`. Klien korban menerapkannya lalu **autosave** (`notes.$noteId.tsx:85`), sehingga penyerang dapat menimpa catatan memakai sesi korban                    | `private: true` + policy RLS di `realtime.messages` (topic `note-collab:<id>` hanya untuk owner/anggota); validasi payload                                                                                                   |
| S4  | **High**     | Anggota proyek bisa mengambil alih proyek                                                       | `0002_workspace_features.sql:144-145` `projects_member_update` WITH CHECK `is_project_member(id, …)` tidak membatasi kolom `user_id`      | Anggota meng-update `projects.user_id = dirinya`, menjadi owner, lalu bisa mengelola/mengeluarkan member (`members_owner_manage`) dan soft-delete proyek                                                                                                       | Trigger `BEFORE UPDATE` yang menolak perubahan `user_id` kecuali oleh owner; batasi kolom yang boleh diubah member (GRANT kolom atau trigger)                                                                                |
| S5  | **High**     | Spoofing `user_id` di tasks/notes/milestones shared                                             | `0002:147-153` `tasks_member_all`/`notes_member_all` WITH CHECK hanya `is_project_member(project_id)`                                     | Member dapat insert/update baris dengan `user_id` orang lain, memindahkan tugas ke proyek lain, atau menghapus permanen tugas anggota lain                                                                                                                     | WITH CHECK tambahkan `user_id = (select auth.uid())` untuk INSERT; trigger immutable `user_id`; pisahkan policy DELETE ke owner/creator                                                                                      |
| S6  | **High**     | SSRF + tanpa timeout di aksi webhook otomasi                                                    | `src/lib/automations.functions.ts:109-118` hanya cek `https:`                                                                             | Bisa menembak host internal via https (`https://10.x`, `https://localhost`, metadata via DNS rebinding), redirect diikuti, `fetch` tanpa timeout sehingga fungsi serverless menggantung. Payload mengirim **seluruh baris task** (`task: current`)             | Resolve DNS dan tolak IP privat/loopback/link-local, `redirect: "manual"`, `AbortSignal.timeout(5000)`, allowlist domain opsional, kirim field minimal                                                                       |
| S7  | Medium       | Token cron disimpan di tabel dan dibandingkan non-constant-time; helper yang aman tidak dipakai | `src/routes/api/public/hooks/reminders.ts:28-36`; `src/integrations/supabase/cron-auth.ts` (tidak dipakai)                                | Timing attack (teoritis); query DB per request tanpa auth sehingga endpoint bisa dipakai untuk DoS                                                                                                                                                             | Pakai `authenticateCronRequest` (env `LOVABLE_CRON_SECRET` / `CRON_SECRET` Vercel)                                                                                                                                           |
| S8  | Medium       | AI serverFn tanpa batas ukuran input dan rate limit                                             | `src/lib/ai.functions.ts:9` (`dump` tanpa `.max`), `:32`, `:45` (decode base64 dulu baru cek 10 MB, `:48-49`), `:55` (gambar tanpa batas) | Penyalahgunaan biaya AI (gateway Lovable), memory blowup di serverless                                                                                                                                                                                         | `z.string().max(…)`, cek panjang base64 sebelum decode (`len*3/4`), rate limit per `userId` (tabel/Upstash)                                                                                                                  |
| S9  | Medium       | Cache data user sebelumnya tidak dibersihkan saat sign-out                                      | `_authenticated.tsx:116-120,121-126` tanpa `queryClient.clear()`; `useMe` `staleTime: Infinity` (`data.ts:35-41`)                         | Di perangkat bersama, user berikutnya sempat melihat data/email user sebelumnya                                                                                                                                                                                | `queryClient.clear()` di `SIGNED_OUT`; key query menyertakan `userId`                                                                                                                                                        |
| S10 | Medium       | Undangan proyek berbasis email tanpa cek verifikasi email                                       | `0002:105-117` `accept_project_invites` memakai `auth.users.email`                                                                        | Jika konfirmasi email nonaktif, orang yang mendaftar dengan email undangan (tanpa memilikinya) otomatis bergabung                                                                                                                                              | Syaratkan `email_confirmed_at IS NOT NULL`; pastikan "Confirm email" aktif di Supabase Auth                                                                                                                                  |
| S11 | Medium       | Tidak ada header keamanan / CSP                                                                 | `src/server.ts`, `src/start.ts` (tidak ada set header), tidak ada `vercel.json`                                                           | Clickjacking, mitigasi XSS lemah; token Supabase berada di `localStorage`                                                                                                                                                                                      | Middleware response headers: `Content-Security-Policy` (default-src 'self'; connect-src supabase + wss), `X-Frame-Options: DENY` (kecuali preview Lovable), `Referrer-Policy`, `Permissions-Policy` (microphone/camera=self) |
| S12 | Medium       | Restore backup meng-upsert baris mentah dari file                                               | `src/routes/_authenticated/settings.tsx:188-198`                                                                                          | File manipulatif bisa menimpa kolom apa pun (termasuk `user_id`, `deleted_at`) pada baris yang lolos RLS, termasuk baris proyek shared                                                                                                                         | Validasi zod per tabel, paksa `user_id = me`, buang kolom sistem                                                                                                                                                             |
| S13 | Low          | `serverFn` Google tanpa validasi zod                                                            | `src/lib/googleCalendar.functions.ts:29,45` (`inputValidator((data) => data)`)                                                            | Input tak tervalidasi; error Google mentah dikembalikan ke klien (`:53`)                                                                                                                                                                                       | `z.object({ taskId: z.string().uuid() })`, sanitasi error                                                                                                                                                                    |
| S14 | Low          | `profiles` FOR ALL: user bisa set `telegram_chat_id` arbitrer                                   | `0000:11`                                                                                                                                 | Bot bisa dipakai untuk spam chat orang lain via reminder                                                                                                                                                                                                       | Kolom telegram hanya boleh ditulis oleh service role (flow link)                                                                                                                                                             |
| S15 | Low          | Policy canvas: member dapat "mengklaim" node orang lain                                         | `0004:154` WITH CHECK `user_id = auth.uid()` + USING board-level                                                                          | Update node milik orang lain dengan set `user_id` ke dirinya                                                                                                                                                                                                   | USING juga `user_id = (select auth.uid())` untuk UPDATE/DELETE                                                                                                                                                               |
| S16 | Low          | Purge sampah dijalankan dari klien saat buka tab                                                | `src/routes/_authenticated/archive.tsx:56-64`                                                                                             | Retensi tidak berjalan jika user tidak membuka halaman; hard-delete dari browser                                                                                                                                                                               | Pindahkan ke `pg_cron`                                                                                                                                                                                                       |

**Yang sudah baik:** CSRF middleware untuk serverFn (`src/start.ts:24-26`). `search_path` di-set pada semua fungsi `SECURITY DEFINER`. `app_config` dan `app_user_connections` tanpa policy (hanya service_role). Token Google dienkripsi AES-GCM dengan IV acak (`src/server/connectionKeyCrypto.server.ts`). `log_activity` membuang field sensitif. Rendering markdown/blok tidak memakai `dangerouslySetInnerHTML`, dan link hanya `https?://` (`BlockEditor.tsx:59`), sehingga **tidak ditemukan XSS sink**. Tidak ada secret server dengan prefix `VITE_`.

---

## 4. Tech Stack — Keep / Replace / Upgrade

| Komponen                                                                                                                                                                                | Status               | Rekomendasi                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Start 1.168 + Router 1.170 (versi dipin)                                                                                                                                       | Keep                 | Manfaatkan `beforeLoad`, `loader`, `ssr: false` per route; upgrade terkontrol                                                                                                                                    |
| React 19, Vite 8 (rolldown override `1.2.1`)                                                                                                                                            | Keep                 | Override rolldown adalah lock-in Lovable; dokumentasikan alasannya                                                                                                                                               |
| TanStack Query 5                                                                                                                                                                        | Keep                 | Tambahkan default options, `queryOptions()` factory, devtools di dev                                                                                                                                             |
| Supabase JS 2                                                                                                                                                                           | Keep                 | Realtime private channel, generated types sudah ada                                                                                                                                                              |
| `@lovable.dev/vite-tanstack-config`                                                                                                                                                     | Evaluasi             | Membungkus nitro dengan **default target Cloudflare** (`vite.config.ts:3-4`). Untuk Vercel: set preset nitro `vercel` (lewat opsi config atau `NITRO_PRESET=vercel`) dan uji SSR + server routes `/api/public/*` |
| `nitro 3.0.260603-beta`                                                                                                                                                                 | Risiko               | Versi beta dipin; pantau rilis stabil                                                                                                                                                                            |
| Lovable AI Gateway (`ai.server.ts:5`, model `openai/gpt-6-astra` `:39`), Telegram via connector gateway (`webhook.ts:3`), App User Connector Google (`appUserConnector.ts`)             | Lock-in              | Butuh `LOVABLE_API_KEY` di Vercel. Abstraksikan provider (env `AI_BASE_URL`, `AI_MODEL`) agar bisa pindah ke OpenAI/Anthropic langsung; Telegram bisa langsung ke `api.telegram.org`                             |
| Drizzle                                                                                                                                                                                 | Hanya runner migrasi | `drizzle/schema.ts` kosong ("auto-generated, intentionally left blank"). Tidak ada sumber tipe dari Drizzle. Pilih satu: Supabase CLI migrations, atau Drizzle schema sungguhan (introspect)                     |
| `recharts`, `embla-carousel-react`, `input-otp`, `vaul`, `react-resizable-panels`, `react-hook-form`, `@hookform/resolvers`, `react-day-picker`, `@dnd-kit/sortable`, ±20 `@radix-ui/*` | Tidak dipakai        | Hapus (beserta 36 file `components/ui/*` yang tidak dipakai)                                                                                                                                                     |
| `vite-tsconfig-paths` di dependencies                                                                                                                                                   | Duplikat             | Config Lovable sudah memasang tsConfigPaths; pindahkan/hapus                                                                                                                                                     |
| `zod 3.25`                                                                                                                                                                              | Keep                 | Siap migrasi ke `zod/v4`                                                                                                                                                                                         |
| `yjs` tanpa provider                                                                                                                                                                    | Ganti pola           | Pakai `y-protocols/awareness` + persistence yang benar, atau Supabase Realtime + `Y.Text` per blok                                                                                                               |
| Package manager                                                                                                                                                                         | Konsistensi          | Ada `bun.lock` + `bunfig.toml`, tetapi task meminta `npm run`. Tetapkan satu (bun) di README/CI                                                                                                                  |
| `semantic_documents` + pgvector                                                                                                                                                         | Belum dipakai        | Tabel/fungsi ada (`0004:197-224`) tanpa kode. Implementasikan atau tunda migrasinya                                                                                                                              |

---

## 5. Arsitektur, State Management, dan Kualitas Kode

### 5.1 Arsitektur saat ini

- Client-heavy SPA di atas TanStack Start. Akses DB langsung dari browser via Supabase + RLS. Server functions dipakai untuk AI/otomasi/Google, server routes untuk webhook/cron.
- Satu cache global per tabel (`qk.tasks` dll.) dan semua view menurunkan data di klien. Ini sederhana, tetapi **skalanya O(total data) per view** dan menjadi sumber masalah performa (§2).

### 5.2 Temuan

| Severity | Temuan                                                                                                                                              | Bukti                                                                                                                                                                                                        | Fix                                                                                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | **God-file `data.ts`** mencampur query, CRUD generik (`as any` `:129-130`), logika dependency/cycle, recurrence, pemicu otomasi, dan helper tanggal | `src/lib/data.ts:1-342`                                                                                                                                                                                      | Pecah ke `features/<x>/api/{keys,queries,mutations}.ts`; logika murni (cycle, shift, recurrence) ke `features/tasks/lib/*.ts` + unit test                                                   |
| High     | Pelanggaran aturan arsitektur AGENTS.md: Inbox menulis tasks/notes/projects langsung                                                                | `src/routes/_authenticated/inbox.tsx:69-105` (bypass `useTaskActions`, otomasi tidak jalan, cache tidak di-invalidate); Inbox & Settings memakai `useState+useEffect` (`inbox.tsx:36-54`, `settings.tsx:53`) | Pakai hook data terpusat; batch create via RPC                                                                                                                                              |
| Medium   | Penanganan error tidak konsisten: banyak `await supabase…` yang mengabaikan `error`                                                                 | `inbox.tsx:42-49`, `_authenticated.tsx:72`, `archive.tsx:59-63`, `reminders.ts:69`, `automations.functions.ts:127-128`                                                                                       | Helper `unwrap()` yang melempar error; `useMutation` `onError` global; error boundary per route                                                                                             |
| Medium   | Soft delete tidak konsisten: tasks milik proyek yang di-soft-delete tetap tampil; milestones tanpa `deleted_at`; projects di Inbox tanpa filter     | `data.ts:47,77`; `inbox.tsx:48`; `ai.functions.ts:13`                                                                                                                                                        | Filter join (`projects!inner(deleted_at)`) atau view `active_tasks`                                                                                                                         |
| Medium   | Readability: ±115 baris > 200 karakter (one-liner padat)                                                                                            | `canvas.tsx:29-72`, `settings.tsx:161-170`, `googleCalendar.functions.ts`, `use-note-collaboration.ts`                                                                                                       | Prettier sudah ada (`.prettierrc`); jalankan `bun run format` dan tegakkan di CI                                                                                                            |
| Medium   | Logika bisnis kritikal di klien (auto-shift dependents, recurrence, blocked check)                                                                  | `data.ts:206-283`                                                                                                                                                                                            | Pindahkan ke RPC/trigger DB agar atomik dan berlaku juga untuk Telegram/AI/otomasi                                                                                                          |
| Medium   | Test coverage nyaris nol: 1 test routing                                                                                                            | `src/test/app-routing.test.tsx`                                                                                                                                                                              | Unit: `blocks.ts` (`loadBlocks`, `linksOf`, `runQuery`), `nlp.ts` (`parseTaskText`), `triggerMatches/conditionMatches`, cycle detection; integration RLS (pgTAP); e2e Playwright alur utama |
| Low      | Komponen didefinisikan di dalam render (remount)                                                                                                    | `TaskViews.tsx:88`, `TaskDialogProvider.tsx:286,297`, `_authenticated.tsx:129` (`NavLinks`)                                                                                                                  | Pindahkan ke top-level                                                                                                                                                                      |
| Low      | `getUid()` melempar dengan pesan UI; `confirm()` native                                                                                             | `data.ts:28-33`, `TaskDialogProvider.tsx:150`                                                                                                                                                                | AlertDialog shadcn                                                                                                                                                                          |
| Positif  | TS `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (`tsconfig.json`)                                                           | —                                                                                                                                                                                                            | Pertahankan                                                                                                                                                                                 |

### 5.3 State management (rekomendasi)

- **Server state:** TanStack Query dengan `queryOptions` factory per fitur, key ber-scope (`["tasks", userId, filters]`), mutasi via `useMutation` + optimistic, dan invalidasi oleh Supabase Realtime `postgres_changes` (terfilter) alih-alih refetch on focus.
- **Session:** router context (`beforeLoad`), bukan `useState` lokal di layout.
- **UI state:** context kecil yang di-memo (sudah benar untuk `TaskDialogProvider` dan `PreferencesProvider`). Store terpisah (zustand) hanya bila perlu, misalnya untuk state editor.
- **Derived data mahal** (index blok, backlinks, graph): pindahkan ke DB (kolom `links`/`refs`) atau worker.

### 5.4 Struktur direktori yang diusulkan (feature-based)

```
src/
  app/                  # router.tsx, start.ts, server.ts, providers (QueryClient, Preferences)
  routes/               # file-based routes TIPIS: hanya compose komponen fitur + loader
  features/
    tasks/   { api/(keys,queries,mutations).ts, components/, lib/(deps,recurrence).ts, tests/ }
    notes/   { api/, components/(BlockEditor,InlineText,QueryView), lib/blocks.ts, collab/ }
    projects/ calendar/ timeline/ graph/ canvas/ inbox/ automations/ reports/ templates/ archive/ settings/
  server/
    functions/          # *.functions.ts (createServerFn) per domain
    integrations/       # supabase admin, telegram, google, ai provider
    security/           # ssrf guard, rate limit, cron auth
  shared/
    ui/                 # hanya komponen shadcn yang dipakai
    components/         # PageContainer, PageHeader, LoadMore, TagInput
    lib/ hooks/
  integrations/supabase # generated (jangan diedit)
```

---

## 6. Database & ERD

### 6.1 ERD (diturunkan dari migrasi 0000–0007; `drizzle/schema.ts` kosong)

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "id (tanpa FK)"
  AUTH_USERS ||--o{ PROJECTS : "user_id (tanpa FK)"
  PROJECTS ||--o{ PROJECTS : "parent_id SET NULL"
  PROJECTS ||--o{ PROJECT_MEMBERS : "CASCADE"
  PROJECTS ||--o{ PROJECT_INVITES : "CASCADE"
  PROJECTS ||--o{ MILESTONES : "CASCADE"
  PROJECTS ||--o{ TASKS : "project_id SET NULL"
  PROJECTS ||--o{ NOTES : "project_id SET NULL"
  PROJECTS ||--o{ CANVAS_BOARDS : "CASCADE"
  PROJECTS ||--o{ TIME_ENTRIES : "SET NULL"
  MILESTONES ||--o{ TASKS : "milestone_id SET NULL"
  TASKS ||--o{ TASKS : "parent_id CASCADE"
  TASKS ||--o{ TASK_COMMENTS : "CASCADE"
  TASKS ||--o{ TASK_DEPENDENCIES : "blocker_id CASCADE"
  TASKS ||--o{ TASK_DEPENDENCIES : "blocked_id CASCADE"
  TASKS ||--o{ TIME_ENTRIES : "CASCADE"
  NOTES ||--o{ NOTE_VERSIONS : "CASCADE"
  AUTOMATIONS ||--o{ AUTOMATION_RUNS : "CASCADE"
  CANVAS_BOARDS ||--o{ CANVAS_NODES : "CASCADE"
  CANVAS_BOARDS ||--o{ CANVAS_EDGES : "CASCADE"
  CANVAS_NODES ||--o{ CANVAS_EDGES : "source/target CASCADE"
  AUTH_USERS ||--o{ TEMPLATES : "CASCADE (satu-satunya FK ke auth.users)"
  AUTH_USERS ||--o{ INBOX_ITEMS : "user_id"
  AUTH_USERS ||--o{ AUTOMATIONS : "user_id"
  AUTH_USERS ||--o{ ACTIVITY_LOGS : "user_id"
  AUTH_USERS ||--o| CALENDAR_CONNECTIONS : "user_id UNIQUE"
  AUTH_USERS ||--o{ APP_USER_CONNECTIONS : "(user_id, connector_id) UNIQUE"
  AUTH_USERS ||--o{ SEMANTIC_DOCUMENTS : "user_id"

  PROFILES { uuid id PK; text display_name; text telegram_chat_id; text telegram_username }
  PROJECTS { uuid id PK; uuid user_id; text name; text para_type; text color; text status; date start_date; date due_date; date launch_date; uuid parent_id; float position; timestamptz deleted_at }
  TASKS { uuid id PK; uuid user_id; uuid project_id; uuid parent_id; uuid milestone_id; text title; text status; text priority; timestamptz start_date; timestamptz due_date; text_arr tags; uuid assignee_id; text recurrence; int estimate_minutes; timestamptz time_block_end; text google_event_id; bool reminded; timestamptz deleted_at; timestamptz archived_at }
  NOTES { uuid id PK; uuid user_id; uuid project_id; text title; text content; jsonb blocks; jsonb properties; text_arr tags; text status; bool pinned; timestamptz deleted_at; timestamptz archived_at }
  MILESTONES { uuid id PK; uuid project_id; text title; date due_date; bool done }
  PROJECT_MEMBERS { uuid id PK; uuid project_id; uuid user_id; text role }
  PROJECT_INVITES { uuid id PK; uuid project_id; text email; uuid invited_by }
  TASK_DEPENDENCIES { uuid id PK; uuid blocker_id; uuid blocked_id; uuid user_id }
  TASK_COMMENTS { uuid id PK; uuid task_id; uuid user_id; text content }
  AUTOMATIONS { uuid id PK; uuid user_id; text name; bool enabled; jsonb trigger; jsonb conditions; jsonb actions; int run_count }
  AUTOMATION_RUNS { uuid id PK; uuid automation_id; uuid task_id; bool ok; text detail }
  NOTE_VERSIONS { uuid id PK; uuid note_id; int version_number; jsonb blocks; text content }
  TIME_ENTRIES { uuid id PK; uuid task_id; uuid project_id; text mode; timestamptz started_at; int duration_seconds }
  INBOX_ITEMS { uuid id PK; uuid user_id; text content; text source; text status; text ai_summary }
  ACTIVITY_LOGS { uuid id PK; uuid user_id; text action; text entity_type; uuid entity_id; jsonb metadata; text source }
  CANVAS_BOARDS { uuid id PK; uuid user_id; uuid project_id; jsonb viewport }
  CANVAS_NODES { uuid id PK; uuid board_id; text node_type; text ref_type; uuid ref_id; float x; float y }
  CANVAS_EDGES { uuid id PK; uuid board_id; uuid source_id; uuid target_id }
  TEMPLATES { uuid id PK; uuid user_id; text kind; jsonb payload }
  APP_CONFIG { text key PK; text value }
  APP_USER_CONNECTIONS { uuid id PK; uuid user_id; text connector_id; text connection_key_ciphertext }
  CALENDAR_CONNECTIONS { uuid id PK; uuid user_id; text calendar_id }
  SEMANTIC_DOCUMENTS { uuid id PK; uuid user_id; text entity_type; uuid entity_id; vector embedding }
```

### 6.2 Temuan skema

| Severity | Temuan                                                                                                                                             | Bukti                                                                                                                        | Fix                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| High     | **Trigger audit duplikat** pada 15 tabel                                                                                                           | `0004:226-232` (`<t>_audit`) vs `0006:12-13` (`audit_<t>_changes`)                                                           | Drop `<t>_audit`; cek `select tgname from pg_trigger where tgname like '%audit%'`                               |
| High     | Hampir tidak ada index untuk pola akses utama                                                                                                      | Index hanya ada di `activity_logs`, `note_versions`, `time_entries`, `semantic_documents`                                    | Lihat §6.3                                                                                                      |
| Medium   | `user_id`, `assignee_id`, `invited_by`, `automation_runs.task_id`, `profiles.id` tanpa FK                                                          | `0000`, `0002`, `0003`                                                                                                       | FK ke `auth.users(id) ON DELETE CASCADE` (agar penghapusan akun tuntas, untuk GDPR); `assignee_id` → `SET NULL` |
| Medium   | Status/role/recurrence berupa `text` tanpa CHECK                                                                                                   | `projects.status`, `notes.status`, `project_members.role`, `tasks.recurrence`, `time_entries.mode`, `canvas_nodes.node_type` | CHECK constraint atau enum Postgres                                                                             |
| Medium   | `notes.content` duplikat dengan `blocks`; jsonb tanpa batas ukuran; `note_versions` menyimpan salinan penuh tanpa retensi                          | `0003:51-52`, `0004:68-100`                                                                                                  | `CHECK (pg_column_size(blocks) < 1MB)`, retensi versi (mis. 50 terakhir), kolom `links`/`refs` untuk backlinks  |
| Medium   | Soft delete dan cascade tidak sinkron: hard delete project memakai `SET NULL` pada tasks/notes; soft delete project tidak menyembunyikan tasks-nya | `0000:51,69`, `data.ts:151-154`                                                                                              | Trigger soft-delete cascade atau filter join                                                                    |
| Low      | `project_invites` UNIQUE (project_id, email) case-sensitive, sedangkan pencarian memakai `lower(email)`                                            | `0002:67,112`                                                                                                                | Unique index `lower(email)` atau kolom `citext`                                                                 |
| Low      | `tasks.reminded` + query cron tanpa index                                                                                                          | `reminders.ts:42-48`                                                                                                         | Index parsial (lihat bawah)                                                                                     |
| Low      | `profiles.telegram_chat_id` dicari tanpa index/unique                                                                                              | `webhook.ts:79-83`                                                                                                           | `UNIQUE (telegram_chat_id)`                                                                                     |

### 6.3 Migrasi index yang diusulkan

```sql
create index if not exists tasks_user_active_idx    on public.tasks (user_id, position, created_at) where deleted_at is null and archived_at is null;
create index if not exists tasks_project_idx        on public.tasks (project_id) where deleted_at is null;
create index if not exists tasks_parent_idx         on public.tasks (parent_id);
create index if not exists tasks_reminder_idx       on public.tasks (due_date) where status <> 'done' and reminded = false and due_date is not null;
create index if not exists notes_user_active_idx    on public.notes (user_id, pinned desc, updated_at desc) where deleted_at is null and archived_at is null;
create index if not exists notes_project_idx        on public.notes (project_id);
create index if not exists project_members_user_idx on public.project_members (user_id, project_id);
create index if not exists milestones_project_idx   on public.milestones (project_id);
create index if not exists deps_blocked_idx         on public.task_dependencies (blocked_id);
create index if not exists comments_task_idx        on public.task_comments (task_id, created_at);
create index if not exists inbox_user_status_idx    on public.inbox_items (user_id, status, created_at desc);
create index if not exists automations_user_idx     on public.automations (user_id) where enabled;
create index if not exists runs_user_created_idx    on public.automation_runs (user_id, created_at desc);
create index if not exists canvas_nodes_board_idx   on public.canvas_nodes (board_id);
create index if not exists canvas_edges_board_idx   on public.canvas_edges (board_id);
create index if not exists projects_user_idx        on public.projects (user_id) where deleted_at is null;
create unique index if not exists profiles_tg_chat_uq on public.profiles (telegram_chat_id) where telegram_chat_id is not null;
```

Ditambah: ganti `auth.uid()` menjadi `(select auth.uid())` di semua policy (initPlan sekali per query), dan gabungkan policy owner+member menjadi satu policy per perintah.

---

## 7. UI/UX, Aksesibilitas, Responsif

| Severity | Temuan                                                                                                                    | Bukti                                                 | Fix                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| High     | Item tugas yang bisa diklik berupa `<li onClick>` / `<div onClick>` tanpa `role`, `tabIndex`, atau handler keyboard       | `TaskItem.tsx:66-69,90`                               | Gunakan `<button>` atau link; tambahkan focus ring        |
| Medium   | DnD kanban/kalender tanpa `KeyboardSensor`                                                                                | `calendar.tsx:70-73`, `Kanban.tsx`                    | Tambahkan `KeyboardSensor` + aksi alternatif "Pindah ke…" |
| Medium   | Tidak ada skeleton: list tampil kosong ("Tidak ada tugas") sebelum data datang                                            | `TaskViews.tsx:57` (default `[]`)                     | Gunakan `isPending` → skeleton                            |
| Medium   | Flash tema (FOUC)                                                                                                         | `preferences.tsx:46-55`                               | Inline script di `<head>`                                 |
| Medium   | `confirm()` native untuk aksi destruktif                                                                                  | `TaskDialogProvider.tsx:150`, `notes.$noteId.tsx:129` | AlertDialog yang aksesibel                                |
| Low      | Halaman 404/error berbahasa Inggris di aplikasi berbahasa Indonesia                                                       | `__root.tsx:18-76`                                    | Pakai i18n                                                |
| Low      | Shortcut `Q` global tanpa halaman bantuan shortcut                                                                        | `_authenticated.tsx:99-111`                           | Dialog "?" berisi daftar shortcut                         |
| Positif  | `aria-label` pada tombol ikon (20 file); bottom nav mobile + safe-area; `PageContainer` konsisten; `html lang` diperbarui | `_authenticated.tsx:186`, `PageContainer.tsx`         | —                                                         |

---

## 8. PWA / Offline

- **Ada:** `manifest.webmanifest`, ikon 192/512, SW sederhana (`public/sw.js`).
- **Gap:** tidak ada offline data (tidak memakai `persistQueryClient`), SW tidak cache JS/CSS, fallback `/` berisi HTML yang menunjuk aset lama (§2.12), tidak ada prompt update, tidak ada `share_target` (cocok untuk "quick capture" dari aplikasi lain), tidak ada Web Push (izin Notification diminta di `settings.tsx:67-75` tetapi **tidak pernah dipakai** untuk menampilkan notifikasi).
- **Fix:** Workbox/`vite-plugin-pwa`; `@tanstack/query-sync-storage-persister` atau IndexedDB persister + antrean mutasi offline; `share_target` ke `/inbox`; Web Push untuk reminder (alternatif Telegram).

## 9. Observability

- Hanya `window.__lovableEvents` (`src/lib/lovable-error-reporting.ts`), yang **tidak aktif di luar Lovable**, dan `console.error` di server (`src/server.ts`, `src/start.ts`).
- `automation_runs` dan `activity_logs` berguna sebagai audit, tetapi bukan monitoring.
- **Rekomendasi:** Sentry (client + server/serverFn, release tagging), `web-vitals` → endpoint/analytics (Vercel Speed Insights), structured logging di server routes (request id), alert untuk kegagalan cron/webhook, dan dashboard Supabase (slow queries via `pg_stat_statements`).

## 10. SEO

- Aplikasi bersifat privat. `robots.txt` mengizinkan semua bot (`public/robots.txt`), dan route terautentikasi hanya merender spinner untuk crawler.
- **Rekomendasi:** `Disallow: /` kecuali `/login` (atau landing page). Tambahkan meta `robots: noindex` pada `_authenticated`, `og:image`, dan canonical. Jika butuh akuisisi, buat landing page statis yang dapat diprerender.

## 11. i18n

- `PreferencesProvider` hanya punya ±25 kunci (navigasi) dalam id/en (`src/lib/preferences.tsx:6-23`). Sisa UI di-hardcode dalam Bahasa Indonesia, dan locale `date-fns` dipaku ke `id` di 16 file. Prompt AI juga dalam Bahasa Indonesia.
- **Rekomendasi:** pakai `i18next`/`paraglide` (tree-shakable), helper `formatDate(locale)`, ekstraksi string bertahap per fitur. Prompt AI menyesuaikan locale user.

---

## 12. Katalog Fitur

| Fitur                                   | Fungsi                                                                                                                   | Implementasi                                                                                  | Kematangan / Gap                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Auth email/password                     | Login, signup, konfirmasi email                                                                                          | `src/routes/login.tsx:25-43`, gating `_authenticated.tsx`                                     | Dasar. Tidak ada reset password UI, OAuth (Google), magic link, maupun 2FA              |
| Idle auto sign-out                      | Logout setelah N menit tidak aktif, lintas tab                                                                           | `src/hooks/use-idle-logout.ts`, setting di `settings.tsx:209`                                 | Matang                                                                                  |
| Dashboard "Hari Ini"                    | Tugas terlambat, hari ini, minggu ini, progres, milestone, launch, jumlah inbox                                          | `routes/_authenticated/index.tsx`                                                             | Baik; perhitungan tanpa memo                                                            |
| Inbox + AI                              | Brain-dump → AI memecah jadi tugas/catatan/proyek; parafrase; arsip                                                      | `inbox.tsx`, `ai.functions.ts:7-28`, `ai.server.ts`                                           | Berfungsi; bypass data layer (tanpa otomasi/cache), tanpa review sebelum insert         |
| Quick Capture                           | Teks, rekam suara (transkripsi), foto (OCR) → Inbox; draft tersimpan                                                     | `components/QuickCapture.tsx`, `ai.functions.ts:43-72`                                        | Baik; tanpa batas ukuran gambar                                                         |
| Quick Task (NLP)                        | Parser bahasa sehari-hari (tanggal, jam, tag, orang, prioritas)                                                          | `lib/nlp.ts`, `components/tasks/QuickTask.tsx`                                                | Baik; belum ada unit test                                                               |
| Tasks                                   | List/Kanban/Upcoming, filter, subtugas, prioritas, tag, assignee, estimasi, time-block                                   | `routes/_authenticated/tasks.tsx`, `components/tasks/*`                                       | Matang; performa list (§2.5)                                                            |
| Dependencies                            | Blocker/blocked, deteksi siklus, auto-geser dependents, notifikasi unblocked                                             | `data.ts:104-110,211-233,287-314`, `automations.functions.ts:134-152`                         | Logika di klien (tidak atomik)                                                          |
| Recurrence                              | Harian/mingguan/bulanan: membuat instance berikutnya saat selesai                                                        | `data.ts:261-282`                                                                             | Dasar; belum ada RRULE/hari kerja                                                       |
| Komentar tugas                          | Komentar & log progres per tugas                                                                                         | `TaskDialogProvider.tsx:392-436`                                                              | Dasar; tanpa mention/realtime/edit                                                      |
| Pomodoro / Focus Timer                  | Timer per tugas, menyimpan `time_entries`                                                                                | `components/tasks/FocusTimer.tsx`                                                             | Dasar; timer hilang bila dialog ditutup                                                 |
| Laporan Fokus                           | Ringkasan fokus mingguan per proyek/tugas/hari                                                                           | `routes/_authenticated/reports.tsx`                                                           | Dasar; tanpa grafik (recharts tidak dipakai)                                            |
| Kalender                                | Hari/minggu/bulan/tahun, drag move/resize, marker milestone & launch                                                     | `routes/_authenticated/calendar.tsx`                                                          | Baik; `byDay` tidak efisien                                                             |
| Timeline (Gantt)                        | Bar tugas + milestone, drag/resize via pointer events                                                                    | `components/Timeline.tsx`, `timeline.tsx`                                                     | Baik; tanpa garis dependency                                                            |
| Google Calendar                         | Koneksi OAuth per user (Lovable connector), sync tugas → event (manual)                                                  | `lib/googleCalendar.functions.ts`, `settings.tsx:160-170`, `oauth/google-calendar/return.tsx` | Satu arah dan manual per tugas; `calendar_connections` tidak dipakai                    |
| Proyek (PARA)                           | List, detail, warna, status, tanggal, sub-proyek                                                                         | `projects.index.tsx`, `projects.$projectId.tsx`, `ProjectDialog.tsx`                          | Baik                                                                                    |
| Milestones                              | Per proyek, tenggat, selesai                                                                                             | `projects.$projectId.tsx:181-230`, `data.ts:319`                                              | Dasar                                                                                   |
| Tim & undangan                          | Undang via email, auto-join saat login, daftar anggota                                                                   | `projects.$projectId.tsx:233-280`, RPC `accept_project_invites`, `list_project_people`        | Ada celah RLS (S4, S5, S10); tanpa role granular                                        |
| Catatan (board)                         | Kanban/grid catatan per status, tag, pencarian                                                                           | `components/notes/NotesBoard.tsx`, `notes.index.tsx`                                          | Baik; pencarian di klien                                                                |
| Block editor                            | Blok bertipe, slash menu, markdown shortcut, drag urut                                                                   | `components/notes/BlockEditor.tsx`, `lib/blocks.ts`                                           | Fitur kaya; performa (§2.6)                                                             |
| Wikilinks, block refs, embed, backlinks | `[[judul]]`, `((blockId))`, embed, backlinks linked/unlinked                                                             | `blocks.ts:79-119`, `notes.$noteId.tsx:88-112`                                                | Berfungsi; dihitung ulang dari semua catatan                                            |
| Query blok (Dataview-like)              | `TABLE … FROM #tag WHERE … SORT … LIMIT` atas notes/tasks                                                                | `blocks.ts:153-210`, `BlockEditor.tsx:67-100`                                                 | Unik; parser regex, perlu test                                                          |
| Riwayat versi catatan                   | Snapshot tiap 10 menit, restore                                                                                          | `0005`, `notes.$noteId.tsx:235`                                                               | Baik; tanpa retensi                                                                     |
| Kolaborasi realtime                     | Yjs + presence + kursor                                                                                                  | `hooks/use-note-collaboration.ts`                                                             | Prototipe: kanal publik (S3), seluruh dokumen per update                                |
| AI notulen                              | Merangkum catatan menjadi notulen meeting                                                                                | `ai.functions.ts:30-41`, `notes.$noteId.tsx:114-127`                                          | Menimpa isi catatan (tanpa preview/undo selain versi)                                   |
| Knowledge Graph                         | Force-directed graph catatan, filter tag, zoom/pan                                                                       | `routes/_authenticated/graph.tsx`                                                             | Baik; re-render per tick                                                                |
| Kanvas                                  | Kartu teks, koneksi, drag                                                                                                | `routes/_authenticated/canvas.tsx`                                                            | Awal (roadmap belum selesai): tanpa media/zoom/pencarian, ukuran canvas tetap 2400×1600 |
| Otomasi                                 | Trigger (dibuat/status/prioritas/assignee/due) → aksi (set field, tag, geser due, komentar, Telegram, webhook) + log run | `routes/_authenticated/automations.tsx`, `lib/automations.functions.ts`                       | Baik; SSRF (S6), tanpa trigger jadwal                                                   |
| Template                                | Simpan/pakai template tugas & catatan                                                                                    | `routes/_authenticated/templates.tsx`                                                         | Dasar                                                                                   |
| Arsip & Sampah                          | Arsip, soft delete, restore, purge 30 hari                                                                               | `routes/_authenticated/archive.tsx`                                                           | Purge dijalankan dari klien                                                             |
| Activity log                            | Audit metadata (auth + CRUD)                                                                                             | `activity.tsx`, `lib/activity.ts`, trigger `audit_row_change`                                 | Baris dobel (trigger duplikat); limit 500 tanpa paging                                  |
| Settings                                | Tema, bahasa, Telegram, notifikasi, Google Calendar, backup/restore JSON, idle                                           | `routes/_authenticated/settings.tsx`                                                          | Notifikasi tidak pernah dikirim; restore tanpa validasi                                 |
| Telegram bot                            | `/start`, `/link`, pesan → Inbox                                                                                         | `routes/api/public/telegram/webhook.ts`                                                       | Belum terhubung (roadmap); celah S1/S2                                                  |
| Reminder deadline                       | Cron → Telegram 24 jam sebelum tenggat                                                                                   | `routes/api/public/hooks/reminders.ts`                                                        | N+1; zona waktu di-hardcode WIB                                                         |
| Command palette                         | Ctrl/Cmd+K: cari tugas, proyek, catatan; buat tugas                                                                      | `components/CommandMenu.tsx`                                                                  | Penyebab fetch global (§2.2); maks 200 item                                             |
| PWA                                     | Installable, SW minimal                                                                                                  | `public/manifest.webmanifest`, `public/sw.js`                                                 | Offline praktis tidak berfungsi                                                         |
| i18n & tema                             | id/en (navigasi saja), light/dark/system                                                                                 | `lib/preferences.tsx`                                                                         | Parsial                                                                                 |
| Semantic search                         | Tabel `semantic_documents` + pgvector + RPC                                                                              | `0004:197-224`                                                                                | **Belum diimplementasikan** di kode                                                     |

---

## 13. Rekomendasi Fitur Baru

1. **Pencarian global full-text + semantic**: Postgres FTS (`tsvector` di notes/tasks) untuk Ctrl+K server-side, lalu embeddings (tabel sudah ada) untuk "tanya ke second brain" (RAG atas catatan).
2. **Offline-first nyata**: persist cache + antrean mutasi + sinkronisasi saat online.
3. **Web Push notifications** untuk reminder dan unblock (melengkapi Telegram; izin sudah diminta).
4. **PWA Share Target dan email-to-inbox**: tangkap link/teks dari aplikasi lain atau alamat email unik.
5. **Lampiran file/gambar** di tugas dan catatan (Supabase Storage + RLS), termasuk OCR yang disimpan.
6. **Daily/Weekly review terpandu** (GTD): kosongkan inbox, review proyek stagnan, rencana besok.
7. **Recurrence lanjutan (RRULE)**: hari kerja, "setiap Senin & Kamis", "tanggal 1 tiap bulan", dan recurrence berbasis tanggal selesai.
8. **Saved views/filter** untuk tasks/notes dan dashboard yang dapat dikustomisasi.
9. **Import/Export**: Markdown (Obsidian-compatible, termasuk `[[links]]`), Todoist/Notion CSV, iCal feed tugas.
10. **Login Google/magic link + 2FA**, ditambah halaman reset password.
11. **Sharing read-only publik** untuk catatan/proyek (link bertoken, revocable).
12. **Otomasi terjadwal** (cron per rule: "setiap Senin buat tugas X", "jika lewat tenggat → eskalasi") dan trigger untuk catatan.
13. **Sinkronisasi Google Calendar dua arah** (import event sebagai time-block, update otomatis saat tugas berubah).
14. **Grafik laporan** (tren fokus, burndown proyek, throughput) dan habit tracker.
15. **Keyboard-first UX**: daftar shortcut, navigasi j/k di list, aksi cepat dari command palette (ubah status/prioritas).

---

## Lampiran A — Cara verifikasi performa setelah perbaikan

1. `bun install && bun run build` → catat ukuran `.output/public/assets/*` (entry, vendor, per-route).
2. Chrome DevTools > Network: hitung request Supabase saat navigasi Today → Settings → Tasks dan saat alt-tab. Target: 0 refetch dalam `staleTime`.
3. React Profiler: ketik 20 karakter di catatan berisi ±100 blok. Target < 8 ms per commit, tanpa render `InlineText` di blok lain.
4. Supabase: `explain analyze` query list tasks dengan role `authenticated` (set `request.jwt.claims`) sebelum/sesudah index dan policy refactor.
5. Lighthouse (mobile) halaman `/` setelah login: LCP, TBT, INP.

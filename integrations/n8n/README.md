# Template workflow n8n — Second Brain

Workflow [n8n](https://n8n.io) siap-impor untuk Second Brain: bot Telegram (teks, `/perintah`, tombol inline, **OCR** foto/dokumen, **transkripsi** voice note), pengingat & digest terjadwal, error alert, backup mingguan, penerima webhook Automations, helper sinkronisasi Google Calendar, dan email → Inbox.

**Prinsip:** n8n hanya _relay tipis_. Semua logika domain (NLP tanggal `src/lib/nlp.ts`, AI capture/ringkasan `src/lib/ai.server.ts`, aturan task/note/inbox, soft delete, RLS-aware queries) tetap di web app, di belakang endpoint `/api/public/n8n/*` yang dilindungi header `x-api-key` = `N8N_API_KEY`. n8n hanya menambah hal yang memang berbasis file/jadwal: unduh file Telegram, OCR/transkripsi, trigger cron, Google Drive, IMAP.

> [!WARNING]
> Sebagian besar endpoint `/api/public/n8n/*` **belum ada** di app. Lihat [Endpoint backend yang wajib dibangun](#endpoint-backend-yang-wajib-dibangun). Endpoint yang sudah ada hanya `POST /api/public/telegram/webhook` dan `POST /api/public/hooks/reminders`.

## Daftar workflow

| File                                      | Fungsi                                                                                                                                                                                                            | Env (n8n)                                                                                                                     | Credentials                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `01-second-brain-telegram-bot.json`       | Bot utama: teks & `/today /inbox /task /note /done /search /sum …`, tombol inline, foto/gambar/PDF → OCR (OpenAI vision), voice/audio → transkripsi → capture                                                     | `SECOND_BRAIN_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `OPENAI_VISION_MODEL`\*, `OPENAI_TRANSCRIBE_MODEL`\*   | Telegram API, Header Auth `x-api-key`, OpenAI API |
| `02-second-brain-schedules.json`          | Pengingat jatuh tempo (15 mnt), digest pagi 07:00, overdue 12:30 (Sen–Jum), digest malam 20:30, weekly review Minggu 18:00, maintenance 03:00 (recurring + purge trash). Node legacy `hooks/reminders` (disabled) | `SECOND_BRAIN_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `REMINDER_LEAD_MINUTES`\*, `SECOND_BRAIN_CRON_TOKEN`\* | Header Auth                                       |
| `03-second-brain-error-handler.json`      | Alert Telegram ke admin saat workflow lain gagal (+ log ke app, disabled)                                                                                                                                         | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`                                                                                | (Header Auth jika log diaktifkan)                 |
| `04-second-brain-setup-commands.json`     | Jalankan manual sekali: `setMyCommands` (id + default), `getMe`, `getWebhookInfo`; `setWebhook → app` & `deleteWebhook` (disabled)                                                                                | `TELEGRAM_BOT_TOKEN`, `SECOND_BRAIN_URL`, `TELEGRAM_WEBHOOK_SECRET`                                                           | —                                                 |
| `05-second-brain-backup.json`             | Minggu 02:00 → `GET /n8n/backup` → Google Drive + retensi (hapus > N hari); email (disabled)                                                                                                                      | `SECOND_BRAIN_URL`, `BACKUP_RETENTION_DAYS`\*, `BACKUP_EMAIL_FROM`\*, `BACKUP_EMAIL_TO`\*                                     | Header Auth, Google Drive OAuth2 (SMTP)           |
| `06-second-brain-automation-webhook.json` | Target aksi **Kirim webhook** di halaman Automations → Telegram admin / Google Sheets / Discord-Slack                                                                                                             | `AUTOMATION_WEBHOOK_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `DISCORD_WEBHOOK_URL`\*, `SECOND_BRAIN_URL`       | (Google Sheets OAuth2)                            |
| `07-second-brain-calendar-sync.json`      | Tiap 30 mnt `POST /n8n/calendar/sync` (app → Google, per-user connector); opsional Google → app (event `#task` → tugas)                                                                                           | `SECOND_BRAIN_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `SECOND_BRAIN_OWNER_EMAIL`\*                              | Header Auth, (Google Calendar OAuth2)             |
| `08-second-brain-email-to-inbox.json`     | Email (IMAP, pengirim di allow-list) → Inbox / tugas (`task: …`) / catatan (`note: …`), ringkasan AI untuk email panjang                                                                                          | `SECOND_BRAIN_URL`, `EMAIL_ALLOWED_SENDERS`                                                                                   | IMAP, Header Auth                                 |

\* opsional. Nama node berbahasa Indonesia, sticky note menjelaskan alur di dalam tiap workflow.

## Variabel lingkungan n8n

| Variabel                                | Contoh                             | Keterangan                                              |
| --------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE`          | `false`                            | **Wajib** agar `$env.*` bisa dibaca di node             |
| `GENERIC_TIMEZONE`                      | `Asia/Jakarta`                     | Zona waktu jadwal (workflow juga set `timezone`)        |
| `SECOND_BRAIN_URL`                      | `https://second-brain.lovable.app` | Base URL app, tanpa `/` di akhir                        |
| `TELEGRAM_BOT_TOKEN`                    | `123456:ABC…`                      | Dari @BotFather                                         |
| `TELEGRAM_ALLOWED_CHAT_IDS`             | `11111111,22222222`                | Allow-list chat; **kosong = tolak semua** (fail-closed) |
| `TELEGRAM_ADMIN_CHAT_ID`                | `11111111`                         | Penerima alert error/automation                         |
| `TELEGRAM_WEBHOOK_SECRET`               | string acak 32+ karakter           | Hanya untuk mode _native_ (setWebhook → app)            |
| `OPENAI_VISION_MODEL`                   | `gpt-4.1-mini`                     | Model OCR (default `gpt-4.1-mini`)                      |
| `OPENAI_TRANSCRIBE_MODEL`               | `gpt-4o-mini-transcribe`           | Model transkripsi (alternatif `whisper-1`)              |
| `REMINDER_LEAD_MINUTES`                 | `60`                               | Pengingat dikirim N menit sebelum tenggat               |
| `SECOND_BRAIN_CRON_TOKEN`               | nilai `app_config.cron_token`      | Hanya untuk node legacy `hooks/reminders`               |
| `BACKUP_RETENTION_DAYS`                 | `56`                               | Retensi file backup di Drive                            |
| `BACKUP_EMAIL_FROM` / `BACKUP_EMAIL_TO` |                                    | Jika memakai backup via email                           |
| `AUTOMATION_WEBHOOK_TOKEN`              | string acak 32+ karakter           | Token `?token=` di URL webhook automation               |
| `DISCORD_WEBHOOK_URL`                   |                                    | Opsional, untuk cabang Discord/Slack                    |
| `SECOND_BRAIN_OWNER_EMAIL`              | `anda@email.com`                   | Akun pemilik untuk Google → app (07)                    |
| `EMAIL_ALLOWED_SENDERS`                 | `anda@email.com,kantor@email.com`  | Allow-list pengirim email (08)                          |

Di sisi **web app** tambahkan secret `N8N_API_KEY` (string acak ≥ 32 karakter, mis. `openssl rand -hex 32`) dan, bila memakai mode native, `TELEGRAM_WEBHOOK_SECRET` (sudah dibaca oleh `/api/public/telegram/webhook`).

## Credentials

| Credential n8n                                 | Isi                                         | Dipakai di                        |
| ---------------------------------------------- | ------------------------------------------- | --------------------------------- |
| **Telegram API** — "Telegram Second Brain Bot" | Access Token = token BotFather              | 01 (trigger)                      |
| **Header Auth** — "Second Brain x-api-key"     | Name `x-api-key`, Value = `N8N_API_KEY` app | 01, 02, 05, 07, 08 (+03 opsional) |
| **OpenAI API** — "OpenAI Second Brain"         | API key OpenAI                              | 01 (OCR + transkripsi)            |
| **Google Drive OAuth2**                        | OAuth client Google Cloud (Drive API aktif) | 05                                |
| **SMTP**                                       |                                             | 05 (email, disabled)              |
| **Google Sheets OAuth2**                       |                                             | 06 (disabled)                     |
| **Google Calendar OAuth2**                     | akun pemilik                                | 07 (Google → app, disabled)       |
| **IMAP**                                       | kotak masuk khusus capture                  | 08                                |

Semua credential di JSON bertanda `"id": "REPLACE_ME"`; setelah impor, buka node bertanda ⚠️ dan pilih credential yang benar. Ganti juga `REPLACE_ME_FOLDER_ID` (05) dan `REPLACE_ME_SHEET_ID` (06).

## Langkah impor

1. Set env di atas pada n8n (Docker: `environment:` / `.env`), termasuk `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, lalu restart n8n.
2. Buat credential (tabel di atas).
3. **Workflows → Import from File** untuk tiap JSON (urutkan: 03 dulu, karena dipakai sebagai error workflow).
4. Di tiap workflow 01, 02, 05, 06, 07, 08: **Settings → Error workflow = "Second Brain – Error Handler"**.
5. Ganti credential `REPLACE_ME`, simpan, jalankan **04** secara manual, lalu **Activate** workflow lain.
6. Bangun endpoint di bagian berikut (atau aktifkan sementara node legacy di 02).

## Setup bot Telegram

1. @BotFather → `/newbot` → simpan token ke `TELEGRAM_BOT_TOKEN`. Opsional: `/setprivacy` → _Disable_ bila bot dipakai di grup.
2. Ketahui chat ID Anda (kirim pesan ke @userinfobot) → isi `TELEGRAM_ALLOWED_CHAT_IDS` & `TELEGRAM_ADMIN_CHAT_ID`.
3. Pilih **mode bot** (satu bot hanya punya satu webhook):

   | Mode                 | Cara                                                                 | Kelebihan                                        |
   | -------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
   | **n8n (disarankan)** | Activate workflow 01 — Telegram Trigger otomatis `setWebhook` ke n8n | OCR, voice, tombol inline, semua perintah        |
   | **Native**           | Jangan aktifkan 01; jalankan node `setWebhook → app` di 04           | Tanpa n8n; hanya `/start`, `/link`, teks → Inbox |

   Pindah mode: jalankan `deleteWebhook` (04) dulu.

4. Di Telegram kirim `/link email@anda.com` untuk menautkan chat ke akun (mengisi `profiles.telegram_chat_id`). Semua endpoint n8n mengidentifikasi user lewat `chat_id` ini.
5. Jalankan 04 untuk mendaftarkan menu `/`.

### Perintah bot (diproses server di `/n8n/bot`)

| Perintah                                                      | Aksi                                                                                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(teks bebas)_                                                | Capture: NLP lokal (`parseTaskText`) → bila terdeteksi tanggal/prioritas jadi tugas, selain itu masuk Inbox; balasan berisi tombol _Jadikan tugas / Jadikan catatan / Hapus_ |
| `/task <teks>`                                                | Buat tugas (`besok 9:00`, `#tag`, `!high`, `@proyek`)                                                                                                                        |
| `/note Judul \| isi`                                          | Buat catatan (blocks + mirror markdown `content`)                                                                                                                            |
| `/inbox`                                                      | 10 item Inbox pending + tombol proses                                                                                                                                        |
| `/today`, `/upcoming`, `/overdue`, `/week`                    | Daftar tugas (tombol ✅ selesai per tugas)                                                                                                                                   |
| `/done <kata kunci>`                                          | Tandai selesai (pilihan tombol bila >1 cocok)                                                                                                                                |
| `/search <kueri>`                                             | Cari tugas & catatan (judul/`content`)                                                                                                                                       |
| `/sum <teks/URL>`                                             | Ringkas AI → simpan sebagai catatan                                                                                                                                          |
| `/link`, `/unlink`, `/help`, `/start`                         | Akun & bantuan                                                                                                                                                               |
| Foto/gambar/PDF (+caption `/task`, `/note`, `/inbox`, `/sum`) | OCR → tujuan sesuai caption (default: catatan "OCR <tanggal>" + item Inbox)                                                                                                  |
| Voice note / audio                                            | Transkripsi → capture seperti teks (caption opsional)                                                                                                                        |

## OCR & AI: pilihan provider dan biaya

Workflow 01 memakai **OpenAI** via HTTP Request (bisa diganti tanpa mengubah kontrak ke app, karena app hanya menerima `ocr_text`/`transcript`):

| Kebutuhan              | Default di template                                                       | Alternatif                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR foto/gambar        | `POST /v1/responses` + `input_image` (`gpt-4.1-mini`, detail high)        | Mistral OCR (`POST https://api.mistral.ai/v1/ocr`, `mistral-ocr-latest`, ±$1/1000 halaman, sangat bagus untuk dokumen/PDF), Google Cloud Vision `DOCUMENT_TEXT_DETECTION` (1000 unit gratis/bulan), node **OpenAI → Analyze Image** bawaan n8n, Tesseract self-hosted (gratis, akurasi tulisan tangan rendah) |
| OCR PDF                | `input_file` (PDF base64) di Responses API                                | Mistral OCR (native PDF, multi-halaman)                                                                                                                                                                                                                                                                       |
| Transkripsi            | `POST /v1/audio/transcriptions` (`gpt-4o-mini-transcribe`, `language=id`) | `whisper-1`, Groq Whisper (`whisper-large-v3-turbo`, sangat murah/cepat), Deepgram                                                                                                                                                                                                                            |
| Ringkasan / capture AI | Di server (Lovable AI Gateway, `ai.server.ts`) — **bukan** di n8n         | —                                                                                                                                                                                                                                                                                                             |

Perkiraan biaya (cek harga terbaru provider): satu foto ±1–3 ribu token input pada `gpt-4.1-mini` ≈ < $0,002; voice 1 menit `gpt-4o-mini-transcribe` ≈ $0,003. OCR tidak dijalankan untuk teks biasa, sehingga biaya hanya muncul saat mengirim file. Batasi dengan allow-list dan batas ukuran file (19 MB, batas `getFile` Telegram). Alternatif tanpa API key OpenAI: buat endpoint `/n8n/bot` menerima `file_base64` dan memakai `ocrImage`/`transcribeVoice` yang sudah ada di app (Lovable AI Gateway) — tetapi perhatikan batas ukuran body serverless (±4,5 MB).

## Endpoint backend yang wajib dibangun

Sudah ada di app:

| Method & path                       | Auth                                                                 | Catatan                                                                           |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /api/public/telegram/webhook` | header `x-telegram-bot-api-secret-token` = `TELEGRAM_WEBHOOK_SECRET` | Mode native: `/start`, `/link email`, teks → `inbox_items`                        |
| `POST /api/public/hooks/reminders`  | `Authorization: Bearer <app_config.cron_token>`                      | Pengingat ≤ 24 jam, kirim via gateway Telegram Lovable, set `tasks.reminded=true` |

Belum ada — rancang di `src/routes/api/public/n8n/*`. Aturan umum:

- Auth: header `x-api-key` dibandingkan dengan `process.env.N8N_API_KEY` memakai `timingSafeEqual` (pola seperti `src/integrations/supabase/cron-auth.ts`); salah/absen → `401 {"error":"unauthorized"}`; env kosong → `500`.
- Pakai `supabaseAdmin` (service role) **dan selalu filter `user_id`** dari profil yang dipetakan (`profiles.telegram_chat_id` atau email), termasuk akses tugas proyek bersama via `is_project_member`. Kecualikan `deleted_at`/`archived_at` seperti hook di `src/lib/data.ts`.
- Body divalidasi dengan `zod`; error validasi → `400 {"error": "..."}`.
- Idempoten: simpan `update_id` / `external_id` terakhir (mis. tabel `n8n_events` atau kolom unik) agar retry n8n tidak membuat duplikat.
- Pembuatan/ubah tugas memicu logika yang sama dengan `useTaskActions` di server (blocked check, auto-shift dependents, `runAutomations`) — ekstrak ke helper server yang bisa dipanggil tanpa sesi browser.
- Respons Telegram **tidak** dikirim oleh server; server mengembalikan instruksi balasan, n8n yang mengirim.

### `POST /api/public/n8n/bot`

Request (satu dari 4 `kind`):

```json
{
  "update_id": 123,
  "chat_id": "11111111",
  "message_id": 42,
  "username": "ilham",
  "first_name": "Ilham",
  "kind": "text | callback | ocr | voice",
  "source": "telegram | ocr | voice",
  "text": "/task Rapat klien besok 10:00 #kerja !high",
  "callback_data": "done:7f3c…",
  "ocr_text": "…hasil OCR…",
  "file_name": "photo.jpg",
  "mime_type": "image/jpeg",
  "ocr_model": "gpt-4.1-mini",
  "transcript": "…hasil transkripsi…",
  "duration": 14
}
```

- `text` wajib untuk `kind=text`; untuk `ocr`/`voice` berisi caption (boleh `null`), isinya di `ocr_text`/`transcript`.
- `callback_data` ≤ 64 byte, format disarankan `<aksi>:<id>` (`done:`, `snooze:<id>:1d`, `totask:<inboxId>`, `tonote:<inboxId>`, `del:<inboxId>`, `page:inbox:2`).
- Chat yang belum `/link` → balas instruksi tautkan akun.

Response `200`:

```json
{
  "method": "send",
  "text": "✅ Tugas dibuat: Rapat klien\n📅 Sel, 6 Okt 10:00 · 🔴 high · #kerja",
  "parse_mode": "HTML",
  "reply_markup": { "inline_keyboard": [[{ "text": "✅ Selesai", "callback_data": "done:7f3c…" }]] }
}
```

```json
{
  "method": "callback",
  "toast": "Ditandai selesai",
  "text": "✔️ <s>Rapat klien</s>",
  "parse_mode": "HTML",
  "reply_markup": null
}
```

`method=send` → n8n `sendMessage` (membalas pesan asal; `reply_to:false` untuk tidak me-reply). `method=callback` → `answerCallbackQuery(toast)` lalu `editMessageText(text, reply_markup)`. `parse_mode` opsional (`HTML` disarankan; escape `<>&`).

### `POST /api/public/n8n/capture`

Capture generik (email, Google Calendar, integrasi lain).

```json
{
  "user_email": "anda@email.com",
  "chat_id": null,
  "source": "email | google_calendar | webhook",
  "target": "inbox | task | note | auto",
  "title": "Proposal Q4",
  "text": "isi / deskripsi",
  "description": null,
  "start_date": "2026-10-06T09:00:00+07:00",
  "due_date": "2026-10-06T10:00:00+07:00",
  "tags": ["kerja"],
  "project": "Klien A",
  "summarize": false,
  "external_id": "email:<message-id>",
  "google_event_id": null,
  "url": null
}
```

Satu dari `user_email`/`chat_id` wajib. `target=auto` → pakai `parseTaskText`. `summarize=true` → isi `ai_summary` (inbox) atau ringkasan di awal catatan. Response: `201 {"ok": true, "type": "task|note|inbox", "id": "uuid", "duplicate": false}`; `external_id` yang sama → `200 {..., "duplicate": true}`; user tidak ditemukan → `404`.

### `GET /api/public/n8n/digest?kind=morning|overdue|evening|weekly`

Untuk setiap profil dengan `telegram_chat_id`: susun pesan (tugas hari ini/overdue/inbox pending; evening = selesai hari ini + besok; weekly = statistik selesai, overdue, proyek aktif, catatan baru, saran fokus minggu depan — boleh diringkas AI). User tanpa isi dilewati.

```json
{
  "kind": "morning",
  "count": 2,
  "messages": [
    {
      "chat_id": "11111111",
      "text": "☀️ Selamat pagi…",
      "parse_mode": "HTML",
      "reply_markup": null
    }
  ]
}
```

### `POST /api/public/n8n/reminders`

Body `{ "lead_minutes": 60, "include_overdue": true }`. Ambil tugas `status != 'done'`, `reminded = false`, `due_date <= now + lead`, bukan deleted/archived; set `reminded = true` **setelah** pesan disusun (atau kembalikan id dan tandai di request terpisah bila ingin "at-least-once"). Response sama dengan digest (`messages[]`, tiap pesan boleh berisi tombol `done:<id>` / `snooze:<id>:1h`). Menggantikan `/api/public/hooks/reminders` (jangan jalankan keduanya).

### `POST /api/public/n8n/maintenance`

Body `{ "tasks": ["recurring", "purge_trash"], "purge_after_days": 30 }`. `recurring`: buat instance berikutnya untuk tugas `recurrence` yang selesai; `purge_trash`: hapus permanen baris dengan `deleted_at < now - N hari`. Response `{ "ok": true, "recurring_created": 3, "purged": { "tasks": 4, "notes": 1, "projects": 0 } }`.

### `GET /api/public/n8n/backup?include=all`

Response `200`, `Content-Type: application/json`, `Content-Disposition: attachment; filename="second-brain-backup-YYYY-MM-DD.json"`:

```json
{
  "version": 1,
  "exported_at": "…",
  "users": [
    {
      "user_id": "…",
      "email": "…",
      "projects": [],
      "tasks": [],
      "task_dependencies": [],
      "task_comments": [],
      "milestones": [],
      "notes": [],
      "note_versions": [],
      "inbox_items": [],
      "automations": [],
      "templates": [],
      "canvas_boards": [],
      "time_entries": []
    }
  ]
}
```

Jangan sertakan `app_user_connections`, `app_config`, atau secret apa pun. `include=all` menyertakan baris archived/deleted.

### `POST /api/public/n8n/calendar/sync`

Body `{ "since_minutes": 45, "limit": 200 }`. Untuk tiap user dengan koneksi `google_calendar`, jalankan logika `syncTaskToGoogle` (refactor ke helper server yang menerima `userId`) pada tugas bertanggal yang `updated_at` dalam jendela; hapus event untuk tugas yang dihapus/arsip. Response `{ "synced": 12, "results": [ { "task_id": "…", "title": "…", "ok": false, "error": "Google Calendar gagal [401]" } ] }`. Event yang dibuat sebaiknya diberi `extendedProperties.private.second_brain_task_id` agar workflow 07 tidak mengimpornya kembali.

### `POST /api/public/n8n/events` (opsional)

Body `{ "type": "n8n_error", "workflow": "…", "node": "…", "message": "…", "execution_id": "…", "execution_url": "…", "at": "…" }` → simpan ke `activity_logs` (atau tabel khusus). Response `{ "ok": true }`.

### Migrasi pendukung

- `inbox_items.source` saat ini `CHECK (source IN ('manual','telegram','voice','ocr'))` → tambah `'email'`, `'google_calendar'`, `'webhook'`.
- Opsional: tabel `n8n_events (key text primary key, created_at timestamptz)` untuk idempotensi `update_id`/`external_id`.

## Keamanan

- **Allow-list chat ID** dicek di n8n (fail-closed) **dan** server tetap memetakan `chat_id → user` lewat `profiles.telegram_chat_id`; chat yang tidak tertaut tidak bisa membaca data apa pun.
- `/link email` saat ini menautkan chat ke akun hanya dengan email — sebaiknya ganti dengan kode sekali pakai yang dibuat di halaman Settings (mis. `/link 483920`) agar orang lain tidak bisa menautkan email Anda.
- **Webhook secret:** mode native wajib `TELEGRAM_WEBHOOK_SECRET` (app menolak tanpa header yang cocok — jika env kosong, cek dilewati, jadi pastikan diisi). Telegram Trigger n8n memakai path acak (`webhookId`); jangan bagikan URL-nya.
- Webhook automation (06) memakai `?token=`; gunakan string acak panjang, rotasi bila bocor. Aksi webhook di app hanya menerima `https`.
- `N8N_API_KEY` hanya di server app & credential n8n — jangan di env klien (`VITE_*`). Rotasi berkala; pertimbangkan dukungan dua key (current/previous) seperti `cron-auth.ts`.
- Eksekusi sukses tidak disimpan (`saveDataSuccessExecution: none`) karena berisi isi pesan/catatan pribadi; backup juga tidak menyimpan eksekusi error (berisi seluruh data).
- File OCR/voice dikirim ke provider AI pihak ketiga — informasikan ke pengguna dan hindari dokumen sangat sensitif, atau gunakan OCR self-hosted.

## Troubleshooting

| Gejala                                               | Penyebab / solusi                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `access to env vars denied`                          | Set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, restart n8n                                                                                       |
| Bot diam sama sekali                                 | Chat ID tidak ada di `TELEGRAM_ALLOWED_CHAT_IDS`; atau webhook masih ke app → cek `getWebhookInfo` (04), `deleteWebhook`, aktifkan ulang 01 |
| `Conflict: can't use getUpdates…` / webhook tertimpa | Dua tempat memasang webhook untuk bot yang sama (app + n8n, atau n8n test URL). Pilih satu mode                                             |
| Telegram Trigger gagal aktif                         | n8n harus HTTPS publik (`WEBHOOK_URL=https://n8n.domain.com/`)                                                                              |
| `401 unauthorized` dari app                          | Credential Header Auth: Name harus `x-api-key`, Value sama dengan `N8N_API_KEY` di app                                                      |
| `404` dari `/api/public/n8n/*`                       | Endpoint belum dibangun — lihat bagian kontrak; sementara aktifkan node legacy di 02                                                        |
| "Akun belum terhubung"                               | Kirim `/link email@anda.com` di bot                                                                                                         |
| OCR kosong / `400` dari OpenAI                       | Model tidak mendukung vision/PDF → ganti `OPENAI_VISION_MODEL`; file > 15 MB; PDF terenkripsi                                               |
| Voice gagal                                          | Node _Fix audio filename_ mengganti `.oga` → `.ogg`; bila masih ditolak, ganti `OPENAI_TRANSCRIBE_MODEL` ke `whisper-1`                     |
| Pesan dobel                                          | Retry n8n tanpa idempotensi → server harus menyimpan `update_id`/`external_id`                                                              |
| Jadwal meleset 7 jam                                 | Set `GENERIC_TIMEZONE=Asia/Jakarta` dan cek Settings → Timezone workflow                                                                    |
| Google Drive `File not found`                        | `REPLACE_ME_FOLDER_ID` belum diganti atau akun OAuth tidak punya akses folder                                                               |
| Automation tercatat gagal `Webhook 401`              | `?token=` di URL tidak sama dengan `AUTOMATION_WEBHOOK_TOKEN`, atau workflow 06 belum aktif (URL `/webhook-test/` hanya untuk mode test)    |

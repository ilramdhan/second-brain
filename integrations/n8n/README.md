# Template workflow n8n — Second Brain

Workflow [n8n](https://n8n.io) siap-impor untuk Second Brain: bot Telegram (teks, `/perintah`, tombol inline, **OCR** foto/dokumen, **transkripsi** voice note), pengingat & digest terjadwal, maintenance harian, error alert, **backup otomatis ke Google Drive + email (Resend)**, penerima webhook Automations, sinkronisasi Google Calendar, dan email → Inbox.

**Prinsip:** n8n hanya _relay tipis_. Semua logika domain (NLP tanggal `src/lib/nlp.ts`, AI ringkasan `src/lib/ai.server.ts`, aturan task/note/inbox, soft delete, akses proyek bersama, automations) tetap di web app, di belakang endpoint `/api/public/n8n/*` yang dilindungi header `x-api-key` = `N8N_API_KEY`. n8n menambah hal yang memang berbasis file/jadwal: unduh file Telegram, OCR/transkripsi, jadwal, Google Drive, IMAP, SMTP.

**Kenapa jadwal di n8n:** Vercel Hobby hanya mengizinkan cron 1×/hari dan fungsi berdurasi pendek; Supabase Free tidak menyediakan backup yang bisa diunduh dan tidak menjamin pg_cron. Karena itu pengingat (15 menit), digest, maintenance dan backup dipicu dari n8n self-hosted. Vercel Cron dan pg_cron hanya fallback (lihat [Fallback tanpa n8n](#fallback-tanpa-n8n)).

## Daftar workflow

| File                                      | Fungsi                                                                                                                                                          | Env (n8n)                                                                                                                   | Credentials                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `01-second-brain-telegram-bot.json`       | Bot mode n8n: teks & `/today /inbox /task /note /done /search /sum …`, tombol inline, foto/gambar/PDF → OCR, voice/audio → transkripsi → `POST /n8n/bot`        | `SECOND_BRAIN_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `OPENAI_VISION_MODEL`\*, `OPENAI_TRANSCRIBE_MODEL`\* | Telegram API, Header Auth `x-api-key`, OpenAI API |
| `02-second-brain-schedules.json`          | Pengingat (15 mnt), digest pagi 07:00, overdue 12:30 (Sen–Jum), malam 20:30, weekly Minggu 18:00, maintenance 03:00. Node fallback `hooks/reminders` (disabled) | `SECOND_BRAIN_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `REMINDER_LEAD_MINUTES`\*, `TRASH_RETENTION_DAYS`\*  | Header Auth                                       |
| `03-second-brain-error-handler.json`      | Alert Telegram ke admin saat workflow lain gagal + log ke `activity_logs` (`POST /n8n/events`)                                                                  | `SECOND_BRAIN_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`                                                          | Header Auth                                       |
| `04-second-brain-setup-commands.json`     | Manual sekali: `setMyCommands`, `getMe`, `getWebhookInfo`; `setWebhook → app` & `deleteWebhook` (disabled)                                                      | `TELEGRAM_BOT_TOKEN`, `SECOND_BRAIN_URL`, `TELEGRAM_WEBHOOK_SECRET`\*                                                       | —                                                 |
| `05-second-brain-backup.json`             | Harian/mingguan → `GET /n8n/backup` (berhalaman, gzip) → `.json.gz` ke Google Drive → rotasi → email ringkasan via Resend SMTP → alert gagal (Telegram + email) | `SECOND_BRAIN_URL`, `BACKUP_*`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`                                              | Header Auth, Google Drive OAuth2, SMTP (Resend)   |
| `06-second-brain-automation-webhook.json` | Target aksi **Kirim webhook** di halaman Automations → Telegram admin / Google Sheets / Discord-Slack                                                           | `AUTOMATION_WEBHOOK_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `DISCORD_WEBHOOK_URL`\*, `SECOND_BRAIN_URL`     | (Google Sheets OAuth2)                            |
| `07-second-brain-calendar-sync.json`      | Tiap 30 mnt `POST /n8n/calendar/sync` (app → Google, token OAuth per user di server); opsional Google → app (event `#task` → tugas)                             | `SECOND_BRAIN_URL`, `CALENDAR_SYNC_MODE`\*, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `SECOND_BRAIN_OWNER_EMAIL`\*    | Header Auth, (Google Calendar OAuth2)             |
| `08-second-brain-email-to-inbox.json`     | Email (IMAP, pengirim di allow-list) → Inbox / tugas (`task: …`) / catatan (`note: …`), ringkasan AI untuk email panjang                                        | `SECOND_BRAIN_URL`, `EMAIL_ALLOWED_SENDERS`                                                                                 | IMAP, Header Auth                                 |

\* opsional. Nama node berbahasa Indonesia, sticky note menjelaskan alur di dalam tiap workflow.

## Variabel lingkungan n8n

| Variabel                       | Contoh / default                   | Keterangan                                                                                      |
| ------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false`                            | **Wajib** agar `$env.*` bisa dibaca di node                                                     |
| `GENERIC_TIMEZONE`             | `Asia/Jakarta`                     | Zona waktu jadwal (samakan dengan `APP_TIMEZONE` di app)                                        |
| `SECOND_BRAIN_URL`             | `https://2ndbrain.ilramdhan.dev`   | Base URL app, tanpa `/` di akhir                                                                |
| `TELEGRAM_BOT_TOKEN`           | `123456:ABC…`                      | Dari @BotFather (sama dengan env app)                                                           |
| `TELEGRAM_ALLOWED_CHAT_IDS`    | `11111111,22222222`                | Allow-list chat; **kosong = tolak semua** (fail-closed)                                         |
| `TELEGRAM_ADMIN_CHAT_ID`       | `11111111`                         | Penerima alert error/automation/backup                                                          |
| `TELEGRAM_WEBHOOK_SECRET`      | string acak 32+ karakter           | Hanya untuk mode app (node `setWebhook → app` di 04)                                            |
| `OPENAI_VISION_MODEL`          | `gpt-4.1-mini`                     | Model OCR                                                                                       |
| `OPENAI_TRANSCRIBE_MODEL`      | `gpt-4o-mini-transcribe`           | Model transkripsi (alternatif `whisper-1`; Gemini: `gemini-3.8-flash`)                          |
| `OPENAI_BASE_URL`              | `https://api.openai.com/v1`        | Opsional: host OCR/transkripsi (Gemini → lihat _Memakai Google Gemini_)                         |
| `OPENAI_TRANSCRIBE_BASE_URL`   | = `OPENAI_BASE_URL`                | Opsional: host khusus transkripsi, mis. Groq `https://api.groq.com/openai/v1`                   |
| `N8N_OCR_MODE`                 | `responses`                        | `responses` (OpenAI Responses API) atau `chat` (Chat Completions); otomatis `chat` untuk Gemini |
| `N8N_TRANSCRIBE_MODE`          | `transcriptions`                   | `transcriptions` atau `chat` (`input_audio`); otomatis `chat` bila host = Gemini                |
| `REMINDER_LEAD_MINUTES`        | `60`                               | Pengingat dikirim N menit sebelum tenggat                                                       |
| `TRASH_RETENTION_DAYS`         | `30`                               | Maintenance: hapus permanen sampah lebih tua dari N hari                                        |
| `SECOND_BRAIN_CRON_SECRET`     | nilai env app yang sama            | Hanya untuk node fallback `hooks/reminders` (02, disabled)                                      |
| `BACKUP_FREQUENCY`             | `daily`                            | `daily` atau `weekly`                                                                           |
| `BACKUP_HOUR`                  | `2`                                | Jam backup (0–23, zona `GENERIC_TIMEZONE`)                                                      |
| `BACKUP_WEEKDAY`               | `0`                                | Hari backup bila `weekly` (0 = Minggu … 6 = Sabtu)                                              |
| `BACKUP_DRIVE_FOLDER_ID`       | `1AbC…`                            | **Wajib** untuk 05: ID folder Google Drive (dari URL folder)                                    |
| `BACKUP_RETENTION`             | `14`                               | Jumlah file backup terbaru yang disimpan                                                        |
| `BACKUP_EMAIL_FROM`            | `Second Brain <backup@domain.com>` | Pengirim (domain terverifikasi di Resend)                                                       |
| `BACKUP_EMAIL_TO`              | `anda@email.com`                   | Penerima ringkasan & alert                                                                      |
| `BACKUP_EMAIL_ATTACH_MAX_MB`   | `5`                                | Lampirkan `.json.gz` bila ≤ N MB (`0` = tanpa lampiran; batas Resend 40 MB total)               |
| `BACKUP_INCLUDE_VERSIONS`      | `0`                                | `1` = sertakan `note_versions` (file lebih besar)                                               |
| `CALENDAR_SYNC_MODE`           | `linked`                           | `linked` = hanya tugas yang pernah dikirim ke Google; `all` = semua tugas bertanggal            |
| `AUTOMATION_WEBHOOK_TOKEN`     | string acak 32+ karakter           | Token `?token=` di URL webhook automation (06)                                                  |
| `DISCORD_WEBHOOK_URL`          |                                    | Opsional, cabang Discord/Slack (06)                                                             |
| `SECOND_BRAIN_OWNER_EMAIL`     | `anda@email.com`                   | Akun pemilik untuk Google → app (07)                                                            |
| `EMAIL_ALLOWED_SENDERS`        | `anda@email.com,kantor@email.com`  | Allow-list pengirim email (08); kosong = tolak semua                                            |

Di sisi **web app** (Vercel → Environment Variables) set `N8N_API_KEY` (`openssl rand -hex 32`; `N8N_API_KEY_PREVIOUS` saat rotasi), `TELEGRAM_BOT_TOKEN`, `APP_TIMEZONE`, dan bila memakai mode app `TELEGRAM_WEBHOOK_SECRET`. Daftar lengkap: `.env.example`.

## Credentials

| Credential n8n                                        | Isi                                                                                                                              | Dipakai di                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Telegram API** — "Telegram Second Brain Bot"        | Access Token = token BotFather                                                                                                   | 01 (trigger)                |
| **Header Auth** — "Second Brain x-api-key"            | Name `x-api-key`, Value = `N8N_API_KEY` app                                                                                      | 01, 02, 03, 05, 07, 08      |
| **OpenAI API** — "OpenAI Second Brain"                | API key OpenAI                                                                                                                   | 01 (OCR + transkripsi)      |
| **Google Drive OAuth2** — "Google Drive Second Brain" | OAuth client Google Cloud (Drive API aktif), scope `drive.file` cukup bila folder dibuat oleh n8n; `drive` bila folder sudah ada | 05                          |
| **SMTP** — "Resend SMTP"                              | Host `smtp.resend.com`, Port `465`, SSL/TLS **on**, User `resend`, Password = Resend API key (`re_…`)                            | 05                          |
| **Google Sheets OAuth2**                              |                                                                                                                                  | 06 (disabled)               |
| **Google Calendar OAuth2**                            | akun pemilik                                                                                                                     | 07 (Google → app, disabled) |
| **IMAP**                                              | kotak masuk khusus capture                                                                                                       | 08                          |

Semua credential di JSON bertanda `"id": "REPLACE_ME"`; setelah impor, buka node bertanda ⚠️ dan pilih credential yang benar. Ganti juga `REPLACE_ME_SHEET_ID` (06).

### Google Drive (backup)

1. Google Cloud console → project (boleh sama dengan OAuth Calendar app) → _APIs & Services → Library_ → aktifkan **Google Drive API**.
2. _Credentials → OAuth client ID → Web application_, redirect URI = URL OAuth callback n8n (tampil di dialog credential n8n, mis. `https://n8n.domain.com/rest/oauth2-credential/callback`).
3. Di n8n buat credential **Google Drive OAuth2 API** dengan client ID/secret tersebut → _Sign in with Google_.
4. Buat folder di Drive, salin ID-nya dari URL (`drive.google.com/drive/folders/<ID>`) ke `BACKUP_DRIVE_FOLDER_ID`.

### Resend SMTP (email backup & alert)

1. [resend.com](https://resend.com) → _Domains_ → tambah & verifikasi domain (SPF/DKIM). Paket gratis: 3.000 email/bulan, 100/hari.
2. _API Keys_ → buat key dengan izin **Sending access**.
3. Credential n8n **SMTP**: host `smtp.resend.com`, port `465`, SSL on, user `resend`, password = API key. `BACKUP_EMAIL_FROM` harus memakai domain terverifikasi.

## Langkah impor

1. Set env di atas pada n8n (Docker: `environment:` / `.env`), termasuk `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` dan `GENERIC_TIMEZONE`, lalu restart n8n. n8n harus bisa diakses via HTTPS publik (`WEBHOOK_URL`).
2. Buat credential (tabel di atas).
3. **Workflows → Import from File** dengan urutan: **03** (error handler) → **04** → **01** → **02** → **05** → **06** → **07** → **08**.
4. Di tiap workflow 01, 02, 05, 06, 07, 08: **Settings → Error workflow = "Second Brain – Error Handler"**.
5. Ganti credential `REPLACE_ME`, simpan, jalankan **04** secara manual, lalu **Activate** workflow lain.
6. Uji: kirim `/help` ke bot (01), _Execute workflow_ manual di 05 (pakai trigger **Jalankan manual**) dan cek file di Drive + email.

## Setup bot Telegram

1. @BotFather → `/newbot` → simpan token ke `TELEGRAM_BOT_TOKEN` (n8n **dan** app) dan username ke `TELEGRAM_BOT_USERNAME` (app, opsional untuk tombol deep link). Opsional: `/setprivacy` → _Disable_ bila bot dipakai di grup.
2. Ketahui chat ID Anda (kirim pesan ke @userinfobot) → isi `TELEGRAM_ALLOWED_CHAT_IDS` & `TELEGRAM_ADMIN_CHAT_ID`.
3. Pilih **mode bot** (satu bot hanya punya satu webhook):

   | Mode                 | Cara                                                                                             | Kelebihan                                        |
   | -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
   | **n8n (disarankan)** | Activate workflow 01 — Telegram Trigger otomatis `setWebhook` ke n8n → app `/api/public/n8n/bot` | OCR, voice, tombol inline, semua perintah        |
   | **App**              | Jangan aktifkan 01; set `TELEGRAM_WEBHOOK_SECRET` di app, jalankan node `setWebhook → app` di 04 | Tanpa n8n; hanya `/start`, `/link`, teks → Inbox |

   Pindah mode: jalankan `deleteWebhook` (04) dulu.

4. Di web app buka **Pengaturan → Bot Telegram → Hubungkan Telegram**, lalu kirim `/link <kode>` ke bot (atau klik tombol _Buka bot & tautkan otomatis_ bila `TELEGRAM_BOT_USERNAME` di-set). Kode 8 karakter, berlaku 10 menit, sekali pakai; mengisi `profiles.telegram_chat_id`. Semua endpoint n8n mengidentifikasi user lewat `chat_id` ini.
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
| `/link KODE`, `/start KODE`, `/unlink`, `/help`, `/start`     | Akun & bantuan (kode sekali pakai dari Settings; `/start KODE` = deep link `t.me/<bot>?start=KODE`)                                                                          |
| Foto/gambar/PDF (+caption `/task`, `/note`, `/inbox`, `/sum`) | OCR → tujuan sesuai caption (default: catatan "OCR <tanggal>" + item Inbox)                                                                                                  |
| Voice note / audio                                            | Transkripsi → capture seperti teks (caption opsional)                                                                                                                        |

## OCR & AI: pilihan provider dan biaya

Workflow 01 memakai **OpenAI** via HTTP Request (bisa diganti tanpa mengubah kontrak ke app, karena app hanya menerima `ocr_text`/`transcript`):

| Kebutuhan              | Default di template                                                       | Alternatif                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR foto/gambar        | `POST /v1/responses` + `input_image` (`gpt-4.1-mini`, detail high)        | Mistral OCR (`POST https://api.mistral.ai/v1/ocr`, `mistral-ocr-latest`, ±$1/1000 halaman, sangat bagus untuk dokumen/PDF), Google Cloud Vision `DOCUMENT_TEXT_DETECTION` (1000 unit gratis/bulan), node **OpenAI → Analyze Image** bawaan n8n, Tesseract self-hosted (gratis, akurasi tulisan tangan rendah) |
| OCR PDF                | `input_file` (PDF base64) di Responses API                                | Mistral OCR (native PDF, multi-halaman)                                                                                                                                                                                                                                                                       |
| Transkripsi            | `POST /v1/audio/transcriptions` (`gpt-4o-mini-transcribe`, `language=id`) | Gemini via Chat Completions + `input_audio` (`N8N_TRANSCRIBE_MODE=chat`), `whisper-1`, Groq Whisper (`whisper-large-v3-turbo`, sangat murah/cepat), Deepgram                                                                                                                                                  |
| Ringkasan / capture AI | Di server (provider `AI_*`, `ai.server.ts`) — **bukan** di n8n            | —                                                                                                                                                                                                                                                                                                             |

Perkiraan biaya (cek harga terbaru provider): satu foto ±1–3 ribu token input pada `gpt-4.1-mini` ≈ < $0,002; voice 1 menit `gpt-4o-mini-transcribe` ≈ $0,003. OCR tidak dijalankan untuk teks biasa, sehingga biaya hanya muncul saat mengirim file. Batasi dengan allow-list dan batas ukuran file (19 MB, batas `getFile` Telegram). Endpoint `/n8n/bot` sengaja hanya menerima teks (body ≤ 1 MB); kirim file ke provider OCR/transkripsi dari n8n, bukan ke app (batas body serverless ±4,5 MB).

### Memakai Google Gemini (AI Studio)

Gemini punya API kompatibel OpenAI di `https://generativelanguage.googleapis.com/v1beta/openai` yang mendukung Chat Completions (termasuk `image_url` data URL dan `input_audio`), **tetapi tidak** `/responses` maupun `/audio/transcriptions`. Workflow 01 menangani ini otomatis:

1. Credential **OpenAI API** "OpenAI Second Brain": API Key = key AI Studio, **Base URL** = `https://generativelanguage.googleapis.com/v1beta/openai` (agar uji credential lolos). Node HTTP Request hanya memakai credential untuk header `Authorization`; URL diambil dari env berikut.
2. Env n8n: `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `OPENAI_VISION_MODEL=gemini-3.8-flash`, `OPENAI_TRANSCRIBE_MODEL=gemini-3.8-flash`. Dengan host Gemini, `N8N_OCR_MODE` dan `N8N_TRANSCRIBE_MODE` otomatis `chat` (boleh diset eksplisit).
3. OCR → `POST {base}/chat/completions` dengan `image_url` (data URL). Voice → node _Transcribe via chat?_ → _Prepare transcribe (chat)_ → `POST {base}/chat/completions` dengan `input_audio` (`format: ogg` untuk voice note Telegram; Gemini menerima ogg/webm/mp3/wav/m4a/aac/flac/opus) dan prompt "Transcribe this audio verbatim; reply with the transcript only."

**Alternatif voice: Groq Whisper** (free tier, cepat) sementara Gemini menangani OCR: set `OPENAI_TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1`, `OPENAI_TRANSCRIBE_MODEL=whisper-large-v3` (atau `whisper-large-v3-turbo`), `N8N_TRANSCRIBE_MODE=transcriptions`, lalu buat credential OpenAI kedua berisi key Groq dan pilih di node **OpenAI Transcribe**. Di web app padanannya `AI_TRANSCRIBE_MODE`, `AI_TRANSCRIBE_BASE_URL`, `AI_TRANSCRIBE_API_KEY` (lihat `.env.example`).

## Endpoint backend

Semua endpoint ada di `src/routes/api/public/n8n/*` (logika di `src/server/n8n/*`). Aturan umum:

- Auth: header `x-api-key` dibandingkan dengan `N8N_API_KEY` (atau `N8N_API_KEY_PREVIOUS`) secara constant-time; salah/absen → `401 {"error":"unauthorized"}`; env kosong → `500 {"error":"N8N_API_KEY not configured"}`.
- Body/query divalidasi `zod`; error → `400 {"error":"<field>: <pesan>"}`; body > 1 MB → `413`; error tak terduga → `500 {"error":"internal error"}` (detail hanya di log server).
- Server memakai `supabaseAdmin` hanya di handler ini dan **selalu memfilter user** yang dipetakan (`profiles.telegram_chat_id` atau email akun): baris milik user + tugas/catatan proyek yang ia miliki atau ikuti. Baris `deleted_at`/`archived_at` dikecualikan seperti hook di `src/lib/data.ts`.
- Idempoten: tabel `n8n_events (source, external_id)` menyimpan respons pertama untuk `update_id` Telegram / `external_id` capture; retry mendapat respons yang sama. Kegagalan melepas klaim agar retry bisa memproses ulang.
- Pembuatan/ubah tugas memakai aturan yang sama dengan `useTaskActions` di server: blocked check, auto-shift dependents saat snooze, recurrence, notifikasi unblock, dan automations (`runAutomationRules`).
- Respons Telegram **tidak** dikirim oleh server (kecuali notifikasi automations/unblock); server mengembalikan instruksi balasan, n8n yang mengirim.
- Tanggal "hari ini" mengikuti `APP_TIMEZONE` (default `Asia/Jakarta`).

| Method & path                            | Auth                                                              | Workflow |
| ---------------------------------------- | ----------------------------------------------------------------- | -------- |
| `POST /api/public/n8n/bot`               | `x-api-key`                                                       | 01       |
| `POST /api/public/n8n/capture`           | `x-api-key`                                                       | 07, 08   |
| `GET /api/public/n8n/digest`             | `x-api-key`                                                       | 02       |
| `POST /api/public/n8n/reminders`         | `x-api-key`                                                       | 02       |
| `POST /api/public/n8n/maintenance`       | `x-api-key`                                                       | 02       |
| `GET /api/public/n8n/backup`             | `x-api-key`                                                       | 05       |
| `POST /api/public/n8n/calendar/sync`     | `x-api-key`                                                       | 07       |
| `POST /api/public/n8n/events`            | `x-api-key`                                                       | 03       |
| `POST /api/public/telegram/webhook`      | `x-telegram-bot-api-secret-token`                                 | mode app |
| `GET`/`POST /api/public/hooks/reminders` | `Authorization: Bearer <SECOND_BRAIN_CRON_SECRET \| CRON_SECRET>` | fallback |

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
- `callback_data` ≤ 64 byte, format disarankan `<aksi>:<id>` (`done:<id>`, `snooze:<id>:1h|3h|1d|1w`, `totask:<inboxId>`, `tonote:<inboxId>`, `del:<inboxId>`, `page:inbox:2`).
- Chat yang belum `/link` → balas instruksi tautkan akun.
- Idempoten per `update_id`: retry n8n mendapat balasan yang sama (tersimpan di `n8n_events`), tanpa duplikat. Retry yang tiba saat permintaan pertama masih berjalan mendapat `{"method":"none","duplicate":true}` (Switch _Reply method_ tidak mengirim apa pun).

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
  "source": "email | google_calendar | webhook | telegram | manual",
  "target": "inbox | task | note | auto",
  "title": "Proposal Q4",
  "text": "isi / deskripsi",
  "description": null,
  "start_date": "2026-10-06T09:00:00+07:00",
  "due_date": "2026-10-06T10:00:00+07:00",
  "tags": ["kerja"],
  "project": "Klien A",
  "priority": "high | medium | low | null",
  "summarize": false,
  "external_id": "email:<message-id>",
  "google_event_id": null,
  "url": null
}
```

Satu dari `user_email`/`chat_id` wajib, juga salah satu `title`/`text`. `user_email` dicocokkan (case-insensitive) dengan email akun; `chat_id` dengan `profiles.telegram_chat_id`. `target=auto` → `parseTaskText` (zona `APP_TIMEZONE`): ada tanggal/prioritas → tugas, selain itu inbox. `summarize=true` → isi `ai_summary` (inbox) atau ringkasan di awal catatan (memakai kuota AI user; dilewati bila AI belum dikonfigurasi). Response: `201 {"ok": true, "type": "task|note|inbox", "id": "uuid", "duplicate": false}`; `external_id` yang sama → `200 {..., "duplicate": true}`; user tidak ditemukan → `404`.

### `GET /api/public/n8n/digest?kind=morning|overdue|evening|weekly`

Opsional `&user_id=<uuid>`. Untuk setiap profil dengan `telegram_chat_id` (zona waktu `APP_TIMEZONE`): susun pesan (tugas hari ini/overdue/inbox pending; evening = selesai hari ini + besok; weekly = statistik selesai, overdue, proyek aktif, catatan baru, saran fokus minggu depan — boleh diringkas AI). User tanpa isi dilewati.

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

Body `{ "lead_minutes": 60, "include_overdue": true, "mark": true, "limit": 500 }` (semua opsional). Ambil tugas `status != 'done'`, `reminded = false`, `due_date <= now + lead` (dan, bila `include_overdue=false`, `>= now`), bukan deleted/archived, milik user yang menautkan Telegram. `mark=true` menandai `reminded = true` setelah pesan disusun (at-most-once); `mark=false` = pratinjau. Response:

```json
{
  "count": 1,
  "messages": [
    {
      "chat_id": "11111111",
      "task_id": "…",
      "text": "⏰ <b>Segera jatuh tempo</b>: Bayar tagihan\n📅 Sen, 5 Okt 17.00",
      "parse_mode": "HTML",
      "reply_markup": { "inline_keyboard": [[{ "text": "✅ Selesai", "callback_data": "done:…" }]] }
    }
  ]
}
```

Menggantikan `/api/public/hooks/reminders` (jangan jalankan keduanya). Tombol ✅/⏰ diproses workflow 01.

### `POST /api/public/n8n/maintenance`

Body `{ "tasks": ["purge_trash", "link_codes", "rate_limits", "n8n_events"], "purge_after_days": 30, "events_after_days": 30 }` (default = semua empat).

- `purge_trash`: hapus permanen tasks/notes/projects dengan `deleted_at < now - purge_after_days`.
- `link_codes`: hapus `telegram_link_codes` kedaluwarsa atau terpakai > 1 hari.
- `rate_limits`: hapus jendela `rate_limits` > 24 jam.
- `n8n_events`: hapus kunci idempotensi > `events_after_days`.
- `recurring` diterima demi kompatibilitas (instance berikutnya dibuat saat tugas diselesaikan) dan selalu `0`.

Response `{ "ok": true, "purged": { "tasks": 4, "notes": 1, "projects": 0 }, "link_codes_deleted": 3, "rate_limits_deleted": 10, "n8n_events_deleted": 120 }`.

### `GET /api/public/n8n/backup?userId=all|<uuid>&include=all|active&versions=0|1&page=0&page_size=10`

`userId=all` diberi halaman per user (`page_size` user per permintaan, maks 50); n8n mengulang selama `next_page` bukan `null`. `include=all` (default) menyertakan baris archived/trash. Kirim `Accept-Encoding: gzip` agar respons dikompresi (batas respons Vercel 4,5 MB). Response `200`, `Content-Disposition: attachment; filename="second-brain-backup-YYYY-MM-DD[-pN].json"`:

```json
{
  "version": 1,
  "format": "second-brain-backup",
  "exported_at": "…",
  "page": 0,
  "next_page": null,
  "count": 1,
  "users": [
    {
      "version": 1,
      "exported_at": "…",
      "user_id": "…",
      "email": "…",
      "counts": { "tasks": 120, "notes": 40 },
      "tables": {
        "projects": [],
        "tasks": [],
        "notes": [],
        "milestones": [],
        "task_dependencies": [],
        "automations": [],
        "inbox_items": [],
        "task_comments": [],
        "templates": [],
        "time_entries": [],
        "canvas_boards": [],
        "note_versions": []
      }
    }
  ]
}
```

Setiap entri `users[]` berformat sama dengan **Pengaturan → Backup** (`{version, exported_at, tables}`), jadi file (termasuk `.json.gz`) bisa langsung dipulihkan lewat **Pulihkan JSON**: app memilih entri milik akun yang sedang masuk (atau satu-satunya entri). Restore memvalidasi setiap baris dan hanya memulihkan tabel inti (projects, tasks, notes, milestones, task_dependencies, automations); tabel lain untuk pemulihan manual. `note_versions` hanya bila `versions=1`. Tidak pernah berisi `app_user_connections`, `app_config`, `telegram_link_codes`, `n8n_events` atau secret apa pun.

### `POST /api/public/n8n/calendar/sync`

Body `{ "since_minutes": 45, "limit": 200, "mode": "linked", "user_id": null }`. Untuk tiap user dengan koneksi Google Calendar (token OAuth terenkripsi di `app_user_connections`, di-refresh di server): tugas yang `updated_at` dalam jendela → buat/perbarui event (`mode=linked`: hanya tugas yang sudah punya `google_event_id`; `mode=all`: semua tugas bertanggal), event tugas yang dihapus/diarsip/tanpa tanggal dihapus. Event diberi `extendedProperties.private.second_brain_task_id`. Akses yang dicabut di akun Google menghapus koneksi (user menghubungkan ulang). Response `{ "synced": 12, "failed": 1, "users": 2, "results": [ { "task_id": "…", "title": "…", "ok": false, "action": "upsert", "error": "Google Calendar gagal [403]" } ] }`.

### `POST /api/public/n8n/events`

Body `{ "type": "n8n_error", "workflow": "…", "node": "…", "message": "…", "execution_id": "…", "execution_url": "…", "at": "…" }` → `activity_logs` (`entity_type = 'n8n'`, `source = 'n8n'`, tanpa user). Response `{ "ok": true }`.

### Migrasi pendukung

`drizzle/migrations/0012_n8n_integration.sql`: tabel `n8n_events`, `inbox_items.source` + `email`/`google_calendar`/`webhook`, fungsi service-role `n8n_user_id_by_email` dan `consume_rate_limit_for`. Uji: `supabase/tests/n8n_integration.sql`.

## Fallback tanpa n8n

- **Pengingat**: Vercel Cron (Hobby: 1×/hari) → `GET /api/public/hooks/reminders` dengan `CRON_SECRET`, atau Supabase `pg_cron` + `pg_net` / GitHub Actions dengan `Authorization: Bearer $SECOND_BRAIN_CRON_SECRET`. Mengirim pengingat ≤ 24 jam tanpa tombol.
- **Maintenance**: membuka tab _Sampah_ di `/archive` sudah menghapus item milik user yang lebih tua dari 30 hari; link code dan `rate_limits` lama hanya memakan ruang kecil.
- **Backup**: Pengaturan → Backup → _Unduh backup_ (per user, manual).
- **Bot**: mode app (`/start`, `/link`, teks → Inbox).

## Keamanan

- **Allow-list chat ID** dicek di n8n (fail-closed) **dan** server tetap memetakan `chat_id → user` lewat `profiles.telegram_chat_id`; chat yang tidak tertaut tidak bisa membaca data apa pun.
- `/link` hanya menerima kode sekali pakai dari halaman Settings (disimpan sebagai hash SHA-256 di `telegram_link_codes`, TTL 10 menit). Mode n8n dan mode app memakai fungsi penautan yang sama — tidak pernah menautkan chat berdasarkan email.
- **Webhook secret:** mode app wajib `TELEGRAM_WEBHOOK_SECRET` (app menolak dengan 401 jika env kosong atau header tidak cocok; constant-time). Telegram Trigger n8n memakai path acak (`webhookId`); jangan bagikan URL-nya.
- Webhook automation (06) memakai `?token=`; gunakan string acak panjang, rotasi bila bocor. Aksi webhook di app hanya menerima `https` (SSRF guard).
- `N8N_API_KEY` hanya di server app & credential n8n — jangan di env klien (`VITE_*`). Rotasi: set key baru di `N8N_API_KEY`, key lama di `N8N_API_KEY_PREVIOUS`, perbarui credential n8n, lalu hapus key lama.
- n8n tidak pernah menerima token Google user, kunci Supabase, atau `TOKEN_ENCRYPTION_KEY`.
- Eksekusi sukses tidak disimpan (`saveDataSuccessExecution: none`) karena berisi isi pesan/catatan pribadi; backup juga tidak menyimpan eksekusi error (berisi seluruh data). Lindungi folder Drive dan kotak surat backup — file berisi semua data user.
- File OCR/voice dikirim ke provider AI pihak ketiga — informasikan ke pengguna dan hindari dokumen sangat sensitif, atau gunakan OCR self-hosted.

## Troubleshooting

| Gejala                                                  | Penyebab / solusi                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `access to env vars denied`                             | Set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, restart n8n                                                                                       |
| Bot diam sama sekali                                    | Chat ID tidak ada di `TELEGRAM_ALLOWED_CHAT_IDS`; atau webhook masih ke app → cek `getWebhookInfo` (04), `deleteWebhook`, aktifkan ulang 01 |
| `Conflict: can't use getUpdates…` / webhook tertimpa    | Dua tempat memasang webhook untuk bot yang sama (app + n8n, atau n8n test URL). Pilih satu mode                                             |
| Telegram Trigger gagal aktif                            | n8n harus HTTPS publik (`WEBHOOK_URL=https://n8n.domain.com/`)                                                                              |
| `401 unauthorized` dari app                             | Credential Header Auth: Name harus `x-api-key`, Value sama dengan `N8N_API_KEY` di app                                                      |
| `500 N8N_API_KEY not configured`                        | Set `N8N_API_KEY` di Vercel lalu redeploy                                                                                                   |
| `404 user not found` (capture)                          | Email pengirim bukan email akun Second Brain, atau chat belum `/link`                                                                       |
| "Akun belum terhubung"                                  | Buat kode di Pengaturan → Bot Telegram, lalu kirim `/link <kode>` di bot                                                                    |
| OCR kosong / `400` dari OpenAI                          | Model tidak mendukung vision/PDF → ganti `OPENAI_VISION_MODEL`; file > 15 MB; PDF terenkripsi                                               |
| Voice gagal                                             | Node _Fix audio filename_ mengganti `.oga` → `.ogg`; bila masih ditolak, ganti `OPENAI_TRANSCRIBE_MODEL` ke `whisper-1`                     |
| Voice `404` dengan Gemini                               | Gemini tidak punya `/audio/transcriptions` → `N8N_TRANSCRIBE_MODE=chat` (otomatis bila host = Gemini) atau pakai Groq                       |
| Jadwal meleset 7 jam                                    | Set `GENERIC_TIMEZONE=Asia/Jakarta` di n8n, `APP_TIMEZONE` di app, dan cek Settings → Timezone workflow                                     |
| Backup tidak jalan                                      | 05 hanya lanjut pada `BACKUP_HOUR` (dan `BACKUP_WEEKDAY` untuk weekly); jalankan manual untuk uji. `BACKUP_DRIVE_FOLDER_ID` wajib           |
| Google Drive `File not found` / `insufficient scope`    | `BACKUP_DRIVE_FOLDER_ID` salah atau credential tidak punya akses folder (pakai scope `drive` untuk folder yang sudah ada)                   |
| Email backup gagal (`535` / `550`)                      | SMTP Resend: user harus `resend`, password = API key, port 465 SSL; `BACKUP_EMAIL_FROM` harus domain terverifikasi                          |
| Respons backup terpotong / `FUNCTION_PAYLOAD_TOO_LARGE` | Kecilkan `page_size` di node _Ambil backup_ dan pastikan header `Accept-Encoding: gzip` terkirim                                            |
| Calendar sync `Google Calendar belum terhubung`         | User mencabut akses di akun Google; hubungkan ulang di Pengaturan                                                                           |
| Automation tercatat gagal `Webhook 401`                 | `?token=` di URL tidak sama dengan `AUTOMATION_WEBHOOK_TOKEN`, atau workflow 06 belum aktif (URL `/webhook-test/` hanya untuk mode test)    |

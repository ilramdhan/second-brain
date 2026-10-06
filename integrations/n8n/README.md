# Template workflow n8n — Second Brain

Workflow [n8n](https://n8n.io) siap-impor untuk Second Brain: bot Telegram (teks, `/perintah`, tombol inline, **OCR** foto/dokumen, **transkripsi** voice note), pengingat & digest terjadwal, maintenance harian, error alert, **backup otomatis ke Google Drive + email (Resend)**, penerima webhook Automations, sinkronisasi Google Calendar, dan email → Inbox.

**Prinsip:** n8n hanya _relay tipis_. Semua logika domain (NLP tanggal `src/lib/nlp.ts`, AI ringkasan `src/lib/ai.server.ts`, aturan task/note/inbox, soft delete, akses proyek bersama, automations) tetap di web app, di belakang endpoint `/api/public/n8n/*` yang dilindungi header `x-api-key` = `N8N_API_KEY`. n8n menambah hal yang memang berbasis file/jadwal: unduh file Telegram, OCR/transkripsi, jadwal, Google Drive, Gmail/IMAP, SMTP.

**Kenapa jadwal di n8n:** Vercel Hobby hanya mengizinkan cron 1×/hari dan fungsi berdurasi pendek; Supabase Free tidak menyediakan backup yang bisa diunduh dan tidak menjamin pg_cron. Karena itu pengingat (15 menit), digest, maintenance dan backup dipicu dari n8n self-hosted. Vercel Cron dan pg_cron hanya fallback (lihat [Fallback tanpa n8n](#fallback-tanpa-n8n)).

## Daftar workflow

| File                                        | Fungsi                                                                                                                                                                                                                             | Env (n8n)                                                                                                                        | Credentials ("Second Brain …")           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `01-second-brain-telegram-bot.json`         | Bot mode n8n: teks & `/today /inbox /task /note /done /search /sum …`, tombol inline, foto/gambar/PDF → OCR, voice/audio → transkripsi → `POST /n8n/bot`                                                                           | `SB_APP_URL`, `SB_TELEGRAM_BOT_TOKEN`, `SB_TELEGRAM_ALLOWED_CHAT_IDS`, `SB_AI_*`\*                                               | Telegram Bot, x-api-key, AI key (Gemini) |
| `02-second-brain-schedules.json`            | Pengingat (15 mnt), digest pagi 07:00, overdue 12:30 (Sen–Jum), malam 20:30, weekly Minggu 18:00, maintenance 03:00. Node fallback `hooks/reminders` (disabled)                                                                    | `SB_APP_URL`, `SB_TELEGRAM_BOT_TOKEN`, `SB_TELEGRAM_ALLOWED_CHAT_IDS`, `SB_REMINDER_LEAD_MINUTES`\*, `SB_TRASH_RETENTION_DAYS`\* | x-api-key                                |
| `03-second-brain-error-handler.json`        | Alert Telegram ke admin saat workflow lain gagal + log ke `activity_logs` (`POST /n8n/events`)                                                                                                                                     | `SB_APP_URL`, `SB_TELEGRAM_BOT_TOKEN`, `SB_TELEGRAM_ADMIN_CHAT_ID`                                                               | x-api-key                                |
| `04-second-brain-setup-commands.json`       | Manual sekali: `setMyCommands`, `getMe`, `getWebhookInfo`; `setWebhook → app` & `deleteWebhook` (disabled)                                                                                                                         | `SB_TELEGRAM_BOT_TOKEN`, `SB_APP_URL`, `SB_TELEGRAM_WEBHOOK_SECRET`\*                                                            | —                                        |
| `05-second-brain-backup.json`               | Harian/mingguan → `GET /n8n/backup` (berhalaman, gzip) → `.json.gz` ke Google Drive → rotasi → email ringkasan via Resend SMTP → alert gagal (Telegram + email)                                                                    | `SB_APP_URL`, `SB_BACKUP_*`, `SB_TELEGRAM_BOT_TOKEN`, `SB_TELEGRAM_ADMIN_CHAT_ID`                                                | x-api-key, Google Drive, Resend SMTP     |
| `06-second-brain-automation-webhook.json`   | Target aksi **Kirim webhook** di halaman Automations → Telegram admin / Google Sheets / Discord-Slack                                                                                                                              | `SB_AUTOMATION_WEBHOOK_TOKEN`, `SB_TELEGRAM_BOT_TOKEN`, `SB_TELEGRAM_ADMIN_CHAT_ID`, `SB_DISCORD_WEBHOOK_URL`\*, `SB_APP_URL`    | (Google Sheets)                          |
| `07-second-brain-calendar-sync.json`        | Tiap 30 mnt `POST /n8n/calendar/sync` (app → Google, token OAuth per user di server); opsional Google → app (event `#task` → tugas)                                                                                                | `SB_APP_URL`, `SB_CALENDAR_SYNC_MODE`\*, `SB_TELEGRAM_BOT_TOKEN`, `SB_TELEGRAM_ADMIN_CHAT_ID`, `SB_OWNER_EMAIL`\*                | x-api-key, (Google Calendar (owner))     |
| `08-second-brain-email-to-inbox.json`       | Email (**Gmail Trigger** OAuth2, tiap menit, `in:inbox is:unread`, pengirim di allow-list) → Inbox / tugas (`task: …`) / catatan (`note: …`), ringkasan AI untuk email panjang; lalu tandai dibaca + label `SecondBrain/Processed` | `SB_APP_URL`, `SB_EMAIL_ALLOWED_SENDERS`, `SB_GMAIL_PROCESSED_LABEL`\*                                                           | Gmail (capture), x-api-key               |
| `08b-second-brain-email-to-inbox-imap.json` | Alternatif 08 untuk penyedia **non-Gmail** (IMAP, format Resolved, tandai dibaca); payload & allow-list sama. Aktifkan salah satu saja                                                                                             | `SB_APP_URL`, `SB_EMAIL_ALLOWED_SENDERS`                                                                                         | IMAP Inbox, x-api-key                    |
| `09-second-brain-demo-reset.json`           | **Hanya deployment demo** (opsional; Vercel Cron demo sudah melakukannya): tiap hari 00:00 WIB `POST /n8n/demo/reset` → akun demo dibuat bila belum ada, data akun demo dihapus permanen dan diisi ulang. Lihat `docs/DEMO.md`     | `SB_DEMO_APP_URL`                                                                                                                | Demo API                                 |

\* opsional. Nama node berbahasa Indonesia, sticky note menjelaskan alur di dalam tiap workflow.

## Instance n8n bersama

Template ini aman dipasang di **satu instance n8n yang juga menjalankan aplikasi lain** (mis. Dompetku dengan bot Telegram sendiri):

- **Env n8n berprefix `SB_`.** `$env` di n8n bersifat global untuk semua workflow, jadi nama generik seperti `TELEGRAM_BOT_TOKEN` atau `BACKUP_EMAIL_TO` akan bertabrakan dengan aplikasi lain. Template hanya membaca `SB_*` plus variabel global n8n (`GENERIC_TIMEZONE`, `N8N_BLOCK_ENV_ACCESS_IN_NODE`, `WEBHOOK_URL`). `node scripts/check-n8n.mjs` (CI) menolak `$env` tanpa prefix.
- **Credential bernama "Second Brain …"** (Telegram Bot, x-api-key, AI key (Gemini), Google Drive, Resend SMTP, …) agar mudah dibedakan dari credential aplikasi lain saat memilih di node.
- **Path webhook unik:** webhook automation memakai path `second-brain-automation`; Telegram Trigger memakai `webhookId` acak (URL `…/webhook/<uuid>/webhook`). Tiap bot Telegram hanya punya satu webhook, jadi Second Brain wajib memakai **bot sendiri** (token berbeda dari bot aplikasi lain).
- **Error workflow** "Second Brain – Error Handler" hanya dipasang di workflow Second Brain; alert-nya ke `SB_TELEGRAM_ADMIN_CHAT_ID` lewat bot Second Brain.
- Env sisi **web app** (Vercel) tetap tanpa prefix (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SECOND_BRAIN_CRON_SECRET`, `AI_*`, …) karena app punya environment sendiri.

## Variabel lingkungan n8n

| Variabel                        | Contoh / default                                          | Keterangan                                                                                                       |
| ------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE`  | `false`                                                   | **Wajib** agar `$env.*` bisa dibaca di node (global n8n)                                                         |
| `GENERIC_TIMEZONE`              | `Asia/Jakarta`                                            | Zona waktu jadwal (global n8n; samakan dengan `APP_TIMEZONE` di app)                                             |
| `WEBHOOK_URL`                   | `https://n8n.domain.com/`                                 | URL publik HTTPS n8n (global n8n; dipakai Telegram Trigger & webhook 06)                                         |
| `SB_APP_URL`                    | `https://2ndbrain.ilramdhan.dev`                          | Base URL app, tanpa `/` di akhir                                                                                 |
| `SB_TELEGRAM_BOT_TOKEN`         | `123456:ABC…`                                             | Token bot Second Brain dari @BotFather (nilai sama dengan `TELEGRAM_BOT_TOKEN` app)                              |
| `SB_TELEGRAM_ALLOWED_CHAT_IDS`  | `11111111,22222222`                                       | Allow-list chat; **kosong = tolak semua** (fail-closed)                                                          |
| `SB_TELEGRAM_ADMIN_CHAT_ID`     | `11111111`                                                | Penerima alert error/automation/backup                                                                           |
| `SB_TELEGRAM_WEBHOOK_SECRET`    | string acak 32+ karakter                                  | Hanya untuk mode app (node `setWebhook → app` di 04); nilai sama dengan `TELEGRAM_WEBHOOK_SECRET` app            |
| `SB_AI_BASE_URL`                | `https://generativelanguage.googleapis.com/v1beta/openai` | Opsional: host API kompatibel OpenAI untuk OCR/transkripsi (default Gemini; OpenAI: `https://api.openai.com/v1`) |
| `SB_AI_VISION_MODEL`            | `gemini-3.8-flash`                                        | Model OCR (OpenAI: `gpt-4.1-mini`)                                                                               |
| `SB_AI_TRANSCRIBE_MODEL`        | `gemini-3.8-flash`                                        | Model transkripsi (mode `transcriptions`: `whisper-large-v3-turbo` Groq, `gpt-4o-mini-transcribe` OpenAI)        |
| `SB_AI_TRANSCRIBE_BASE_URL`     | = `SB_AI_BASE_URL`                                        | Opsional: host khusus transkripsi, mis. Groq `https://api.groq.com/openai/v1`                                    |
| `SB_AI_OCR_MODE`                | `chat`                                                    | `chat` (Chat Completions + `image_url`; Gemini & OpenAI) atau `responses` (OpenAI Responses API, khusus OpenAI)  |
| `SB_AI_TRANSCRIBE_MODE`         | `chat`                                                    | `chat` (Chat Completions + `input_audio`; Gemini) atau `transcriptions` (`/audio/transcriptions`; OpenAI/Groq)   |
| `SB_REMINDER_LEAD_MINUTES`      | `60`                                                      | Pengingat dikirim N menit sebelum tenggat                                                                        |
| `SB_TRASH_RETENTION_DAYS`       | `30`                                                      | Maintenance: hapus permanen sampah lebih tua dari N hari                                                         |
| `SB_CRON_SECRET`                | nilai `SECOND_BRAIN_CRON_SECRET` app                      | Hanya untuk node fallback `hooks/reminders` (02, disabled)                                                       |
| `SB_BACKUP_FREQUENCY`           | `daily`                                                   | `daily` atau `weekly`                                                                                            |
| `SB_BACKUP_HOUR`                | `2`                                                       | Jam backup (0–23, zona `GENERIC_TIMEZONE`)                                                                       |
| `SB_BACKUP_WEEKDAY`             | `0`                                                       | Hari backup bila `weekly` (0 = Minggu … 6 = Sabtu)                                                               |
| `SB_BACKUP_DRIVE_FOLDER_ID`     | `1AbC…`                                                   | **Wajib** untuk 05: ID folder Google Drive (dari URL folder)                                                     |
| `SB_BACKUP_RETENTION`           | `14`                                                      | Jumlah file backup terbaru yang disimpan                                                                         |
| `SB_BACKUP_EMAIL_FROM`          | `Second Brain <backup@domain.com>`                        | Pengirim (domain terverifikasi di Resend)                                                                        |
| `SB_BACKUP_EMAIL_TO`            | `anda@email.com`                                          | Penerima ringkasan & alert                                                                                       |
| `SB_BACKUP_EMAIL_ATTACH_MAX_MB` | `5`                                                       | Lampirkan `.json.gz` bila ≤ N MB (`0` = tanpa lampiran; batas Resend 40 MB total)                                |
| `SB_BACKUP_INCLUDE_VERSIONS`    | `0`                                                       | `1` = sertakan `note_versions` (file lebih besar)                                                                |
| `SB_CALENDAR_SYNC_MODE`         | `linked`                                                  | `linked` = hanya tugas yang pernah dikirim ke Google; `all` = semua tugas bertanggal                             |
| `SB_AUTOMATION_WEBHOOK_TOKEN`   | string acak 32+ karakter                                  | Token `?token=` di URL webhook automation (06)                                                                   |
| `SB_DISCORD_WEBHOOK_URL`        |                                                           | Opsional, cabang Discord/Slack (06)                                                                              |
| `SB_OWNER_EMAIL`                | `anda@email.com`                                          | Akun pemilik untuk Google → app (07)                                                                             |
| `SB_EMAIL_ALLOWED_SENDERS`      | `anda@email.com,kantor@email.com`                         | Allow-list pengirim email (08, 08b); kosong = tolak semua                                                        |
| `SB_GMAIL_PROCESSED_LABEL`      | `SecondBrain/Processed`                                   | Nama label Gmail yang ditambahkan setelah capture sukses (08); label harus sudah dibuat di Gmail                 |
| `SB_DEMO_APP_URL`               | `https://demo-2ndbrain.ilramdhan.dev`                     | Hanya 09: base URL deployment **demo** (`APP_MODE=demo`), tanpa `/` di akhir                                     |

Contoh blok `environment:` Docker Compose (instance bersama):

```yaml
environment:
  - GENERIC_TIMEZONE=Asia/Jakarta
  - N8N_BLOCK_ENV_ACCESS_IN_NODE=false
  - WEBHOOK_URL=https://n8n.domain.com/
  # Second Brain
  - SB_APP_URL=https://2ndbrain.ilramdhan.dev
  - SB_TELEGRAM_BOT_TOKEN=${SB_TELEGRAM_BOT_TOKEN}
  - SB_TELEGRAM_ALLOWED_CHAT_IDS=11111111
  - SB_TELEGRAM_ADMIN_CHAT_ID=11111111
  - SB_BACKUP_DRIVE_FOLDER_ID=1AbC…
  - SB_BACKUP_EMAIL_FROM=Second Brain <backup@domain.com>
  - SB_BACKUP_EMAIL_TO=anda@email.com
  - SB_AUTOMATION_WEBHOOK_TOKEN=${SB_AUTOMATION_WEBHOOK_TOKEN}
  - SB_EMAIL_ALLOWED_SENDERS=anda@email.com
  # Aplikasi lain (mis. Dompetku) tetap memakai nama/prefix-nya sendiri
```

Di sisi **web app** (Vercel → Environment Variables) set `N8N_API_KEY` (`openssl rand -hex 32`; `N8N_API_KEY_PREVIOUS` saat rotasi), `TELEGRAM_BOT_TOKEN`, `APP_TIMEZONE`, dan bila memakai mode app `TELEGRAM_WEBHOOK_SECRET`. Daftar lengkap: `.env.example`.

## Credentials

| Credential n8n (tipe — nama)                                        | Isi                                                                                                                                | Dipakai di                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Telegram API** — "Second Brain Telegram Bot"                      | Access Token = token BotFather bot Second Brain                                                                                    | 01 (trigger)                |
| **Header Auth** — "Second Brain x-api-key"                          | Name `x-api-key`, Value = `N8N_API_KEY` app                                                                                        | 01, 02, 03, 05, 07, 08, 08b |
| **Header Auth** — "Second Brain AI key (Gemini)"                    | Name `Authorization`, Value = `Bearer <API key AI Studio>` (OpenAI/Groq: `Bearer <key>` juga)                                      | 01 (OCR + transkripsi)      |
| **Google Drive OAuth2** — "Second Brain Google Drive"               | OAuth client Google Cloud (Drive API aktif), scope `drive.file` cukup bila folder dibuat oleh n8n; `drive` bila folder sudah ada   | 05                          |
| **SMTP** — "Second Brain Resend SMTP"                               | Host `smtp.resend.com`, Port `465`, SSL/TLS **on**, User `resend`, Password = Resend API key (`re_…`)                              | 05                          |
| **Google Sheets OAuth2** — "Second Brain Google Sheets"             |                                                                                                                                    | 06 (disabled)               |
| **Google Calendar OAuth2** — "Second Brain Google Calendar (owner)" | akun pemilik                                                                                                                       | 07 (Google → app, disabled) |
| **Gmail OAuth2** — "Second Brain Gmail (capture)"                   | OAuth client Google Cloud (Gmail API aktif), login sebagai kotak masuk capture; lihat [Gmail (email → Inbox)](#gmail-email--inbox) | 08                          |
| **Header Auth** — "Second Brain Demo API"                           | Name `x-api-key`, Value = `N8N_API_KEY` project Vercel **demo** (berbeda dari produksi)                                            | 09                          |
| **IMAP** — "Second Brain IMAP Inbox"                                | kotak masuk non-Gmail khusus capture (host/port SSL penyedia)                                                                      | 08b                         |

Semua credential di JSON bertanda `"id": "REPLACE_ME"`; setelah impor, buka node bertanda ⚠️ dan pilih credential yang benar. Ganti juga `REPLACE_ME_SHEET_ID` (06).

### Google Drive (backup)

1. Google Cloud console → project (boleh sama dengan OAuth Calendar app) → _APIs & Services → Library_ → aktifkan **Google Drive API**.
2. _Credentials → OAuth client ID → Web application_, redirect URI = URL OAuth callback n8n (tampil di dialog credential n8n, mis. `https://n8n.domain.com/rest/oauth2-credential/callback`).
3. Di n8n buat credential **Google Drive OAuth2 API** "Second Brain Google Drive" dengan client ID/secret tersebut → _Sign in with Google_.
4. Buat folder di Drive, salin ID-nya dari URL (`drive.google.com/drive/folders/<ID>`) ke `SB_BACKUP_DRIVE_FOLDER_ID`.

### Gmail (email → Inbox)

1. Google Cloud console → project (boleh sama dengan Drive/Calendar) → _APIs & Services → Library_ → aktifkan **Gmail API**.
2. _OAuth consent screen_: tambahkan akun kotak masuk capture sebagai _test user_ (atau publish app). Mode _Testing_ membuat refresh token kedaluwarsa setelah 7 hari.
3. _Credentials → OAuth client ID → Web application_, redirect URI `https://n8n-sumopod.ilramdhan.dev/rest/oauth2-credential/callback` (sesuaikan dengan domain n8n Anda; nilainya tampil di dialog credential n8n).
4. Di n8n buat credential **Gmail OAuth2 API** "Second Brain Gmail (capture)" dengan client ID/secret tersebut → _Sign in with Google_ memakai akun kotak masuk capture. Scope bawaan n8n sudah mencakup yang dibutuhkan: `https://www.googleapis.com/auth/gmail.modify` (baca isi email, tandai dibaca, tambah label) dan `https://www.googleapis.com/auth/gmail.labels` (daftar label).
5. Di Gmail buat label `SecondBrain/Processed` (label `Processed` di bawah induk `SecondBrain`). Nama lain: set `SB_GMAIL_PROCESSED_LABEL`. Bila label tidak ditemukan, workflow tetap menandai email dibaca tetapi melewati langkah label.
6. Impor `08-second-brain-email-to-inbox.json`, pilih credential di keempat node Gmail, lalu nonaktifkan/hapus workflow IMAP lama (jangan menjalankan 08 dan 08b untuk kotak masuk yang sama).

Alur: email belum dibaca dari pengirim di allow-list → `POST /n8n/capture` → **setelah Capture sukses** → _Tandai dibaca_ → _Tambah label Processed_. Bila Capture gagal, email tetap belum dibaca dan diambil lagi pada polling berikutnya (`external_id` mencegah duplikat). Email dari pengirim di luar allow-list tidak disentuh.

### Resend SMTP (email backup & alert)

1. [resend.com](https://resend.com) → _Domains_ → tambah & verifikasi domain (SPF/DKIM). Paket gratis: 3.000 email/bulan, 100/hari.
2. _API Keys_ → buat key dengan izin **Sending access**.
3. Credential n8n **SMTP** "Second Brain Resend SMTP": host `smtp.resend.com`, port `465`, SSL on, user `resend`, password = API key. `SB_BACKUP_EMAIL_FROM` harus memakai domain terverifikasi.

## Langkah impor

1. Set env di atas pada n8n (Docker: `environment:` / `.env`), termasuk `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` dan `GENERIC_TIMEZONE`, lalu restart n8n. n8n harus bisa diakses via HTTPS publik (`WEBHOOK_URL`).
2. Buat credential (tabel di atas, semua bernama "Second Brain …").
3. **Workflows → Import from File** dengan urutan: **03** (error handler) → **04** → **01** → **02** → **05** → **06** → **07** → **08** (atau **08b** untuk non-Gmail). **09** hanya bila Anda menjalankan deployment demo.
4. Di tiap workflow 01, 02, 05, 06, 07, 08/08b: **Settings → Error workflow = "Second Brain – Error Handler"**.
5. Ganti credential `REPLACE_ME`, simpan, jalankan **04** secara manual, lalu **Activate** workflow lain.
6. Uji: kirim `/help` ke bot (01), _Execute workflow_ manual di 05 (pakai trigger **Jalankan manual**) dan cek file di Drive + email.

**Upgrade dari template lama (env tanpa prefix):** impor ulang semua workflow (hapus/arsipkan versi lama agar tidak ada dua Telegram Trigger), ganti nama env n8n: `SECOND_BRAIN_URL` → `SB_APP_URL`, `SECOND_BRAIN_CRON_SECRET` → `SB_CRON_SECRET`, `SECOND_BRAIN_OWNER_EMAIL` → `SB_OWNER_EMAIL`, `OPENAI_BASE_URL` → `SB_AI_BASE_URL`, `OPENAI_VISION_MODEL` → `SB_AI_VISION_MODEL`, `OPENAI_TRANSCRIBE_MODEL` → `SB_AI_TRANSCRIBE_MODEL`, `OPENAI_TRANSCRIBE_BASE_URL` → `SB_AI_TRANSCRIBE_BASE_URL`, `N8N_OCR_MODE` → `SB_AI_OCR_MODE`, `N8N_TRANSCRIBE_MODE` → `SB_AI_TRANSCRIBE_MODE`, dan sisanya cukup diberi prefix `SB_` (`TELEGRAM_*`, `BACKUP_*`, `REMINDER_LEAD_MINUTES`, `TRASH_RETENTION_DAYS`, `AUTOMATION_WEBHOOK_TOKEN`, `DISCORD_WEBHOOK_URL`, `CALENDAR_SYNC_MODE`, `EMAIL_ALLOWED_SENDERS`). Credential OpenAI lama diganti Header Auth "Second Brain AI key (Gemini)". Default AI kini Gemini + mode `chat`; untuk tetap di OpenAI set `SB_AI_BASE_URL=https://api.openai.com/v1` dan model OpenAI. Env web app tidak berubah.

## Mengganti domain n8n

App **tidak pernah memanggil n8n** (n8n yang memanggil `/api/public/n8n/*`; tidak ada env URL n8n di app/Vercel). Satu-satunya tempat URL n8n tersimpan di app adalah data: URL aksi webhook di halaman Automations. Langkah:

1. Ubah env global n8n: `WEBHOOK_URL=https://n8n-baru.domain.com/`, `N8N_HOST=n8n-baru.domain.com`, `N8N_PROTOCOL=https`, `N8N_EDITOR_BASE_URL=https://n8n-baru.domain.com/`; perbarui reverse proxy/TLS, lalu restart n8n.
2. **Deactivate → Activate** workflow **01** agar Telegram Trigger mendaftarkan ulang webhook bot ke domain baru (cek dengan `getWebhookInfo` di 04).
3. Google Cloud console → OAuth client yang dipakai credential "Second Brain Google Drive" (dan Sheets/Calendar bila dipakai) → tambahkan redirect URI `https://n8n-baru.domain.com/rest/oauth2-credential/callback`, lalu buka credential di n8n dan _Sign in with Google_ ulang.
4. Di app, **Automations** → aturan dengan aksi **Kirim webhook** → ganti host di URL `https://n8n-baru.domain.com/webhook/second-brain-automation?token=…`.
5. Vercel: **tidak ada yang perlu diubah**.

## Setup bot Telegram

1. @BotFather → `/newbot` (bot khusus Second Brain, jangan pakai ulang bot aplikasi lain) → simpan token ke `TELEGRAM_BOT_TOKEN` (app) **dan** `SB_TELEGRAM_BOT_TOKEN` (n8n), username ke `TELEGRAM_BOT_USERNAME` (app, opsional untuk tombol deep link). Opsional: `/setprivacy` → _Disable_ bila bot dipakai di grup.
2. Ketahui chat ID Anda (kirim pesan ke @userinfobot) → isi `SB_TELEGRAM_ALLOWED_CHAT_IDS` & `SB_TELEGRAM_ADMIN_CHAT_ID`.
3. Pilih **mode bot** (satu bot hanya punya satu webhook):

   | Mode                 | Cara                                                                                                                                              | Kelebihan                                        |
   | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
   | **n8n (disarankan)** | Activate workflow 01 — Telegram Trigger otomatis `setWebhook` ke n8n → app `/api/public/n8n/bot`                                                  | OCR, voice, tombol inline, semua perintah        |
   | **App**              | Jangan aktifkan 01; set `TELEGRAM_WEBHOOK_SECRET` di app (nilai sama di `SB_TELEGRAM_WEBHOOK_SECRET` n8n), jalankan node `setWebhook → app` di 04 | Tanpa n8n; hanya `/start`, `/link`, teks → Inbox |

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

Workflow 01 memanggil API **kompatibel OpenAI** lewat node HTTP Request biasa (tanpa node/credential OpenAI bawaan n8n), dengan default **Google Gemini (AI Studio)**. Provider bisa diganti tanpa mengubah kontrak ke app, karena app hanya menerima `ocr_text`/`transcript`:

| Kebutuhan              | Default di template                                                                         | Alternatif                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR foto/gambar/PDF    | Node **AI OCR (Gemini)**: `POST {SB_AI_BASE_URL}/chat/completions` + `image_url` (data URL) | OpenAI (`SB_AI_BASE_URL=https://api.openai.com/v1`, `gpt-4.1-mini`; `SB_AI_OCR_MODE=responses` untuk PDF via `input_file`), Mistral OCR (`POST https://api.mistral.ai/v1/ocr`), Google Cloud Vision, Tesseract self-hosted (gratis) |
| Transkripsi            | Node **AI Transcribe (Gemini)**: Chat Completions + `input_audio` (`gemini-3.8-flash`)      | `SB_AI_TRANSCRIBE_MODE=transcriptions` → node **AI Transcribe (Whisper API)** `POST {base}/audio/transcriptions`: Groq Whisper (`whisper-large-v3-turbo`, murah/cepat), OpenAI (`gpt-4o-mini-transcribe`, `whisper-1`)              |
| Ringkasan / capture AI | Di server (provider `AI_*`, `ai.server.ts`) — **bukan** di n8n                              | —                                                                                                                                                                                                                                   |

OCR tidak dijalankan untuk teks biasa, sehingga biaya hanya muncul saat mengirim file (Gemini Flash punya kuota gratis AI Studio; cek harga terbaru provider). Batasi dengan allow-list dan batas ukuran file (19 MB, batas `getFile` Telegram). Endpoint `/n8n/bot` sengaja hanya menerima teks (body ≤ 1 MB); kirim file ke provider OCR/transkripsi dari n8n, bukan ke app (batas body serverless ±4,5 MB).

### Memakai Google Gemini (AI Studio) — default

Gemini punya API kompatibel OpenAI di `https://generativelanguage.googleapis.com/v1beta/openai` yang mendukung Chat Completions (termasuk `image_url` data URL dan `input_audio`) dengan header `Authorization: Bearer <key>`, **tetapi tidak** `/responses` maupun `/audio/transcriptions`.

1. [aistudio.google.com](https://aistudio.google.com) → _Get API key_.
2. Credential n8n **Header Auth** "Second Brain AI key (Gemini)": Name `Authorization`, Value `Bearer <API key>`. Pilih credential ini di node **AI OCR (Gemini)**, **AI Transcribe (Gemini)** dan **AI Transcribe (Whisper API)**.
3. Env n8n: tidak wajib — default `SB_AI_BASE_URL` = host Gemini, `SB_AI_VISION_MODEL` = `SB_AI_TRANSCRIBE_MODEL` = `gemini-3.8-flash`, `SB_AI_OCR_MODE` = `SB_AI_TRANSCRIBE_MODE` = `chat`.
4. Voice → _Transcribe via chat?_ → _Prepare transcribe (chat)_ → `POST {base}/chat/completions` dengan `input_audio` (`format: ogg` untuk voice note Telegram; Gemini menerima ogg/webm/mp3/wav/m4a/aac/flac/opus) dan prompt "Transcribe this audio verbatim; reply with the transcript only."

**Tetap memakai OpenAI:** `SB_AI_BASE_URL=https://api.openai.com/v1`, `SB_AI_VISION_MODEL=gpt-4.1-mini`, lalu salah satu: `SB_AI_TRANSCRIBE_MODE=transcriptions` + `SB_AI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe`, atau tetap `chat` dengan model audio (`gpt-4o-audio-preview`). Value credential = `Bearer sk-…`.

**Alternatif voice: Groq Whisper** (free tier, cepat) sementara Gemini menangani OCR: set `SB_AI_TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1`, `SB_AI_TRANSCRIBE_MODEL=whisper-large-v3-turbo`, `SB_AI_TRANSCRIBE_MODE=transcriptions`, lalu buat credential Header Auth kedua ("Second Brain AI key (Groq)", `Bearer gsk_…`) dan pilih di node **AI Transcribe (Whisper API)**. Di web app padanannya `AI_TRANSCRIBE_MODE`, `AI_TRANSCRIBE_BASE_URL`, `AI_TRANSCRIBE_API_KEY` (lihat `.env.example`).

## Endpoint backend

Semua endpoint ada di `src/routes/api/public/n8n/*` (logika di `src/server/n8n/*`). Aturan umum:

- Auth: header `x-api-key` dibandingkan dengan `N8N_API_KEY` (atau `N8N_API_KEY_PREVIOUS`) secara constant-time; salah/absen → `401 {"error":"unauthorized"}`; env kosong → `500 {"error":"N8N_API_KEY not configured"}`.
- Body/query divalidasi `zod`; error → `400 {"error":"<field>: <pesan>"}`; body > 1 MB → `413`; error tak terduga → `500 {"error":"internal error"}` (detail hanya di log server).
- Server memakai `supabaseAdmin` hanya di handler ini dan **selalu memfilter user** yang dipetakan (`profiles.telegram_chat_id` atau email akun): baris milik user + tugas/catatan proyek yang ia miliki atau ikuti. Baris `deleted_at`/`archived_at` dikecualikan seperti hook di `src/lib/data.ts`.
- Idempoten: tabel `n8n_events (source, external_id)` menyimpan respons pertama untuk `update_id` Telegram / `external_id` capture; retry mendapat respons yang sama. Kegagalan melepas klaim agar retry bisa memproses ulang.
- Pembuatan/ubah tugas memakai aturan yang sama dengan `useTaskActions` di server: blocked check, auto-shift dependents saat snooze, recurrence, notifikasi unblock, dan automations (`runAutomationRules`).
- Respons Telegram **tidak** dikirim oleh server (kecuali notifikasi automations/unblock); server mengembalikan instruksi balasan, n8n yang mengirim.
- Tanggal "hari ini" mengikuti `APP_TIMEZONE` (default `Asia/Jakarta`).

| Method & path                            | Auth                                                              | Workflow             |
| ---------------------------------------- | ----------------------------------------------------------------- | -------------------- |
| `POST /api/public/n8n/bot`               | `x-api-key`                                                       | 01                   |
| `POST /api/public/n8n/capture`           | `x-api-key`                                                       | 07, 08, 08b          |
| `GET /api/public/n8n/digest`             | `x-api-key`                                                       | 02                   |
| `POST /api/public/n8n/reminders`         | `x-api-key`                                                       | 02                   |
| `POST /api/public/n8n/maintenance`       | `x-api-key`                                                       | 02                   |
| `GET /api/public/n8n/backup`             | `x-api-key`                                                       | 05                   |
| `POST /api/public/n8n/calendar/sync`     | `x-api-key`                                                       | 07                   |
| `POST /api/public/n8n/events`            | `x-api-key`                                                       | 03                   |
| `GET`/`POST /api/public/n8n/demo/reset`  | `x-api-key` (POST) atau `Authorization: Bearer <CRON_SECRET>`     | 09, Vercel Cron demo |
| `POST /api/public/telegram/webhook`      | `x-telegram-bot-api-secret-token`                                 | mode app             |
| `GET`/`POST /api/public/hooks/reminders` | `Authorization: Bearer <SECOND_BRAIN_CRON_SECRET \| CRON_SECRET>` | fallback             |

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

### `POST /api/public/n8n/demo/reset`

Hanya ada bila `APP_MODE=demo`; di deployment lain selalu `404 {"error":"not found"}` (dicek sebelum auth). Auth: `POST` dengan `x-api-key` (workflow 09) **atau** `GET`/`POST` dengan `Authorization: Bearer <CRON_SECRET>` (Vercel Cron di project demo, `0 17 * * *` UTC = 00:00 WIB, didaftarkan oleh `vite.config.ts` hanya pada build demo). Body diabaikan.

Langkah: `ensureDemoUser()` (buat akun demo + dua akun rekan tim contoh bila belum ada, lalu `app_config` `demo_user_email` dan `demo_mode = 'on'`) → hapus permanen semua baris milik akun demo (urutan FK) → isi ulang data contoh untuk semua halaman dengan tanggal relatif hari ini (`APP_TIMEZONE`). Idempoten.

Response `{ "ok": true, "user_id": "…", "created_user": false, "today": "2026-10-06", "inserted": { "tasks": 48, … }, "ms": 2400 }`; gagal → `500 {"error":"reset failed"}` (detail di log). Panduan lengkap: [`docs/DEMO.md`](../../docs/DEMO.md).

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
- **Webhook secret:** mode app wajib `TELEGRAM_WEBHOOK_SECRET` di app (app menolak dengan 401 jika env kosong atau header tidak cocok; constant-time). Telegram Trigger n8n memakai path acak (`webhookId`); jangan bagikan URL-nya.
- Webhook automation (06) memakai `?token=`; gunakan string acak panjang, rotasi bila bocor. Aksi webhook di app hanya menerima `https` (SSRF guard).
- `N8N_API_KEY` hanya di server app & credential n8n — jangan di env klien (`VITE_*`). Rotasi: set key baru di `N8N_API_KEY`, key lama di `N8N_API_KEY_PREVIOUS`, perbarui credential n8n, lalu hapus key lama.
- n8n tidak pernah menerima token Google user, kunci Supabase, atau `TOKEN_ENCRYPTION_KEY`.
- Eksekusi sukses tidak disimpan (`saveDataSuccessExecution: none`) karena berisi isi pesan/catatan pribadi; backup juga tidak menyimpan eksekusi error (berisi seluruh data). Lindungi folder Drive dan kotak surat backup — file berisi semua data user.
- File OCR/voice dikirim ke provider AI pihak ketiga — informasikan ke pengguna dan hindari dokumen sangat sensitif, atau gunakan OCR self-hosted.

## Troubleshooting

| Gejala                                                                            | Penyebab / solusi                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `access to env vars denied`                                                       | Set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, restart n8n                                                                                                                                                                                                                                                                |
| Bot diam sama sekali                                                              | Chat ID tidak ada di `SB_TELEGRAM_ALLOWED_CHAT_IDS`; atau webhook masih ke app → cek `getWebhookInfo` (04), `deleteWebhook`, aktifkan ulang 01                                                                                                                                                                       |
| `Conflict: can't use getUpdates…` / webhook tertimpa                              | Dua tempat memasang webhook untuk bot yang sama (app + n8n, atau n8n test URL). Pilih satu mode                                                                                                                                                                                                                      |
| Telegram Trigger gagal aktif                                                      | n8n harus HTTPS publik (`WEBHOOK_URL=https://n8n.domain.com/`)                                                                                                                                                                                                                                                       |
| `401 unauthorized` dari app                                                       | Credential Header Auth: Name harus `x-api-key`, Value sama dengan `N8N_API_KEY` di app                                                                                                                                                                                                                               |
| `500 N8N_API_KEY not configured`                                                  | Set `N8N_API_KEY` di Vercel lalu redeploy                                                                                                                                                                                                                                                                            |
| `404 user not found` (capture)                                                    | Email pengirim bukan email akun Second Brain, atau chat belum `/link`                                                                                                                                                                                                                                                |
| "Akun belum terhubung"                                                            | Buat kode di Pengaturan → Bot Telegram, lalu kirim `/link <kode>` di bot                                                                                                                                                                                                                                             |
| OCR kosong / `400` dari provider AI                                               | Model tidak mendukung vision/PDF → ganti `SB_AI_VISION_MODEL`; file > 15 MB; PDF terenkripsi                                                                                                                                                                                                                         |
| Voice gagal                                                                       | Node _Fix audio filename_ mengganti `.oga` → `.ogg`; bila masih ditolak, ganti `SB_AI_TRANSCRIBE_MODEL` ke `whisper-1`                                                                                                                                                                                               |
| Voice `404` dengan Gemini                                                         | Gemini tidak punya `/audio/transcriptions` → `SB_AI_TRANSCRIBE_MODE=chat` (otomatis bila host = Gemini) atau pakai Groq                                                                                                                                                                                              |
| Jadwal meleset 7 jam                                                              | Set `GENERIC_TIMEZONE=Asia/Jakarta` di n8n, `APP_TIMEZONE` di app, dan cek Settings → Timezone workflow                                                                                                                                                                                                              |
| Backup tidak jalan                                                                | 05 hanya lanjut pada `SB_BACKUP_HOUR` (dan `SB_BACKUP_WEEKDAY` untuk weekly); jalankan manual untuk uji. `SB_BACKUP_DRIVE_FOLDER_ID` wajib                                                                                                                                                                           |
| Google Drive `File not found` / `insufficient scope`                              | `SB_BACKUP_DRIVE_FOLDER_ID` salah atau credential tidak punya akses folder (pakai scope `drive` untuk folder yang sudah ada)                                                                                                                                                                                         |
| Email backup gagal (`535` / `550`)                                                | SMTP Resend: user harus `resend`, password = API key, port 465 SSL; `SB_BACKUP_EMAIL_FROM` harus domain terverifikasi                                                                                                                                                                                                |
| Respons backup terpotong / `FUNCTION_PAYLOAD_TOO_LARGE`                           | Kecilkan `page_size` di node _Ambil backup_ dan pastikan header `Accept-Encoding: gzip` terkirim                                                                                                                                                                                                                     |
| Calendar sync `Google Calendar belum terhubung`                                   | User mencabut akses di akun Google; hubungkan ulang di Pengaturan                                                                                                                                                                                                                                                    |
| Automation tercatat gagal `Webhook 401`                                           | `?token=` di URL tidak sama dengan `SB_AUTOMATION_WEBHOOK_TOKEN`, atau workflow 06 belum aktif (URL `/webhook-test/` hanya untuk mode test)                                                                                                                                                                          |
| 08b: `Connection to the IMAP server was lost` / `error fetching new emails`       | Node IMAP harus Format **Resolved** (Simple mengunduh teks di round-trip kedua yang sering diputus server). Jangan klik _Test workflow_ saat 08b aktif (dua sesi IMAP berebut kotak masuk). Untuk Gmail pakai 08 (Gmail Trigger)                                                                                     |
| `Reconnecting to the IMAP server timed out`, lalu workflow email nonaktif sendiri | IMAP Gmail sering memutus koneksi lama (±11 menit); setelah reconnect gagal n8n **menonaktifkan trigger** dan tidak menyalakannya lagi. Gmail: ganti ke 08 (**Gmail Trigger**, polling via Gmail API, tanpa koneksi IMAP) dan nonaktifkan versi IMAP. Non-Gmail: pakai 08b dan aktifkan ulang workflow setelah error |
| 08: email tidak diproses / diproses tiap menit                                    | Pengirim tidak ada di `SB_EMAIL_ALLOWED_SENDERS` (email dibiarkan belum dibaca), atau node _Tandai dibaca_ gagal (cek scope `gmail.modify`); duplikat dicegah `external_id`. Credential Gmail di mode _Testing_ kedaluwarsa tiap 7 hari → publish OAuth consent screen                                               |

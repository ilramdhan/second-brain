import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LOCALE_COOKIE, THEME_COOKIE, writePreferenceCookie } from "./preference-cookies";
import { THEME_STORAGE_KEY } from "./theme-script";

export type Theme = "light" | "dark" | "system";
export type Locale = "id" | "en";

const messages = {
  id: {
    today: "Hari Ini",
    inbox: "Inbox",
    tasks: "Tugas",
    calendar: "Kalender",
    timeline: "Timeline",
    projects: "Proyek",
    notes: "Catatan",
    graph: "Peta Pengetahuan",
    automations: "Otomasi",
    canvas: "Kanvas",
    activity: "Aktivitas",
    settings: "Pengaturan",
    quickCapture: "Tangkap cepat",
    quickTask: "Tugas cepat",
    search: "Cari…",
    signOut: "Keluar",
    menu: "Menu",
    theme: "Tema",
    language: "Bahasa",
    light: "Terang",
    dark: "Gelap",
    system: "Ikuti perangkat",
    appearance: "Tampilan & bahasa",
    saved: "Tersimpan",
    backup: "Backup & pemulihan",
    reports: "Laporan",
    templates: "Template",
    archive: "Arsip & Sampah",
    errGeneric: "Terjadi kesalahan. Coba lagi.",
    errNetwork: "Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.",
    errSession: "Sesi Anda berakhir. Silakan masuk lagi.",
    errForbidden: "Anda tidak punya akses untuk melakukan ini.",
    errOwnerOnly: "Hanya pembuat atau pemilik proyek yang bisa melakukan ini.",
    errDuplicate: "Data ini sudah ada.",
    errReference: "Data terkait tidak ditemukan atau masih dipakai.",
    errInvalid: "Data tidak valid. Periksa isian lalu coba lagi.",
    errNotFound: "Data tidak ditemukan.",
    errRateLimit: "Batas penggunaan AI tercapai. Coba lagi sebentar lagi.",
    errAiNotConfigured: "AI belum dikonfigurasi. Admin perlu mengisi AI_API_KEY.",
    errConfig: "Aplikasi belum dikonfigurasi dengan benar. Hubungi admin.",
    errInvalidLogin: "Email atau kata sandi salah.",
    errEmailNotConfirmed: "Email belum dikonfirmasi. Cek kotak masuk Anda.",
    errUserExists: "Email ini sudah terdaftar. Silakan masuk.",
    errTimeout: "Permintaan terlalu lama. Coba lagi.",
    routeErrorTitle: "Halaman ini gagal dimuat",
    routeErrorBody: "Terjadi kesalahan di halaman ini. Menu lain tetap bisa dipakai.",
    retry: "Coba lagi",
    backToToday: "Kembali ke Hari Ini",
    landingEyebrow: "Open source · PWA · MIT",
    landingTitle: "Otak kedua untuk tugas dan catatan Anda",
    landingSubtitle:
      "Tangkap ide secepat terlintas, biarkan AI merapikannya, lalu kelola tugas, catatan berblok, dan proyek tim di satu tempat.",
    landingSignIn: "Masuk",
    landingGithub: "Lihat di GitHub",
    landingFeatures: "Fitur",
    landingInboxTitle: "Inbox & AI capture",
    landingInboxBody:
      "Ketik, rekam suara, atau foto. AI mengubahnya jadi tugas atau catatan yang rapi.",
    landingTasksTitle: "Tugas di empat tampilan",
    landingTasksBody:
      "List, kanban, kalender, dan timeline dengan dependensi, pengulangan, dan quick add bahasa alami.",
    landingNotesTitle: "Catatan berblok + graph",
    landingNotesBody: "Tautan [[catatan]], referensi ((blok)), query, dan peta pengetahuan.",
    landingCollabTitle: "Kolaborasi real-time",
    landingCollabBody: "Edit catatan bersama tim secara langsung, dengan akses per proyek.",
    landingAutomationsTitle: "Automations",
    landingAutomationsBody:
      "Saat status atau prioritas berubah, jalankan aksi: pindahkan, tandai, atau kirim webhook.",
    landingIntegrationsTitle: "Telegram & Google Calendar",
    landingIntegrationsBody:
      "Tambah tugas dari chat, terima pengingat, dan sinkronkan tenggat ke kalender.",
    landingPwaTitle: "PWA & offline",
    landingPwaBody: "Pasang di layar utama, terasa seperti aplikasi native.",
    landingOssTitle: "Open source (MIT)",
    landingOssBody: "Self-host di Vercel + Supabase. Kodenya terbuka di GitHub.",
    landingFooter: "Dibuat dengan TanStack Start, Supabase, dan Yjs.",
    landingDemo: "Coba Demo",
    landingSkip: "Langsung ke konten",
    landingThemeLabel: "Ganti tema",
    landingLanguageLabel: "Ganti bahasa ke English",
    landingLicense: "Lisensi MIT",
    landingSecurity: "Keamanan & privasi",
    landingNewTab: "(tab baru)",
    landingNavFeatures: "Fitur",
    landingNavHowItWorks: "Cara kerja",
    landingNavIntegrations: "Integrasi",
    landingNavSelfHost: "Self-host",
    landingNavFaq: "FAQ",
    landingMenuLabel: "Menu utama",
    landingMenuOpen: "Buka menu",
    landingMenuDescription: "Navigasi halaman, demo, GitHub, dan masuk.",
    landingNavTech: "Teknologi",
    landingTechTitle: "Dibangun dengan teknologi modern",
    landingTechSubtitle:
      "Stack open source yang teruji, dari framework web hingga database, otomasi, dan pemantauan.",
    landingTechListLabel: "Daftar teknologi",
    landingBackToTop: "Kembali ke atas",
    loginBackHome: "Beranda",
    loginBackHomeLabel: "Kembali ke beranda",
    loginLogoLabel: "Second Brain — beranda",
    landingFeaturesSubtitle:
      "Semua yang Anda perlukan untuk menangkap, merapikan, dan menyelesaikan pekerjaan di satu tempat.",
    landingHowTitle: "Cara kerja",
    landingHowSubtitle:
      "Dari pikiran yang berserakan sampai pekerjaan selesai, dalam empat langkah.",
    landingStep: "Langkah",
    landingStep1Title: "Tangkap apa saja",
    landingStep1Body:
      "Ketik, rekam suara, foto catatan, kirim lewat Telegram atau email. Semuanya masuk ke Inbox.",
    landingStep2Title: "AI merapikan",
    landingStep2Body:
      "AI meringkas dan memecah isi Inbox menjadi tugas dan catatan, lengkap dengan tanggal, prioritas, dan proyek.",
    landingStep3Title: "Rencanakan & kerjakan",
    landingStep3Body:
      "Atur tugas di list, kanban, kalender, atau timeline. Dependensi dan automations menjaga alurnya.",
    landingStep4Title: "Hubungkan pengetahuan",
    landingStep4Body:
      "Catatan berblok saling terhubung lewat [[tautan]] dan ((referensi)), lalu tampil sebagai graph.",
    landingIntTitle: "Integrasi",
    landingIntSubtitle: "Bekerja dengan alat yang sudah Anda pakai. Semuanya opsional.",
    landingIntTelegramTitle: "Bot Telegram",
    landingIntTelegramBody:
      "Tambah tugas, tangkap ide, kirim foto atau voice note, dan terima pengingat serta digest harian.",
    landingIntCalendarTitle: "Google Calendar",
    landingIntCalendarBody:
      "Tugas bertanggal tersinkron ke kalender Anda lewat OAuth milik instance sendiri.",
    landingIntAiTitle: "Provider AI pilihan Anda",
    landingIntAiBody:
      "OpenAI atau API yang kompatibel (Gemini, Groq, OpenRouter) untuk ringkasan, OCR, dan transkripsi.",
    landingIntN8nTitle: "n8n",
    landingIntN8nBody:
      "Workflow siap impor untuk bot, pengingat terjadwal, maintenance, dan email ke Inbox.",
    landingIntBackupTitle: "Backup otomatis",
    landingIntBackupBody:
      "Backup terjadwal ke Google Drive dengan ringkasan email via Resend, plus ekspor JSON manual.",
    landingIntWebhookTitle: "Webhook",
    landingIntWebhookBody:
      "Automations bisa mengirim webhook HTTPS ke layanan lain saat aturan terpenuhi.",
    landingHostTitle: "Self-host dalam tiga langkah",
    landingHostSubtitle:
      "Jalankan instance sendiri di tier gratis Vercel dan Supabase. Data Anda tetap milik Anda.",
    landingHost1Title: "Supabase",
    landingHost1Body:
      "Buat project Supabase (Free), jalankan migration SQL dari repo, dan matikan pendaftaran publik.",
    landingHost2Title: "Vercel",
    landingHost2Body:
      "Impor repo ke Vercel, isi environment variable dari .env.example, lalu deploy.",
    landingHost3Title: "n8n (opsional)",
    landingHost3Body:
      "Impor workflow dari integrations/n8n untuk bot Telegram, pengingat, dan backup terjadwal.",
    landingHostGuide: "Baca panduan self-host",
    landingFaqTitle: "Pertanyaan yang sering diajukan",
    landingFaq1Q: "Apakah Second Brain gratis?",
    landingFaq1A:
      "Ya. Kodenya open source dengan lisensi MIT. Anda hanya membayar layanan yang Anda pakai sendiri (hosting, provider AI), dan semuanya bisa berjalan di tier gratis.",
    landingFaq2Q: "Di mana data saya disimpan?",
    landingFaq2A:
      "Di database Supabase milik pengelola instance. Pada instance self-host, itu project Supabase Anda sendiri. Akses dibatasi Row Level Security per pengguna dan per proyek.",
    landingFaq3Q: "Bagaimana cara mendapatkan akun?",
    landingFaq3A:
      "Pendaftaran publik ditutup secara bawaan. Pemilik instance membuat atau mengundang akun lewat Supabase, dan anggota tim bergabung lewat undangan proyek.",
    landingFaq4Q: "Apakah AI wajib?",
    landingFaq4A:
      "Tidak. Tanpa kunci API, fitur AI dinonaktifkan dan aplikasi tetap berjalan, termasuk parser bahasa alami lokal untuk tugas.",
    landingFaq5Q: "Bisakah dipakai offline?",
    landingFaq5A:
      "Second Brain adalah PWA: bisa dipasang di layar utama, aset aplikasi di-cache, dan halaman yang terakhir dibuka tetap bisa dilihat saat koneksi terputus.",
    landingFaq6Q: "Bagaimana cara menghapus data saya?",
    landingFaq6A:
      "Item yang dihapus masuk sampah dan dibersihkan setelah 30 hari. Untuk menghapus akun beserta seluruh datanya, hubungi pengelola instance. Lihat Kebijakan Privasi.",
    landingFooterPages: "Halaman",
    landingFooterDocs: "Dokumentasi",
    landingFooterLegal: "Legal",
    landingFooterSelfHostGuide: "Panduan self-host",
    landingFooterN8n: "Bot Telegram & n8n",
    landingFooterEnv: "Environment variable",
    landingFooterRelease: "(catatan rilis)",
    landingMadeIn: "Dibuat dengan ♥ di Indonesia",
    legalPrivacy: "Privasi",
    legalTerms: "Ketentuan",
    legalPrivacyTitle: "Kebijakan Privasi",
    legalTermsTitle: "Ketentuan Penggunaan",
    legalUpdated: "Terakhir diperbarui",
    legalToc: "Di halaman ini",
    legalNotAdvice:
      "Dokumen ini adalah templat untuk aplikasi open source yang di-host sendiri, bukan nasihat hukum. Pengelola instance bertanggung jawab menyesuaikannya dengan layanan dan hukum yang berlaku.",
    pwaUpdateAvailable: "Versi baru tersedia",
    pwaReload: "Muat ulang",
    aboutTitle: "Tentang aplikasi",
    aboutSubtitle: "Versi yang sedang berjalan dan tautan proyek.",
    aboutVersion: "Versi",
    aboutCommit: "Commit",
    aboutBuildTime: "Tanggal build",
    aboutUpToDate: "Kamu memakai versi terbaru.",
    aboutUpdateAvailable: "Versi baru tersedia:",
    aboutChecking: "Memeriksa versi terbaru…",
    aboutCheckFailed: "Tidak bisa memeriksa versi terbaru.",
    aboutChangelog: "Catatan rilis",
    aboutRepo: "Repositori GitHub",
    aboutDocs: "Dokumentasi",
    aboutReportBug: "Laporkan bug",
    demoBannerText:
      "Mode demo — data direset setiap hari pukul 00.00 WIB, beberapa fitur dimatikan",
    demoBannerProd: "Pakai versi asli",
    demoBannerGithub: "Kode di GitHub",
    demoBannerLabel: "Pemberitahuan mode demo",
    demoNoticeTitle: "Ini versi demo",
    demoNoticeBody:
      "Semua data di sini adalah data contoh dan direset setiap hari pukul 00.00 WIB. Beberapa fitur (AI asli, Telegram, Google Calendar, webhook, undangan) dimatikan.",
    demoNoticeSelfHost: "Cara self-host",
    demoNoticeDismiss: "Tutup pemberitahuan demo",
    backToTop: "Kembali ke atas",
    demoDisabled: "Tidak tersedia di demo",
    demoLoginHint: "Akun demo:",
    demoAutofill: "Isi otomatis",
    demoSignIn: "Masuk sebagai demo",
    demoAiHint: "Mode demo: respons contoh",
    demoAiExamples: "Contoh",
    demoAiVoiceExample: "Pakai contoh suara",
    demoAiImageExample: "Pakai contoh foto",
    demoAiFillNote: "Isi catatan dengan contoh ini?",
    authForgotLink: "Lupa kata sandi?",
    authForgotTitle: "Atur ulang kata sandi",
    authForgotIntro: "Masukkan email akun Anda. Kami kirim tautan untuk membuat kata sandi baru.",
    authForgotSubmit: "Kirim tautan",
    authForgotSent:
      "Jika email tersebut terdaftar, tautan untuk mengatur kata sandi sudah dikirim. Periksa kotak masuk dan folder spam; tautan berlaku terbatas.",
    authForgotBack: "Kembali ke halaman masuk",
    authEmailLabel: "Email",
    authEmailInvalid: "Email tidak valid.",
    authSending: "Memproses…",
    setPwTitleInvite: "Buat kata sandi",
    setPwTitleRecovery: "Atur ulang kata sandi",
    setPwIntroInvite: "Anda diundang ke Second Brain. Buat kata sandi untuk akun:",
    setPwIntroRecovery: "Masukkan kata sandi baru untuk akun:",
    setPwChecking: "Memeriksa tautan…",
    setPwNew: "Kata sandi baru",
    setPwConfirm: "Ulangi kata sandi",
    setPwShow: "Tampilkan kata sandi",
    setPwMismatch: "Kata sandi tidak sama.",
    setPwTooShort: "Kata sandi minimal 8 karakter.",
    setPwHintsLabel: "Saran kata sandi",
    setPwHintLength: "Minimal 8 karakter",
    setPwHintLetters: "Huruf besar dan kecil",
    setPwHintNumbers: "Angka",
    setPwHintSymbols: "Simbol",
    setPwStrength: "Kekuatan",
    setPwStrength1: "Lemah",
    setPwStrength2: "Cukup",
    setPwStrength3: "Baik",
    setPwStrength4: "Kuat",
    setPwSubmit: "Simpan kata sandi",
    setPwSaved: "Kata sandi tersimpan.",
    setPwSamePassword: "Kata sandi baru harus berbeda dari yang lama.",
    setPwWeakServer:
      "Kata sandi ditolak oleh kebijakan server. Coba yang lebih panjang dan beragam.",
    setPwInvalidTitle: "Tautan tidak valid atau kedaluwarsa",
    setPwInvalidBody:
      "Tautan email hanya bisa dipakai sekali dan berlaku terbatas. Minta tautan baru di bawah. Untuk undangan proyek, Anda juga bisa meminta pemilik proyek menekan Kirim ulang.",
    setPwRequestNew: "Minta tautan baru",
    setPwDemo: "Mengatur kata sandi tidak tersedia di demo karena akun demo dipakai bersama.",
    setPwGoLogin: "Ke halaman masuk",
    teamInvitePlaceholder: "Email anggota tim",
    teamInviteLabel: "Email anggota baru",
    teamInvite: "Undang",
    teamInviteSent:
      "Undangan tersimpan. Bila belum punya akun, orang tersebut menerima email untuk membuat kata sandi; bila sudah, ia bergabung otomatis saat masuk.",
    teamInviteAlreadyMember: "Email ini sudah menjadi anggota proyek.",
    teamInviteEmailLimited:
      "Undangan tersimpan, tapi email belum terkirim (batas email Supabase). Tekan Kirim ulang nanti.",
    teamInviteEmailFailed:
      "Undangan tersimpan, tapi email gagal dikirim. Periksa pengaturan email Supabase, lalu tekan Kirim ulang.",
    teamPendingHeading: "Undangan menunggu",
    teamPending: "Menunggu",
    teamResend: "Kirim ulang",
    teamResent: "Undangan dikirim ulang.",
    teamRevoke: "Batalkan undangan",
    teamRevokeConfirm: "Batalkan undangan untuk email ini?",
    teamRevoked: "Undangan dibatalkan.",
    teamMemberNote: "Anda anggota proyek ini. Hanya pemilik yang bisa mengundang orang.",
    teamInviteHint:
      "Undangan menunggu sampai orang tersebut masuk. Tautan di email kedaluwarsa setelah beberapa waktu; tekan Kirim ulang untuk tautan baru.",
    searchPlaceholder: "Cari tugas, proyek, catatan…",
    searchPlaceholderSemantic: 'Cari berdasarkan makna, mis. "persiapan rapat klien"…',
    searchModeLabel: "Mode pencarian",
    searchModeKeyword: "Kata kunci",
    searchModeSemantic: "Makna (AI)",
    searchModeSemanticUnavailable: "Pencarian makna butuh AI (AI_API_KEY belum diisi)",
    searchActions: "Aksi",
    searchNewTask: "Tugas baru",
    searchNoResults: "Tidak ditemukan.",
    searchLoading: "Mencari…",
    searchSemanticHint: "Ketik minimal 2 karakter untuk mencari berdasarkan makna.",
    searchSemanticResults: "Hasil paling relevan",
    searchSemanticFailed: "Pencarian makna gagal, menampilkan hasil kata kunci.",
    searchSimilarity: "kemiripan",
    searchTaskLabel: "Tugas",
    searchNoteLabel: "Catatan",
    searchProjects: "Proyek",
    semanticIndexTitle: "Pencarian makna (AI)",
    semanticIndexBody:
      "Tugas dan catatan diindeks otomatis beberapa detik setelah disimpan. Pakai tombol ini untuk mengindeks ulang semua data yang belum atau sudah usang (mis. setelah impor backup atau ganti model).",
    semanticIndexButton: "Indeks ulang",
    semanticIndexRunning: "Mengindeks…",
    semanticIndexDone: "Indeks selesai",
    semanticIndexCount: "item diindeks",
    semanticIndexUnavailable: "AI belum dikonfigurasi; pencarian memakai kata kunci.",
    semanticIndexDemo: "Mode demo: embedding contoh tanpa AI.",
  },
  en: {
    today: "Today",
    inbox: "Inbox",
    tasks: "Tasks",
    calendar: "Calendar",
    timeline: "Timeline",
    projects: "Projects",
    notes: "Notes",
    graph: "Knowledge Graph",
    automations: "Automations",
    canvas: "Canvas",
    activity: "Activity",
    settings: "Settings",
    quickCapture: "Quick capture",
    quickTask: "Quick task",
    search: "Search…",
    signOut: "Sign out",
    menu: "Menu",
    theme: "Theme",
    language: "Language",
    light: "Light",
    dark: "Dark",
    system: "Use device setting",
    appearance: "Appearance & language",
    saved: "Saved",
    backup: "Backup & restore",
    reports: "Reports",
    templates: "Templates",
    archive: "Archive & Trash",
    errGeneric: "Something went wrong. Please try again.",
    errNetwork: "Can't reach the server. Check your internet connection and try again.",
    errSession: "Your session has ended. Please sign in again.",
    errForbidden: "You don't have access to do this.",
    errOwnerOnly: "Only the creator or the project owner can do this.",
    errDuplicate: "This already exists.",
    errReference: "Related data is missing or still in use.",
    errInvalid: "Invalid data. Check the fields and try again.",
    errNotFound: "Not found.",
    errRateLimit: "AI usage limit reached. Try again in a moment.",
    errAiNotConfigured: "AI is not configured. An admin needs to set AI_API_KEY.",
    errConfig: "The app is not configured correctly. Contact the admin.",
    errInvalidLogin: "Wrong email or password.",
    errEmailNotConfirmed: "Email not confirmed yet. Check your inbox.",
    errUserExists: "This email is already registered. Please sign in.",
    errTimeout: "The request took too long. Try again.",
    routeErrorTitle: "This page didn't load",
    routeErrorBody: "Something went wrong on this page. The rest of the app still works.",
    retry: "Try again",
    backToToday: "Back to Today",
    landingEyebrow: "Open source · PWA · MIT",
    landingTitle: "A second brain for your tasks and notes",
    landingSubtitle:
      "Capture ideas the moment they appear, let AI tidy them up, then manage tasks, block-based notes and team projects in one place.",
    landingSignIn: "Sign in",
    landingGithub: "View on GitHub",
    landingFeatures: "Features",
    landingInboxTitle: "Inbox & AI capture",
    landingInboxBody:
      "Type, record a voice note or snap a photo. AI turns it into a clean task or note.",
    landingTasksTitle: "Tasks in four views",
    landingTasksBody:
      "List, kanban, calendar and timeline with dependencies, recurrence and natural-language quick add.",
    landingNotesTitle: "Block notes + graph",
    landingNotesBody: "[[Note]] links, ((block)) references, queries and a knowledge graph.",
    landingCollabTitle: "Real-time collaboration",
    landingCollabBody: "Edit notes live with your team, with per-project access.",
    landingAutomationsTitle: "Automations",
    landingAutomationsBody:
      "When a status or priority changes, run an action: move it, flag it or send a webhook.",
    landingIntegrationsTitle: "Telegram & Google Calendar",
    landingIntegrationsBody:
      "Add tasks from chat, get reminders and sync due dates to your calendar.",
    landingPwaTitle: "PWA & offline",
    landingPwaBody: "Install it on your home screen; it feels like a native app.",
    landingOssTitle: "Open source (MIT)",
    landingOssBody: "Self-host on Vercel + Supabase. The code is open on GitHub.",
    landingFooter: "Built with TanStack Start, Supabase and Yjs.",
    landingDemo: "Try the demo",
    landingSkip: "Skip to content",
    landingThemeLabel: "Change theme",
    landingLanguageLabel: "Switch language to Bahasa Indonesia",
    landingLicense: "MIT license",
    landingSecurity: "Security & privacy",
    landingNewTab: "(new tab)",
    landingNavFeatures: "Features",
    landingNavHowItWorks: "How it works",
    landingNavIntegrations: "Integrations",
    landingNavSelfHost: "Self-host",
    landingNavFaq: "FAQ",
    landingMenuLabel: "Main menu",
    landingMenuOpen: "Open menu",
    landingMenuDescription: "Page navigation, demo, GitHub and sign in.",
    landingNavTech: "Tech stack",
    landingTechTitle: "Built on a modern stack",
    landingTechSubtitle:
      "Proven open-source tools, from the web framework to the database, automation and monitoring.",
    landingTechListLabel: "Technologies",
    landingBackToTop: "Back to top",
    loginBackHome: "Home",
    loginBackHomeLabel: "Back to the home page",
    loginLogoLabel: "Second Brain — home",
    landingFeaturesSubtitle:
      "Everything you need to capture, organize and finish your work in one place.",
    landingHowTitle: "How it works",
    landingHowSubtitle: "From scattered thoughts to finished work, in four steps.",
    landingStep: "Step",
    landingStep1Title: "Capture anything",
    landingStep1Body:
      "Type, record a voice note, snap a photo, or send it via Telegram or email. It all lands in the Inbox.",
    landingStep2Title: "AI tidies up",
    landingStep2Body:
      "AI summarizes the Inbox and splits it into tasks and notes, with dates, priorities and projects.",
    landingStep3Title: "Plan & do",
    landingStep3Body:
      "Organize tasks in list, kanban, calendar or timeline. Dependencies and automations keep things moving.",
    landingStep4Title: "Connect knowledge",
    landingStep4Body:
      "Block notes link to each other through [[links]] and ((references)) and show up as a graph.",
    landingIntTitle: "Integrations",
    landingIntSubtitle: "Works with the tools you already use. All optional.",
    landingIntTelegramTitle: "Telegram bot",
    landingIntTelegramBody:
      "Add tasks, capture ideas, send photos or voice notes, and get reminders and a daily digest.",
    landingIntCalendarTitle: "Google Calendar",
    landingIntCalendarBody:
      "Dated tasks sync to your calendar through the instance's own OAuth client.",
    landingIntAiTitle: "Your AI provider",
    landingIntAiBody:
      "OpenAI or any compatible API (Gemini, Groq, OpenRouter) for summaries, OCR and transcription.",
    landingIntN8nTitle: "n8n",
    landingIntN8nBody:
      "Ready-to-import workflows for the bot, scheduled reminders, maintenance and email to Inbox.",
    landingIntBackupTitle: "Automatic backups",
    landingIntBackupBody:
      "Scheduled backups to Google Drive with an email summary via Resend, plus manual JSON export.",
    landingIntWebhookTitle: "Webhooks",
    landingIntWebhookBody:
      "Automations can send HTTPS webhooks to other services when a rule matches.",
    landingHostTitle: "Self-host in three steps",
    landingHostSubtitle:
      "Run your own instance on the Vercel and Supabase free tiers. Your data stays yours.",
    landingHost1Title: "Supabase",
    landingHost1Body:
      "Create a Supabase project (Free), run the SQL migrations from the repo, and turn off public sign-ups.",
    landingHost2Title: "Vercel",
    landingHost2Body:
      "Import the repo into Vercel, fill in the variables from .env.example, then deploy.",
    landingHost3Title: "n8n (optional)",
    landingHost3Body:
      "Import the workflows from integrations/n8n for the Telegram bot, reminders and scheduled backups.",
    landingHostGuide: "Read the self-host guide",
    landingFaqTitle: "Frequently asked questions",
    landingFaq1Q: "Is Second Brain free?",
    landingFaq1A:
      "Yes. The code is open source under the MIT license. You only pay for the services you use yourself (hosting, AI provider), and all of it can run on free tiers.",
    landingFaq2Q: "Where is my data stored?",
    landingFaq2A:
      "In the Supabase database of whoever runs the instance. On a self-hosted instance that is your own Supabase project. Access is limited per user and per project by Row Level Security.",
    landingFaq3Q: "How do I get an account?",
    landingFaq3A:
      "Public sign-up is closed by default. The instance owner creates or invites accounts in Supabase, and team members join through project invites.",
    landingFaq4Q: "Is AI required?",
    landingFaq4A:
      "No. Without an API key the AI features are disabled and the app keeps working, including the local natural-language task parser.",
    landingFaq5Q: "Does it work offline?",
    landingFaq5A:
      "Second Brain is a PWA: you can install it on your home screen, app assets are cached, and recently opened pages stay viewable when the connection drops.",
    landingFaq6Q: "How do I delete my data?",
    landingFaq6A:
      "Deleted items go to the trash and are purged after 30 days. To delete your account and all of its data, contact the instance owner. See the Privacy Policy.",
    landingFooterPages: "Pages",
    landingFooterDocs: "Documentation",
    landingFooterLegal: "Legal",
    landingFooterSelfHostGuide: "Self-host guide",
    landingFooterN8n: "Telegram bot & n8n",
    landingFooterEnv: "Environment variables",
    landingFooterRelease: "(release notes)",
    landingMadeIn: "Made with ♥ in Indonesia",
    legalPrivacy: "Privacy",
    legalTerms: "Terms",
    legalPrivacyTitle: "Privacy Policy",
    legalTermsTitle: "Terms of Use",
    legalUpdated: "Last updated",
    legalToc: "On this page",
    legalNotAdvice:
      "This document is a template for a self-hosted open-source app, not legal advice. The instance owner is responsible for adapting it to their service and the applicable law.",
    pwaUpdateAvailable: "A new version is available",
    pwaReload: "Reload",
    aboutTitle: "About",
    aboutSubtitle: "The running version and project links.",
    aboutVersion: "Version",
    aboutCommit: "Commit",
    aboutBuildTime: "Build date",
    aboutUpToDate: "You're on the latest version.",
    aboutUpdateAvailable: "New version available:",
    aboutChecking: "Checking for the latest version…",
    aboutCheckFailed: "Couldn't check for the latest version.",
    aboutChangelog: "Release notes",
    aboutRepo: "GitHub repository",
    aboutDocs: "Documentation",
    aboutReportBug: "Report a bug",
    demoBannerText: "Demo mode — data resets every day at 00:00 WIB, some features are disabled",
    demoBannerProd: "Use the real app",
    demoBannerGithub: "Code on GitHub",
    demoBannerLabel: "Demo mode notice",
    demoNoticeTitle: "This is the demo",
    demoNoticeBody:
      "Everything here is sample data and resets every day at 00:00 WIB. Some features (real AI, Telegram, Google Calendar, webhooks, invites) are turned off.",
    demoNoticeSelfHost: "How to self-host",
    demoNoticeDismiss: "Dismiss demo notice",
    backToTop: "Back to top",
    demoDisabled: "Not available in the demo",
    demoLoginHint: "Demo account:",
    demoAutofill: "Fill in",
    demoSignIn: "Sign in as demo",
    demoAiHint: "Demo mode: sample responses",
    demoAiExamples: "Examples",
    demoAiVoiceExample: "Use sample voice",
    demoAiImageExample: "Use sample photo",
    demoAiFillNote: "Replace this note with the example?",
    authForgotLink: "Forgot password?",
    authForgotTitle: "Reset your password",
    authForgotIntro: "Enter your account email. We will send a link to create a new password.",
    authForgotSubmit: "Send link",
    authForgotSent:
      "If that email is registered, a link to set your password is on its way. Check your inbox and spam folder; the link expires after a while.",
    authForgotBack: "Back to sign in",
    authEmailLabel: "Email",
    authEmailInvalid: "Invalid email.",
    authSending: "Working…",
    setPwTitleInvite: "Create your password",
    setPwTitleRecovery: "Reset your password",
    setPwIntroInvite: "You have been invited to Second Brain. Create a password for:",
    setPwIntroRecovery: "Enter a new password for:",
    setPwChecking: "Checking the link…",
    setPwNew: "New password",
    setPwConfirm: "Repeat password",
    setPwShow: "Show password",
    setPwMismatch: "Passwords do not match.",
    setPwTooShort: "Use at least 8 characters.",
    setPwHintsLabel: "Password tips",
    setPwHintLength: "At least 8 characters",
    setPwHintLetters: "Upper and lower case letters",
    setPwHintNumbers: "Numbers",
    setPwHintSymbols: "Symbols",
    setPwStrength: "Strength",
    setPwStrength1: "Weak",
    setPwStrength2: "Fair",
    setPwStrength3: "Good",
    setPwStrength4: "Strong",
    setPwSubmit: "Save password",
    setPwSaved: "Password saved.",
    setPwSamePassword: "The new password must differ from the old one.",
    setPwWeakServer: "The server's password policy rejected it. Try a longer, more varied one.",
    setPwInvalidTitle: "Invalid or expired link",
    setPwInvalidBody:
      "Email links work once and expire. Request a new link below. For a project invite you can also ask the project owner to press Resend.",
    setPwRequestNew: "Request a new link",
    setPwDemo:
      "Setting a password is not available in the demo, because the demo account is shared.",
    setPwGoLogin: "Go to sign in",
    teamInvitePlaceholder: "Team member email",
    teamInviteLabel: "New member email",
    teamInvite: "Invite",
    teamInviteSent:
      "Invite saved. Without an account they get an email to create a password; with one they join automatically when they sign in.",
    teamInviteAlreadyMember: "This email is already a project member.",
    teamInviteEmailLimited:
      "Invite saved, but the email was not sent yet (Supabase email limit). Press Resend later.",
    teamInviteEmailFailed:
      "Invite saved, but the email could not be sent. Check the Supabase email settings, then press Resend.",
    teamPendingHeading: "Pending invites",
    teamPending: "Pending",
    teamResend: "Resend",
    teamResent: "Invite sent again.",
    teamRevoke: "Revoke invite",
    teamRevokeConfirm: "Revoke the invite for this email?",
    teamRevoked: "Invite revoked.",
    teamMemberNote: "You are a member of this project. Only the owner can invite people.",
    teamInviteHint:
      "Invites wait until the person signs in. Email links expire after a while; press Resend for a fresh link.",
    searchPlaceholder: "Search tasks, projects, notes…",
    searchPlaceholderSemantic: 'Search by meaning, e.g. "client meeting prep"…',
    searchModeLabel: "Search mode",
    searchModeKeyword: "Keyword",
    searchModeSemantic: "Meaning (AI)",
    searchModeSemanticUnavailable: "Meaning search needs AI (AI_API_KEY is not set)",
    searchActions: "Actions",
    searchNewTask: "New task",
    searchNoResults: "No results.",
    searchLoading: "Searching…",
    searchSemanticHint: "Type at least 2 characters to search by meaning.",
    searchSemanticResults: "Most relevant",
    searchSemanticFailed: "Meaning search failed, showing keyword results.",
    searchSimilarity: "similarity",
    searchTaskLabel: "Task",
    searchNoteLabel: "Note",
    searchProjects: "Projects",
    semanticIndexTitle: "Meaning search (AI)",
    semanticIndexBody:
      "Tasks and notes are indexed automatically a few seconds after you save them. Use this button to re-index everything that is missing or outdated (e.g. after restoring a backup or changing the model).",
    semanticIndexButton: "Re-index",
    semanticIndexRunning: "Indexing…",
    semanticIndexDone: "Index up to date",
    semanticIndexCount: "items indexed",
    semanticIndexUnavailable: "AI is not configured; search uses keywords.",
    semanticIndexDemo: "Demo mode: sample embeddings without AI.",
  },
} as const;

export type MessageKey = keyof typeof messages.id;

/** Active UI locale outside React (toasts, error mappers): the provider keeps `<html lang>` in sync. */
export function currentLocale(): Locale {
  return typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "id";
}

/** Non-hook translation for code that runs outside components. */
export function translate(key: MessageKey, locale: Locale = currentLocale()): string {
  return messages[locale][key];
}
type PreferencesContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

const LOCALE_STORAGE_KEY = "second-brain-locale";

/**
 * `initialLocale` / `initialTheme` come from the `sb_lang` / `sb_theme` cookies, read by the root
 * loader on the server (src/lib/preferences-ssr.ts). The SSR HTML is therefore already in the
 * visitor's language and hydration renders the same text: no ID → EN flash, no mismatch.
 * localStorage is still read after mount for installs that predate the cookie, and the cookies
 * are backfilled from it so the next server render matches.
 */
export function PreferencesProvider({
  children,
  initialLocale = "id",
  initialTheme = "system",
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
  initialTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  // Snapshot of the server values for the mount effect (it must run only once).
  const [initial] = useState({ locale: initialLocale, theme: initialTheme });

  useEffect(() => {
    let storedTheme: string | null = null;
    let storedLocale: string | null = null;
    try {
      storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // storage blocked: keep the cookie values
    }
    const nextTheme: Theme =
      storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
        ? storedTheme
        : initial.theme;
    const nextLocale: Locale =
      storedLocale === "en" || storedLocale === "id" ? storedLocale : initial.locale;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile with localStorage after mount (not available during SSR).
    setThemeState(nextTheme);
    setLocaleState(nextLocale);
    applyTheme(nextTheme);
    document.documentElement.lang = nextLocale;
    writePreferenceCookie(LOCALE_COOKIE, nextLocale);
    writePreferenceCookie(THEME_COOKIE, nextTheme);
  }, [initial]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme("system");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      theme,
      setTheme: (next) => {
        setThemeState(next);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // storage blocked: the cookie still carries the choice
        }
        writePreferenceCookie(THEME_COOKIE, next);
        applyTheme(next);
      },
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        try {
          localStorage.setItem(LOCALE_STORAGE_KEY, next);
        } catch {
          // storage blocked: the cookie still carries the choice
        }
        writePreferenceCookie(LOCALE_COOKIE, next);
        document.documentElement.lang = next;
      },
      t: (key) => messages[locale][key],
    }),
    [theme, locale],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}

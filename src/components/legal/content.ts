import { messages } from "@/lib/i18n";
import type { Locale } from "@/lib/preferences";

/**
 * Text of the public legal pages (`/privacy`, `/terms`), Indonesian first with an English
 * version selected by the UI locale. Written for a self-hosted open-source deployment: "the
 * operator" is whoever runs the instance. Keep both languages in sync when editing.
 */

/** A block is a paragraph (string) or a bullet list (string[]). */
export type LegalBlock = string | readonly string[];
export type LegalSection = { id: string; title: string; blocks: readonly LegalBlock[] };
export type LegalDoc = { intro: string; sections: readonly LegalSection[] };

/** Date of the last material change, shown on both pages (ISO, YYYY-MM-DD). */
export const LEGAL_UPDATED = "2026-10-06";

const privacyId: LegalDoc = {
  intro:
    "Second Brain adalah aplikasi open source (lisensi MIT) yang di-host sendiri. Kebijakan ini menjelaskan data apa yang diproses oleh sebuah instance Second Brain, untuk apa, dan hak Anda. “Pengelola” berarti orang atau organisasi yang menjalankan instance yang Anda pakai; untuk 2ndbrain.ilramdhan.dev pengelolanya adalah Ilham Ramadhan.",
  sections: [
    {
      id: "data",
      title: "Data yang disimpan",
      blocks: [
        "Data aplikasi disimpan di database Postgres milik pengelola di Supabase (Auth, Database, Realtime). Yang disimpan:",
        [
          "Akun: alamat email, hash kata sandi (dikelola Supabase Auth), nama tampilan, serta waktu pembuatan dan login terakhir.",
          "Isi yang Anda buat: item Inbox, tugas, catatan berblok, proyek, milestone, komentar, template, kanvas, aturan automations, dan sesi fokus.",
          "Kolaborasi: keanggotaan proyek dan undangan (alamat email yang diundang).",
          "Log aktivitas: perubahan pada data Anda (apa, kapan) untuk halaman Aktivitas dan audit.",
          "Koneksi: ID chat Telegram yang Anda tautkan, dan refresh token Google Calendar yang dienkripsi (AES-GCM) di server.",
          "Data teknis: batas laju (rate limit) per pengguna dan kunci idempotensi n8n, yang dihapus otomatis.",
        ],
        "Akses ke data dibatasi Row Level Security: Anda hanya melihat data milik Anda dan data proyek tempat Anda menjadi anggota.",
      ],
    },
    {
      id: "pihak-ketiga",
      title: "Layanan pihak ketiga",
      blocks: [
        "Fitur berikut hanya aktif bila pengelola mengonfigurasinya, dan sebagian hanya bila Anda sendiri menyambungkannya:",
        [
          "Supabase: hosting database, autentikasi, dan realtime untuk seluruh aplikasi.",
          "Vercel (atau host lain pilihan pengelola): menjalankan aplikasi web dan mencatat log permintaan standar (alamat IP, URL, user agent).",
          "Google Calendar: bila Anda menghubungkannya, tugas bertanggal dikirim sebagai acara ke kalender Anda (scope calendar.events).",
          "Google Drive: bila pengelola mengaktifkan backup otomatis via n8n, salinan data disimpan di Drive milik pengelola.",
          "Telegram: bila Anda menautkan bot, pesan yang Anda kirim ke bot dan balasannya diproses oleh Telegram dan aplikasi.",
          "Provider AI (misalnya OpenAI atau Google Gemini lewat API yang kompatibel): teks, gambar, atau suara yang Anda kirim ke fitur AI diteruskan ke provider untuk diproses. Tidak ada data yang dikirim ke AI tanpa tindakan Anda.",
          "Resend: email ringkasan backup dan peringatan dikirim ke pengelola melalui Resend.",
          "Sentry (opsional): laporan error dan metrik performa, hanya berisi ID pengguna tanpa email, isi catatan, body, header, maupun query string.",
          "n8n (opsional): server otomasi milik pengelola yang memanggil endpoint aplikasi untuk pengingat, digest, maintenance, dan backup.",
        ],
        "Setiap layanan tunduk pada kebijakan privasinya masing-masing. Pengelola memilih wilayah dan paket layanan tersebut.",
      ],
    },
    {
      id: "penyimpanan-lokal",
      title: "Cookie dan penyimpanan lokal",
      blocks: [
        "Second Brain tidak memakai cookie iklan atau pelacak pihak ketiga. Browser Anda menyimpan:",
        [
          "Sesi login Supabase (token akses dan refresh) di localStorage.",
          "Preferensi tema, bahasa, dan batas waktu logout otomatis di localStorage.",
          "Draf quick capture dan cache pemeriksaan versi terbaru di localStorage.",
          "Cache service worker (PWA) berisi aset aplikasi dan salinan halaman terakhir agar bisa dibuka offline.",
        ],
        "Anda dapat menghapus semuanya dengan keluar dan membersihkan data situs di browser.",
      ],
    },
    {
      id: "retensi",
      title: "Retensi data",
      blocks: [
        [
          "Tugas, catatan, dan proyek yang dihapus masuk ke Sampah dan dihapus permanen setelah 30 hari.",
          "Item arsip disimpan sampai Anda memulihkan atau menghapusnya.",
          "Kode penautan Telegram kedaluwarsa dalam hitungan menit; data rate limit dihapus setelah 24 jam dan kunci idempotensi n8n setelah beberapa hari.",
          "Backup otomatis (bila diaktifkan) dirotasi sesuai jumlah salinan yang diatur pengelola; data yang sudah dihapus dapat tetap ada di backup lama sampai backup itu dirotasi.",
          "Data akun disimpan selama akun aktif.",
        ],
      ],
    },
    {
      id: "hak",
      title: "Hak Anda dan penghapusan akun",
      blocks: [
        "Anda berhak mengakses, memperbaiki, mengekspor, dan menghapus data pribadi Anda, sesuai hukum yang berlaku (misalnya UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi dan GDPR).",
        [
          "Akses dan perbaikan: lihat dan ubah data langsung di aplikasi.",
          "Ekspor: Pengaturan → Backup → unduh salinan JSON data Anda.",
          "Penghapusan: hubungi pengelola untuk menghapus akun. Menghapus akun menghapus seluruh data milik akun tersebut (tugas, catatan, proyek, log aktivitas, koneksi) secara berantai di database.",
          "Mencabut koneksi: putuskan Google Calendar dan Telegram kapan saja di Pengaturan.",
        ],
      ],
    },
    {
      id: "keamanan",
      title: "Keamanan",
      blocks: [
        "Koneksi memakai HTTPS. Kredensial layanan dan token disimpan di server, tidak pernah dikirim ke browser. Detail arsitektur keamanan ada di SECURITY.md pada repositori. Tidak ada sistem yang sepenuhnya aman; laporkan celah keamanan secara privat lewat GitHub Security Advisories.",
      ],
    },
    {
      id: "kontak",
      title: "Kontak dan perubahan",
      blocks: [
        "Pertanyaan tentang privasi atau permintaan penghapusan data dapat diajukan ke pengelola instance. Untuk instance resmi, buka issue atau diskusi di repositori GitHub ilramdhan/second-brain, atau gunakan GitHub Security Advisories untuk hal sensitif.",
        "Kebijakan ini dapat berubah. Tanggal di atas menunjukkan pembaruan terakhir; perubahan penting juga dicatat di CHANGELOG.",
      ],
    },
  ],
};

const privacyEn: LegalDoc = {
  intro:
    "Second Brain is a self-hosted open-source app (MIT license). This policy explains what data a Second Brain instance processes, why, and your rights. “Operator” means the person or organization running the instance you use; for 2ndbrain.ilramdhan.dev the operator is Ilham Ramadhan.",
  sections: [
    {
      id: "data",
      title: "Data we store",
      blocks: [
        "App data is stored in the operator's Postgres database on Supabase (Auth, Database, Realtime). It includes:",
        [
          "Account: email address, password hash (managed by Supabase Auth), display name, and creation and last sign-in times.",
          "Your content: Inbox items, tasks, block notes, projects, milestones, comments, templates, canvases, automation rules and focus sessions.",
          "Collaboration: project memberships and invites (the invited email address).",
          "Activity log: changes to your data (what, when) for the Activity page and auditing.",
          "Connections: the Telegram chat ID you link, and a Google Calendar refresh token encrypted (AES-GCM) on the server.",
          "Technical data: per-user rate limits and n8n idempotency keys, which are deleted automatically.",
        ],
        "Row Level Security limits access: you only see your own data and the data of projects you are a member of.",
      ],
    },
    {
      id: "pihak-ketiga",
      title: "Third-party services",
      blocks: [
        "These features are only active when the operator configures them, and some only when you connect them yourself:",
        [
          "Supabase: database hosting, authentication and realtime for the whole app.",
          "Vercel (or another host chosen by the operator): runs the web app and keeps standard request logs (IP address, URL, user agent).",
          "Google Calendar: when you connect it, dated tasks are sent as events to your calendar (calendar.events scope).",
          "Google Drive: when the operator enables automatic backups via n8n, copies of the data are stored in the operator's Drive.",
          "Telegram: when you link the bot, the messages you send to it and its replies are processed by Telegram and the app.",
          "AI provider (for example OpenAI or Google Gemini through a compatible API): text, images or audio you submit to an AI feature are forwarded to the provider for processing. Nothing is sent to AI without your action.",
          "Resend: backup summaries and alerts are emailed to the operator through Resend.",
          "Sentry (optional): error reports and performance metrics containing only a user ID, never email, note content, bodies, headers or query strings.",
          "n8n (optional): the operator's automation server, which calls the app's endpoints for reminders, digests, maintenance and backups.",
        ],
        "Each service is subject to its own privacy policy. The operator chooses their regions and plans.",
      ],
    },
    {
      id: "penyimpanan-lokal",
      title: "Cookies and local storage",
      blocks: [
        "Second Brain uses no advertising cookies or third-party trackers. Your browser stores:",
        [
          "The Supabase sign-in session (access and refresh tokens) in localStorage.",
          "Theme, language and idle-logout preferences in localStorage.",
          "Your quick-capture draft and the latest-version check cache in localStorage.",
          "The service worker (PWA) cache with app assets and recently visited pages for offline use.",
        ],
        "You can remove all of it by signing out and clearing the site data in your browser.",
      ],
    },
    {
      id: "retensi",
      title: "Data retention",
      blocks: [
        [
          "Deleted tasks, notes and projects go to the Trash and are permanently purged after 30 days.",
          "Archived items are kept until you restore or delete them.",
          "Telegram link codes expire within minutes; rate-limit rows are deleted after 24 hours and n8n idempotency keys after a few days.",
          "Automatic backups (when enabled) rotate according to the number of copies set by the operator; deleted data can remain in older backups until they rotate out.",
          "Account data is kept while the account is active.",
        ],
      ],
    },
    {
      id: "hak",
      title: "Your rights and account deletion",
      blocks: [
        "You have the right to access, correct, export and delete your personal data, as provided by applicable law (for example Indonesia's Personal Data Protection Law No. 27/2022 and the GDPR).",
        [
          "Access and correction: view and edit your data directly in the app.",
          "Export: Settings → Backup → download a JSON copy of your data.",
          "Deletion: contact the operator to delete your account. Deleting an account removes all data it owns (tasks, notes, projects, activity log, connections) through cascading deletes in the database.",
          "Revoking connections: disconnect Google Calendar and Telegram at any time in Settings.",
        ],
      ],
    },
    {
      id: "keamanan",
      title: "Security",
      blocks: [
        "Connections use HTTPS. Service credentials and tokens stay on the server and never reach the browser. The security architecture is described in SECURITY.md in the repository. No system is perfectly secure; please report vulnerabilities privately through GitHub Security Advisories.",
      ],
    },
    {
      id: "kontak",
      title: "Contact and changes",
      blocks: [
        "Privacy questions and deletion requests go to the operator of the instance. For the official instance, open an issue or discussion in the ilramdhan/second-brain GitHub repository, or use GitHub Security Advisories for sensitive matters.",
        "This policy may change. The date above shows the last update; significant changes are also recorded in the CHANGELOG.",
      ],
    },
  ],
};

const termsId: LegalDoc = {
  intro:
    "Ketentuan ini mengatur penggunaan sebuah instance Second Brain. Dengan masuk dan memakai aplikasi, Anda menyetujui ketentuan ini. Kode sumbernya sendiri dilisensikan terpisah di bawah lisensi MIT.",
  sections: [
    {
      id: "layanan",
      title: "Layanan",
      blocks: [
        "Second Brain adalah aplikasi pengelolaan tugas dan catatan dengan fitur AI dan integrasi opsional. Setiap instance dijalankan oleh pengelolanya sendiri, yang menentukan siapa yang boleh memakai, fitur yang aktif, dan layanan pihak ketiga yang dipakai.",
      ],
    },
    {
      id: "akun",
      title: "Akun",
      blocks: [
        [
          "Pendaftaran publik dapat ditutup; akun dibuat atau diundang oleh pengelola.",
          "Anda bertanggung jawab menjaga kerahasiaan kata sandi dan aktivitas di akun Anda.",
          "Beri tahu pengelola bila Anda menduga akun Anda disalahgunakan.",
        ],
      ],
    },
    {
      id: "konten",
      title: "Konten Anda",
      blocks: [
        "Anda tetap memiliki semua konten yang Anda buat. Anda memberi pengelola izin terbatas untuk menyimpan, memproses, dan menampilkan konten tersebut sejauh diperlukan untuk menjalankan layanan, termasuk meneruskannya ke provider AI saat Anda memakai fitur AI dan membagikannya ke anggota proyek yang Anda undang.",
      ],
    },
    {
      id: "penggunaan",
      title: "Penggunaan yang dapat diterima",
      blocks: [
        "Anda tidak boleh:",
        [
          "Melanggar hukum atau hak pihak lain, termasuk hak cipta dan privasi.",
          "Mencoba mengakses data pengguna lain, mengganggu layanan, atau menguji keamanan instance yang bukan milik Anda.",
          "Memakai fitur AI, bot, atau webhook untuk spam, malware, atau penyalahgunaan layanan pihak ketiga.",
          "Membebani layanan secara berlebihan atau menghindari batas laju.",
        ],
      ],
    },
    {
      id: "pihak-ketiga",
      title: "Layanan pihak ketiga",
      blocks: [
        "Integrasi seperti Google Calendar, Telegram, provider AI, dan n8n tunduk pada ketentuan masing-masing penyedia. Hasil AI bisa keliru; periksa kembali sebelum mengandalkannya.",
      ],
    },
    {
      id: "jaminan",
      title: "Tanpa jaminan",
      blocks: [
        "Layanan disediakan “sebagaimana adanya” dan “sebagaimana tersedia”, tanpa jaminan apa pun, sesuai lisensi MIT. Pengelola tidak menjamin layanan selalu tersedia, bebas error, atau bahwa data tidak akan hilang. Simpan backup sendiri untuk data penting (Pengaturan → Backup).",
      ],
    },
    {
      id: "tanggung-jawab",
      title: "Batas tanggung jawab",
      blocks: [
        "Sejauh diizinkan hukum, pengelola dan kontributor tidak bertanggung jawab atas kerugian tidak langsung, insidental, atau konsekuensial, termasuk kehilangan data atau keuntungan, yang timbul dari penggunaan layanan.",
      ],
    },
    {
      id: "pengakhiran",
      title: "Pengakhiran",
      blocks: [
        "Anda dapat berhenti memakai layanan dan meminta penghapusan akun kapan saja. Pengelola dapat menangguhkan atau menutup akun yang melanggar ketentuan ini, atau menghentikan instance, dengan pemberitahuan yang wajar bila memungkinkan.",
      ],
    },
    {
      id: "perubahan",
      title: "Perubahan dan kontak",
      blocks: [
        "Ketentuan ini dapat diperbarui; tanggal di atas menunjukkan versi terakhir. Pertanyaan dapat diajukan ke pengelola instance atau lewat repositori GitHub ilramdhan/second-brain.",
      ],
    },
  ],
};

const termsEn: LegalDoc = {
  intro:
    "These terms govern the use of a Second Brain instance. By signing in and using the app you agree to them. The source code itself is licensed separately under the MIT license.",
  sections: [
    {
      id: "layanan",
      title: "The service",
      blocks: [
        "Second Brain is a task and notes app with AI features and optional integrations. Each instance is run by its own operator, who decides who may use it, which features are enabled and which third-party services are used.",
      ],
    },
    {
      id: "akun",
      title: "Accounts",
      blocks: [
        [
          "Public sign-up may be closed; accounts are created or invited by the operator.",
          "You are responsible for keeping your password confidential and for activity in your account.",
          "Tell the operator if you suspect your account has been misused.",
        ],
      ],
    },
    {
      id: "konten",
      title: "Your content",
      blocks: [
        "You keep ownership of everything you create. You give the operator a limited permission to store, process and display that content as needed to run the service, including forwarding it to the AI provider when you use AI features and sharing it with project members you invite.",
      ],
    },
    {
      id: "penggunaan",
      title: "Acceptable use",
      blocks: [
        "You must not:",
        [
          "Break the law or infringe the rights of others, including copyright and privacy.",
          "Try to access other users' data, disrupt the service, or test the security of an instance you do not own.",
          "Use the AI features, bot or webhooks for spam, malware or abuse of third-party services.",
          "Overload the service or circumvent rate limits.",
        ],
      ],
    },
    {
      id: "pihak-ketiga",
      title: "Third-party services",
      blocks: [
        "Integrations such as Google Calendar, Telegram, AI providers and n8n are subject to each provider's own terms. AI output can be wrong; check it before relying on it.",
      ],
    },
    {
      id: "jaminan",
      title: "No warranty",
      blocks: [
        "The service is provided “as is” and “as available”, without warranty of any kind, in line with the MIT license. The operator does not guarantee that the service is always available, error-free, or that data will never be lost. Keep your own backups of important data (Settings → Backup).",
      ],
    },
    {
      id: "tanggung-jawab",
      title: "Limitation of liability",
      blocks: [
        "To the extent permitted by law, the operator and contributors are not liable for indirect, incidental or consequential damages, including loss of data or profits, arising from the use of the service.",
      ],
    },
    {
      id: "pengakhiran",
      title: "Termination",
      blocks: [
        "You can stop using the service and request account deletion at any time. The operator may suspend or close accounts that break these terms, or shut down the instance, with reasonable notice where possible.",
      ],
    },
    {
      id: "perubahan",
      title: "Changes and contact",
      blocks: [
        "These terms may be updated; the date above shows the latest version. Questions go to the operator of the instance or through the ilramdhan/second-brain GitHub repository.",
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<"privacy" | "terms", Record<Locale, LegalDoc>> = {
  privacy: { id: privacyId, en: privacyEn },
  terms: { id: termsId, en: termsEn },
};

// The page descriptions live in the i18n `meta` area (src/lib/i18n/meta.ts), read by head().
export const PRIVACY_DESCRIPTION = messages.id.metaPrivacyDesc;
export const TERMS_DESCRIPTION = messages.id.metaTermsDesc;

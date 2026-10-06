import { createContext, useContext, useEffect, useMemo, useState } from "react";
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
    pwaUpdateAvailable: "Versi baru tersedia",
    pwaReload: "Muat ulang",
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
    pwaUpdateAvailable: "A new version is available",
    pwaReload: "Reload",
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

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [locale, setLocaleState] = useState<Locale>("id");

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    const storedLocale = localStorage.getItem("second-brain-locale") as Locale | null;
    const nextTheme =
      storedTheme && ["light", "dark", "system"].includes(storedTheme) ? storedTheme : "system";
    const nextLocale = storedLocale === "en" ? "en" : "id";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate stored preferences after mount (localStorage is not available during SSR).
    setThemeState(nextTheme);
    setLocaleState(nextLocale);
    applyTheme(nextTheme);
    document.documentElement.lang = nextLocale;
  }, []);

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
        localStorage.setItem(THEME_STORAGE_KEY, next);
        applyTheme(next);
      },
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        localStorage.setItem("second-brain-locale", next);
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

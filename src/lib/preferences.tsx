import { createContext, useContext, useEffect, useMemo, useState } from "react";

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
    const storedTheme = localStorage.getItem("second-brain-theme") as Theme | null;
    const storedLocale = localStorage.getItem("second-brain-locale") as Locale | null;
    const nextTheme =
      storedTheme && ["light", "dark", "system"].includes(storedTheme) ? storedTheme : "system";
    const nextLocale = storedLocale === "en" ? "en" : "id";
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
        localStorage.setItem("second-brain-theme", next);
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

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "light" | "dark" | "system";
export type Locale = "id" | "en";

const messages = {
  id: {
    today: "Hari Ini", inbox: "Inbox", tasks: "Tugas", calendar: "Kalender", timeline: "Timeline",
    projects: "Proyek", notes: "Catatan", graph: "Peta Pengetahuan", automations: "Otomasi",
    canvas: "Kanvas", activity: "Aktivitas", settings: "Pengaturan", quickCapture: "Tangkap cepat",
    quickTask: "Tugas cepat", search: "Cari…", signOut: "Keluar", menu: "Menu", theme: "Tema",
    language: "Bahasa", light: "Terang", dark: "Gelap", system: "Ikuti perangkat",
    appearance: "Tampilan & bahasa", saved: "Tersimpan", backup: "Backup & pemulihan", reports: "Laporan", templates: "Template", archive: "Arsip & Sampah",
  },
  en: {
    today: "Today", inbox: "Inbox", tasks: "Tasks", calendar: "Calendar", timeline: "Timeline",
    projects: "Projects", notes: "Notes", graph: "Knowledge Graph", automations: "Automations",
    canvas: "Canvas", activity: "Activity", settings: "Settings", quickCapture: "Quick capture",
    quickTask: "Quick task", search: "Search…", signOut: "Sign out", menu: "Menu", theme: "Theme",
    language: "Language", light: "Light", dark: "Dark", system: "Use device setting",
    appearance: "Appearance & language", saved: "Saved", backup: "Backup & restore", reports: "Reports", templates: "Templates", archive: "Archive & Trash",
  },
} as const;

type MessageKey = keyof typeof messages.id;
type PreferencesContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [locale, setLocaleState] = useState<Locale>("id");

  useEffect(() => {
    const storedTheme = localStorage.getItem("second-brain-theme") as Theme | null;
    const storedLocale = localStorage.getItem("second-brain-locale") as Locale | null;
    const nextTheme = storedTheme && ["light", "dark", "system"].includes(storedTheme) ? storedTheme : "system";
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

  const value = useMemo<PreferencesContextValue>(() => ({
    theme,
    setTheme: (next) => { setThemeState(next); localStorage.setItem("second-brain-theme", next); applyTheme(next); },
    locale,
    setLocale: (next) => { setLocaleState(next); localStorage.setItem("second-brain-locale", next); document.documentElement.lang = next; },
    t: (key) => messages[locale][key],
  }), [theme, locale]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}
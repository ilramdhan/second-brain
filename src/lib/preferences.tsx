import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  dateLocale,
  format,
  intlLocale,
  messages,
  type Locale,
  type MessageKey,
  type MessageVars,
} from "./i18n";
import { LOCALE_COOKIE, THEME_COOKIE, writePreferenceCookie } from "./preference-cookies";
import { THEME_STORAGE_KEY } from "./theme-script";

export type Theme = "light" | "dark" | "system";
export type { Locale, MessageKey, MessageVars };
export { dateLocale, intlLocale };

/** Active UI locale outside React (toasts, error mappers): the provider keeps `<html lang>` in sync. */
export function currentLocale(): Locale {
  return typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "id";
}

/**
 * Non-hook translation for code that runs outside components. `vars` fill `{name}`
 * placeholders.
 */
export function translate(
  key: MessageKey,
  locale: Locale = currentLocale(),
  vars?: MessageVars,
): string {
  return format(messages[locale][key], vars);
}

/** `translate` in the current locale with placeholders (toasts and helpers outside React). */
export function tr(key: MessageKey, vars?: MessageVars): string {
  return translate(key, currentLocale(), vars);
}

/** BCP 47 tag of the current locale, for `Intl` outside React. */
export function currentIntlLocale(): string {
  return intlLocale(currentLocale());
}

type PreferencesContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translate `key`; `vars` fill `{name}` placeholders. */
  t: (key: MessageKey, vars?: MessageVars) => string;
  /** BCP 47 tag of the active locale, for `Intl` / `toLocale*String`. */
  intl: string;
  /** date-fns locale of the active locale. */
  dateFns: ReturnType<typeof dateLocale>;
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
      t: (key, vars) => format(messages[locale][key], vars),
      intl: intlLocale(locale),
      dateFns: dateLocale(locale),
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

const FALLBACK_LOCALE: Locale = "id";
const fallbackI18n = {
  locale: FALLBACK_LOCALE,
  t: (key: MessageKey, vars?: MessageVars) => format(messages[FALLBACK_LOCALE][key], vars),
  intl: intlLocale(FALLBACK_LOCALE),
  dateFns: dateLocale(FALLBACK_LOCALE),
};

/**
 * Translation helpers only (`t`, `locale`, `intl`, `dateFns`). Unlike `usePreferences` it does
 * not require the provider: outside it (isolated component tests, error shells) it falls back
 * to the default locale, so leaf components can be translated without wrapping every caller.
 */
export function useI18n(): Pick<PreferencesContextValue, "locale" | "t" | "intl" | "dateFns"> {
  return useContext(PreferencesContext) ?? fallbackI18n;
}

/** date-fns locale of the current locale, for formatting outside React. */
export function currentDateLocale(): ReturnType<typeof dateLocale> {
  return dateLocale(currentLocale());
}

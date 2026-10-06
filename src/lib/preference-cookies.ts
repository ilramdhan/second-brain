// Language and theme preferences mirrored into cookies so the server can render the right
// language (and `<html lang>`) on the first paint. localStorage stays the client source of truth
// for existing installs; the cookie is what SSR can see. Kept free of React and server imports
// so it is safe in both bundles and easy to test.

import type { Locale, Theme } from "./preferences";

export const LOCALE_COOKIE = "sb_lang";
export const THEME_COOKIE = "sb_theme";
/** One year: a preference, not a session. */
const MAX_AGE = 60 * 60 * 24 * 365;

export type InitialPreferences = { locale: Locale; theme: Theme };
export const DEFAULT_PREFERENCES: InitialPreferences = { locale: "id", theme: "system" };

export function parseLocale(value: unknown): Locale {
  return value === "en" ? "en" : "id";
}

export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/** Reads one cookie from a `Cookie` header / `document.cookie` string. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Initial preferences from cookie values (unknown or missing values fall back to defaults). */
export function preferencesFromCookies(
  get: (name: string) => string | undefined,
): InitialPreferences {
  return { locale: parseLocale(get(LOCALE_COOKIE)), theme: parseTheme(get(THEME_COOKIE)) };
}

/** Browser-side read of the preference cookies (defaults outside the browser). */
export function readPreferenceCookies(): InitialPreferences {
  if (typeof document === "undefined") return DEFAULT_PREFERENCES;
  const header = document.cookie;
  return preferencesFromCookies((name) => readCookie(header, name));
}

/**
 * Persists a preference cookie (first-party, `SameSite=Lax`, readable by JS because the client
 * writes it; it holds only "id"/"en" or a theme name). Never throws: blocked cookies just mean
 * SSR falls back to the default language.
 */
export function writePreferenceCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // cookies disabled
  }
}

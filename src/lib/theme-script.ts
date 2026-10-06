// Theme bootstrap shared by the SSR shell (src/routes/__root.tsx) and PreferencesProvider.
// Kept free of React imports so tests can evaluate the inline script on its own.

export const THEME_STORAGE_KEY = "second-brain-theme";

/**
 * Runs synchronously in <head> before the first paint (and before hydration), so a stored dark
 * theme (or `system` + a dark OS setting) never flashes the light palette. Mirrors `applyTheme` in
 * src/lib/preferences.tsx: toggles the `dark` class and `color-scheme` on <html>. Any failure
 * (blocked storage, no matchMedia) leaves the default light theme; PreferencesProvider re-applies
 * the theme after mount anyway.
 *
 * CSP: inline scripts are allowed by `script-src 'unsafe-inline'` (src/server/securityHeaders.ts);
 * the policy test pins that. If script-src is ever tightened to hashes, add
 * `'sha256-<hash of this exact string>'` (see securityHeaders.test.ts).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=t==="dark"||((t!=="light")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

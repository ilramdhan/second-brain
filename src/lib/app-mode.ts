// Client-safe app mode switches (Phase 10 demo). Everything here reads `VITE_*` values, which
// Vite inlines at build time, so the same helpers work in the browser, during SSR and in tests
// (`vi.stubEnv`). The matching server-side switch is `APP_MODE` (src/server/demo/mode.server.ts);
// the UI is only a hint, the server guards are the real boundary.
import { REPO_URL } from "@/lib/app-version";
import { messages } from "@/lib/i18n";

export const DEFAULT_DEMO_EMAIL = "demo@ilramdhan.dev";
export const DEFAULT_DEMO_PASSWORD = "demo2ndbrain";
export const DEFAULT_PROD_URL = "https://2ndbrain.ilramdhan.dev";
export const DEMO_GITHUB_URL = REPO_URL;

/**
 * Short reason shown next to every feature that is switched off in the demo, in the default
 * locale. UI code uses `t("demoDisabled")` (DemoDisabled, toasts) so it follows the language.
 */
export const DEMO_DISABLED_MESSAGE = messages.id.demoDisabled;

const text = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");

/** True when the build is the public demo (`VITE_APP_MODE=demo`). */
export function isDemo(raw: unknown = import.meta.env["VITE_APP_MODE"]): boolean {
  return text(raw).toLowerCase() === "demo";
}

/** Public demo account shown on /login (not a secret: anyone may sign in with it). */
export function demoCredentials(
  email: unknown = import.meta.env["VITE_DEMO_EMAIL"],
  password: unknown = import.meta.env["VITE_DEMO_PASSWORD"],
): { email: string; password: string } {
  return {
    email: text(email) || DEFAULT_DEMO_EMAIL,
    password: text(password) || DEFAULT_DEMO_PASSWORD,
  };
}

/** Production app the demo banner links to (`VITE_PROD_URL`, absolute http(s) only). */
export function prodUrl(raw: unknown = import.meta.env["VITE_PROD_URL"]): string {
  const value = text(raw);
  if (!value) return DEFAULT_PROD_URL;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href.replace(/\/$/, "")
      : DEFAULT_PROD_URL;
  } catch {
    return DEFAULT_PROD_URL;
  }
}

/** `robots` value for a page: the demo is never indexed. */
export function robotsFor(defaultRobots: string, demo: boolean = isDemo()): string {
  return demo ? "noindex, nofollow" : defaultRobots;
}

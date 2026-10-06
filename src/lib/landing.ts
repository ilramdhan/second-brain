import { redirect } from "@tanstack/react-router";

/** Public production origin, used for canonical and Open Graph URLs on the landing page. */
export const SITE_URL = "https://2ndbrain.ilramdhan.dev";
export const GITHUB_URL = "https://github.com/ilramdhan/second-brain";
/** Same value as APP_HOME in src/lib/auth.ts (kept here so the landing chunk stays Supabase-free). */
export const APP_HOME_PATH = "/today";

/**
 * Signed-in visitors skip the landing page. The Supabase session lives in browser storage, so the
 * check only runs in the browser; the server always renders the landing page (SEO, fast LCP).
 * The auth module (and with it supabase-js) is loaded lazily so the landing chunk stays small and
 * a deployment without Supabase env still renders the page.
 */
export async function isSignedIn(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const { hasStoredSession } = await import("@/lib/auth");
  return hasStoredSession();
}

/** `beforeLoad` of `/`: throws a router redirect to the app for a signed-in visitor. */
export async function redirectSignedInVisitor(): Promise<void> {
  if (await isSignedIn()) throw redirect({ to: APP_HOME_PATH, replace: true });
}

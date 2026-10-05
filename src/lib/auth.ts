import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity";

/** Where signed-out visitors are sent. */
export const LOGIN_PATH = "/login";
/** Where a sign-in lands when no (safe) `redirect` was requested. Phase 8.6 moves this to /today. */
export const APP_HOME = "/";

/**
 * Only same-origin, absolute paths are honoured as post-login targets (no `//evil.com`,
 * `https://…` or `/\evil.com`), so the login page cannot be turned into an open redirect.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
  if (value === LOGIN_PATH || value.startsWith(`${LOGIN_PATH}?`)) return undefined;
  return value;
}

/**
 * Auth guard for the `_authenticated` subtree (`beforeLoad`). The Supabase session lives in
 * browser storage, so this only runs on the client (the subtree is `ssr: false`). A missing
 * session throws a router redirect, never an error, so the error boundary is not involved.
 */
export async function requireSession(queryClient: QueryClient, href: string): Promise<Session> {
  ensureAuthListener(queryClient);
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect({
      to: LOGIN_PATH,
      search: { redirect: safeRedirect(href) },
      replace: true,
    });
  }
  return data.session;
}

let listening = false;
/** User ids whose sign-in side effects already ran in this page lifetime. */
const seen = new Set<string>();

/**
 * Registers the app-wide auth listener once per page.
 *
 * Supabase emits `SIGNED_IN` not only on a real sign-in but also whenever the session is
 * restored from storage (page load, and every time a hidden tab becomes visible again), and
 * `INITIAL_SESSION` to each new subscriber. Accepting pending project invites therefore runs
 * once per user per page lifetime, the first time a signed-in session for that user is seen
 * (a fresh sign-in, or opening the app with a stored session), and never again on
 * `TOKEN_REFRESHED`, `USER_UPDATED` or tab focus. The `signed_in` audit entry is written by the
 * login page itself, so restores are not logged as sign-ins.
 */
export function ensureAuthListener(queryClient: QueryClient) {
  if (listening) return;
  supabase.auth.onAuthStateChange((event, session) => {
    handleAuthEvent(queryClient, event, session);
  });
  // Only after a successful subscribe: a missing-env client throws above and is retried.
  listening = true;
}

export function handleAuthEvent(
  queryClient: QueryClient,
  event: AuthChangeEvent,
  session: Session | null,
) {
  if (event === "SIGNED_OUT") {
    // Drop every cached query (tasks, notes, `me`, ...) so the next person on a shared device
    // never sees the previous user's data, whichever path ended the session (sign-out button,
    // idle logout, token revocation, sign-out in another tab).
    seen.clear();
    queryClient.clear();
    return;
  }
  const userId = session?.user.id;
  if (!userId) return;
  if (event === "PASSWORD_RECOVERY" || event === "USER_UPDATED") {
    void logActivity(event.toLowerCase(), "auth", userId, {}, "auth");
  }
  if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && !seen.has(userId)) {
    seen.add(userId);
    // Supabase-js callbacks must not await other auth calls inline (deadlock); defer them.
    setTimeout(() => {
      void supabase.rpc("accept_project_invites").then(({ error }) => {
        if (error) console.error("Accepting project invites failed", error.message);
      });
    }, 0);
  }
}

/** Test hook: forget listener registration and seen users. */
export function resetAuthStateForTests() {
  listening = false;
  seen.clear();
}

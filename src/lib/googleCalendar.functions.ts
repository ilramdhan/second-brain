import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function requestOrigin() {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return undefined;
  }
}

/** Google Calendar is switched off in the public demo (no OAuth client, no real calendars). */
async function rejectInDemo() {
  const { assertNotDemo } = await import("@/server/demo/mode.server");
  assertNotDemo("Google Calendar");
}

export const googleCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // The demo never connects a real calendar: report "not configured" instead of failing.
    const { isDemoMode } = await import("@/server/demo/mode.server");
    const off = { connected: false, importEvents: false, lastPulledAt: null as string | null };
    if (isDemoMode()) return { configured: false, ...off };
    const { googleOAuthConfig } = await import("@/server/googleOAuth.server");
    const configured = Boolean(googleOAuthConfig(process.env, requestOrigin()));
    if (!configured) return { configured, ...off };
    const { loadTokens, syncSettings } = await import("@/server/googleCalendar.server");
    if (!(await loadTokens(context.userId))) return { configured, ...off };
    return { configured, connected: true, ...(await syncSettings(context.userId)) };
  });

/** Returns Google's consent URL; the encrypted `state` binds the flow to this user. */
export const startGoogleCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await rejectInDemo();
    const { googleOAuthConfig, createOAuthState, pkceChallenge, buildAuthorizationUrl } =
      await import("@/server/googleOAuth.server");
    const config = googleOAuthConfig(process.env, requestOrigin());
    if (!config) throw new Error("Google Calendar belum dikonfigurasi (GOOGLE_CLIENT_ID/SECRET).");
    const { state, verifier } = await createOAuthState(context.userId);
    return {
      authorizationUrl: buildAuthorizationUrl(config, state, await pkceChallenge(verifier)),
    };
  });

export const completeGoogleCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(4096) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await rejectInDemo();
    const { googleOAuthConfig, verifyOAuthState, exchangeAuthorizationCode } =
      await import("@/server/googleOAuth.server");
    const config = googleOAuthConfig(process.env, requestOrigin());
    if (!config) throw new Error("Google Calendar belum dikonfigurasi.");
    const verifier = await verifyOAuthState(data.state, context.userId);
    const tokens = await exchangeAuthorizationCode(config, data.code, verifier);
    const { saveTokens } = await import("@/server/googleCalendar.server");
    await saveTokens(context.userId, tokens, { resetSync: true });
    return { ok: true };
  });

export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { disconnect } = await import("@/server/googleCalendar.server");
    await disconnect(context.userId);
    return { ok: true };
  });

export const syncTaskToGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ taskId: z.guid() }).parse(data))
  .handler(async ({ data, context }) => {
    await rejectInDemo();
    const { loadTokens, upsertTaskEvent, pushedFields } =
      await import("@/server/googleCalendar.server");
    if (!(await loadTokens(context.userId))) return { connected: false };
    // Read through RLS so a user can only sync tasks they can see.
    const { data: task, error } = await context.supabase
      .from("tasks")
      .select("id,title,description,start_date,due_date,time_block_end,updated_at,google_event_id")
      .eq("id", data.taskId)
      .single();
    if (error) throw new Error("Tugas tidak ditemukan.");
    const event = await upsertTaskEvent(context.userId, task);
    // Event link + etag (echo marker for the pull); bookkeeping only, `updated_at` is unchanged.
    await context.supabase
      .from("tasks")
      .update(pushedFields(event, task.updated_at))
      .eq("id", task.id);
    return { connected: true, eventId: event.id };
  });

/** Settings "Sinkronkan sekarang": pull Google changes, then push this user's linked tasks. */
export const syncGoogleCalendarNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await rejectInDemo();
    const { enforceRateLimit, CALENDAR_SYNC_RATE_LIMIT } =
      await import("@/server/rateLimit.server");
    await enforceRateLimit(context.supabase, CALENDAR_SYNC_RATE_LIMIT);
    const { loadTokens } = await import("@/server/googleCalendar.server");
    if (!(await loadTokens(context.userId))) throw new Error("Google Calendar belum terhubung.");
    const { syncCalendars } = await import("@/server/n8n/calendarSync.server");
    const r = await syncCalendars({
      userId: context.userId,
      sinceMinutes: 43_200,
      limit: 200,
      mode: "linked",
      direction: "both",
    });
    const pullError = r.pull.users.find((u) => u.error)?.error;
    if (pullError) throw new Error(pullError);
    return {
      pulled: r.pull.applied,
      pushed: r.synced,
      failed: r.failed + r.pull.failed,
    };
  });

/** Per-connection opt-in "Impor acara Google sebagai tugas" (default off). */
export const setGoogleCalendarImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ enabled: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    await rejectInDemo();
    const { setImportEvents } = await import("@/server/googleCalendar.server");
    await setImportEvents(context.userId, data.enabled);
    return { ok: true };
  });

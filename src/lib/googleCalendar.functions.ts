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
    if (isDemoMode()) return { configured: false, connected: false };
    const { googleOAuthConfig } = await import("@/server/googleOAuth.server");
    const configured = Boolean(googleOAuthConfig(process.env, requestOrigin()));
    if (!configured) return { configured, connected: false };
    const { loadTokens } = await import("@/server/googleCalendar.server");
    return { configured, connected: Boolean(await loadTokens(context.userId)) };
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
    await saveTokens(context.userId, tokens);
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
    const { loadTokens, upsertTaskEvent } = await import("@/server/googleCalendar.server");
    if (!(await loadTokens(context.userId))) return { connected: false };
    // Read through RLS so a user can only sync tasks they can see.
    const { data: task, error } = await context.supabase
      .from("tasks")
      .select("id,title,description,start_date,due_date,time_block_end,google_event_id")
      .eq("id", data.taskId)
      .single();
    if (error) throw new Error("Tugas tidak ditemukan.");
    const eventId = await upsertTaskEvent(context.userId, task);
    if (eventId !== task.google_event_id)
      await context.supabase.from("tasks").update({ google_event_id: eventId }).eq("id", task.id);
    return { connected: true, eventId };
  });

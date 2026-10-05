import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CONNECTOR = "google_calendar";
const SCOPES = ["https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/calendar.events"];

async function loadKey(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("app_user_connections").select("connection_key_ciphertext").eq("user_id", userId).eq("connector_id", CONNECTOR).maybeSingle();
  if (!data) return null;
  const { decryptConnectionKey } = await import("@/server/connectionKeyCrypto.server");
  return decryptConnectionKey(data.connection_key_ciphertext);
}

export const googleCalendarStatus = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => ({ connected: Boolean(await loadKey(context.userId)) }));

export const startGoogleCalendarConnect = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const clientAPIKey = process.env["GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY"];
  if (!clientAPIKey) throw new Error("Google Calendar belum tersedia untuk proyek ini.");
  const request = getRequest(); if (!request) throw new Error("Permintaan OAuth tidak tersedia.");
  const url = new URL(request.url); const sandboxHost = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
  const returnUrl = new URL("/oauth/google-calendar/return", sandboxHost ? `https://${sandboxHost}` : url.origin).toString();
  const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
  const connectionAPIKey = await loadKey(context.userId);
  return authorizeAppUserOAuth({ connectorId: CONNECTOR, appUserId: context.userId, clientAPIKey, returnUrl, ...(connectionAPIKey ? { connectionAPIKey } : {}), scopes: SCOPES });
});

export const completeGoogleCalendarConnect = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: { code: string }) => data).handler(async ({ data, context }) => {
  const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
  const { encryptConnectionKey } = await import("@/server/connectionKeyCrypto.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const encrypted = await encryptConnectionKey(await exchangeAppUserOAuthCode(data.code));
  const { error } = await supabaseAdmin.from("app_user_connections").upsert({ user_id: context.userId, connector_id: CONNECTOR, connection_key_ciphertext: encrypted, updated_at: new Date().toISOString() }, { onConflict: "user_id,connector_id" });
  if (error) throw error; return { ok: true };
});

export const disconnectGoogleCalendar = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const key = await loadKey(context.userId); if (!key) return { ok: true };
  const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector"); await disconnectAppUser(key);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("app_user_connections").delete().eq("user_id", context.userId).eq("connector_id", CONNECTOR); return { ok: true };
});

export const syncTaskToGoogle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((data: { taskId: string }) => data).handler(async ({ data, context }) => {
  const key = await loadKey(context.userId); if (!key) return { connected: false };
  const { data: task, error } = await context.supabase.from("tasks").select("id,title,description,start_date,due_date,time_block_end,google_event_id").eq("id", data.taskId).single();
  if (error) throw error; const start = task.start_date ?? task.due_date; if (!start) throw new Error("Tugas harus memiliki tanggal mulai atau tenggat.");
  const end = task.time_block_end ?? task.due_date ?? new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
  const path = task.google_event_id ? `/calendar/v3/calendars/primary/events/${encodeURIComponent(task.google_event_id)}` : "/calendar/v3/calendars/primary/events";
  const response = await callAsAppUser(key, path, { method: task.google_event_id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary: task.title, description: task.description, start: { dateTime: start }, end: { dateTime: end } }) });
  const text = await response.text(); if (!response.ok) throw new Error(`Google Calendar gagal [${response.status}]: ${text}`);
  const event = JSON.parse(text) as { id?: string }; if (event.id && !task.google_event_id) await context.supabase.from("tasks").update({ google_event_id: event.id }).eq("id", task.id);
  return { connected: true, eventId: event.id };
});
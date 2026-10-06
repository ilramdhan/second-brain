// Server-side Google Calendar access for one user: loads the encrypted tokens from
// `app_user_connections` (service role only), refreshes the access token when needed, and
// creates/updates/deletes the event of a task. Used by the Settings/task-dialog server functions
// and by POST /api/public/n8n/calendar/sync. Tokens never leave the server.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Tables } from "@/integrations/supabase/types";

import {
  accessTokenFresh,
  GOOGLE_CALENDAR_CONNECTOR,
  GoogleOAuthError,
  googleOAuthConfig,
  parseStoredTokens,
  refreshAccessToken,
  revokeToken,
  type StoredGoogleTokens,
} from "./googleOAuth.server";
import { decryptToken, encryptToken } from "./tokenCrypto.server";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export class CalendarNotConnectedError extends Error {
  constructor() {
    super("Google Calendar belum terhubung.");
    this.name = "CalendarNotConnectedError";
  }
}

export async function loadTokens(userId: string): Promise<StoredGoogleTokens | null> {
  const { data } = await supabaseAdmin
    .from("app_user_connections")
    .select("connection_key_ciphertext")
    .eq("user_id", userId)
    .eq("connector_id", GOOGLE_CALENDAR_CONNECTOR)
    .maybeSingle();
  if (!data) return null;
  let tokens: StoredGoogleTokens | null;
  try {
    tokens = parseStoredTokens(await decryptToken(data.connection_key_ciphertext));
  } catch {
    tokens = null;
  }
  // Rows from the old hosted connector (or encrypted with a rotated key) are unusable: drop them
  // so the UI shows "not connected" and the user reconnects once.
  if (!tokens) await deleteConnection(userId);
  return tokens;
}

export async function saveTokens(userId: string, tokens: StoredGoogleTokens) {
  const { error } = await supabaseAdmin.from("app_user_connections").upsert(
    {
      user_id: userId,
      connector_id: GOOGLE_CALENDAR_CONNECTOR,
      connection_key_ciphertext: await encryptToken(JSON.stringify(tokens)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,connector_id" },
  );
  if (error) throw new Error("Gagal menyimpan koneksi Google Calendar.");
}

export async function deleteConnection(userId: string) {
  await supabaseAdmin
    .from("app_user_connections")
    .delete()
    .eq("user_id", userId)
    .eq("connector_id", GOOGLE_CALENDAR_CONNECTOR);
}

/** Valid access token for the user (refreshing and persisting it when expired). */
export async function getAccessToken(userId: string): Promise<string> {
  const tokens = await loadTokens(userId);
  if (!tokens) throw new CalendarNotConnectedError();
  if (accessTokenFresh(tokens)) return tokens.access_token!;
  const config = googleOAuthConfig(process.env, "http://localhost");
  if (!config) throw new Error("Google OAuth belum dikonfigurasi (GOOGLE_CLIENT_ID/SECRET).");
  try {
    const refreshed = await refreshAccessToken(config, tokens);
    await saveTokens(userId, refreshed);
    return refreshed.access_token!;
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.code === "invalid_grant") {
      // Access was revoked in the Google account: forget the connection.
      await deleteConnection(userId);
      throw new CalendarNotConnectedError();
    }
    throw error;
  }
}

/** Revokes the refresh token at Google (best effort) and deletes the stored connection. */
export async function disconnect(userId: string) {
  const tokens = await loadTokens(userId);
  if (tokens) await revokeToken(tokens.refresh_token);
  await deleteConnection(userId);
}

type SyncTask = Pick<
  Tables<"tasks">,
  "id" | "title" | "description" | "start_date" | "due_date" | "time_block_end" | "google_event_id"
>;

/** Event body for a task (pure). Throws when the task has no date. */
export function taskToEvent(task: SyncTask) {
  const start = task.start_date ?? task.due_date;
  if (!start) throw new Error("Tugas harus memiliki tanggal mulai atau tenggat.");
  const startMs = new Date(start).getTime();
  let end = task.time_block_end ?? task.due_date;
  if (!end || new Date(end).getTime() <= startMs)
    end = new Date(startMs + 30 * 60_000).toISOString();
  return {
    summary: task.title,
    description: task.description ?? undefined,
    start: { dateTime: new Date(start).toISOString() },
    end: { dateTime: new Date(end).toISOString() },
    // Lets the Google → app workflow (n8n 07) skip events the app created itself.
    extendedProperties: { private: { second_brain_task_id: task.id } },
  };
}

async function calendarFetch(token: string, url: string, init: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * Creates or updates the event of `task` in the user's primary calendar. Recreates the event
 * when it was deleted in Google (404/410). Returns the event id.
 */
export async function upsertTaskEvent(userId: string, task: SyncTask): Promise<string> {
  const token = await getAccessToken(userId);
  const body = JSON.stringify(taskToEvent(task));
  if (task.google_event_id) {
    const res = await calendarFetch(
      token,
      `${CALENDAR_API}/${encodeURIComponent(task.google_event_id)}`,
      { method: "PATCH", body },
    );
    if (res.ok) return task.google_event_id;
    if (res.status !== 404 && res.status !== 410)
      throw new Error(`Google Calendar gagal [${res.status}]`);
  }
  const res = await calendarFetch(token, CALENDAR_API, { method: "POST", body });
  if (!res.ok) throw new Error(`Google Calendar gagal [${res.status}]`);
  const event = (await res.json()) as { id?: string };
  if (!event.id) throw new Error("Google Calendar tidak mengembalikan id event.");
  return event.id;
}

/** Deletes an event; already-gone events count as success. */
export async function deleteTaskEvent(userId: string, eventId: string) {
  const token = await getAccessToken(userId);
  const res = await calendarFetch(token, `${CALENDAR_API}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404 && res.status !== 410)
    throw new Error(`Google Calendar gagal [${res.status}]`);
}

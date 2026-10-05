// POST /api/public/n8n/capture — generic capture (email, Google Calendar, webhooks) into the
// inbox, a task or a note of the user identified by email or linked Telegram chat.
import type { CaptureRequest } from "./schemas.server";
import { N8nHttpError } from "./http.server";
import * as svc from "./service.server";
import { appTimezone, parseTaskTextInZone } from "./time.server";

export type CaptureResult = {
  ok: true;
  type: "task" | "note" | "inbox";
  id: string;
  duplicate: boolean;
};

export async function resolveCaptureUser(body: Pick<CaptureRequest, "user_email" | "chat_id">) {
  const userId = body.chat_id
    ? await svc.userIdByChat(body.chat_id)
    : body.user_email
      ? await svc.userIdByEmail(body.user_email)
      : null;
  if (!userId) throw new N8nHttpError(404, "user not found");
  return userId;
}

/** Decides the target for `auto` (pure): a date or priority in the text makes it a task. */
export function autoTarget(text: string, now: Date, tz: string): "task" | "inbox" {
  const parsed = parseTaskTextInZone(text, now, tz);
  return parsed.due || parsed.priority ? "task" : "inbox";
}

export async function capture(
  userId: string,
  body: CaptureRequest,
  origin: string | null,
): Promise<Omit<CaptureResult, "duplicate">> {
  const tz = appTimezone();
  const now = new Date();
  const title = body.title?.trim() || "";
  const text = body.text?.trim() || "";
  const headline = title || text.split("\n")[0]!.slice(0, 300);
  const target = body.target === "auto" ? autoTarget(headline, now, tz) : body.target;
  const inboxSource =
    body.source === "manual" ? "manual" : body.source === "telegram" ? "telegram" : body.source;
  const link = body.url ? `\n\n${body.url}` : "";

  if (target === "task") {
    const parsed = parseTaskTextInZone(headline, now, tz);
    const tags = [
      ...new Set([
        ...(body.tags ?? []).map((t) => t.replace(/^#/, "").toLowerCase()),
        ...parsed.tags,
      ]),
    ];
    const description =
      [body.description?.trim() || (title && text ? text : ""), body.url ?? ""]
        .filter(Boolean)
        .join("\n\n") || null;
    const task = await svc.createTask(
      userId,
      {
        title: (parsed.title || headline).slice(0, 300),
        description: description?.slice(0, 20_000) ?? null,
        start_date: body.start_date ? new Date(body.start_date).toISOString() : null,
        due_date: body.due_date
          ? new Date(body.due_date).toISOString()
          : (parsed.due?.toISOString() ?? null),
        priority: body.priority ?? parsed.priority ?? "medium",
        tags,
        project_id: await svc.resolveProjectId(userId, body.project ?? parsed.project),
        recurrence: parsed.recurrence,
        google_event_id: body.google_event_id ?? null,
      },
      origin,
    );
    return { ok: true, type: "task", id: task.id };
  }

  const summary = body.summarize && text ? await svc.summarizeForUser(userId, text) : null;
  if (target === "note") {
    const content = [summary ? `> Ringkasan AI\n${summary}\n\n---` : "", text, body.url ?? ""]
      .filter(Boolean)
      .join("\n");
    const note = await svc.createNote(userId, headline || "Catatan", content, {
      tags: body.tags ?? [],
      project_id: await svc.resolveProjectId(userId, body.project),
    });
    return { ok: true, type: "note", id: note.id };
  }
  const content = (title && text ? `${title}\n\n${text}` : title || text) + link;
  const item = await svc.createInboxItem(userId, content, inboxSource, summary);
  return { ok: true, type: "inbox", id: item.id };
}

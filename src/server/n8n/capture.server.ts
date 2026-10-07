// POST /api/public/n8n/capture — generic capture (email, Google Calendar, webhooks) into the
// inbox, a task or a note of the user identified by email or linked Telegram chat.
import type { CaptureRequest } from "./schemas.server";
import { N8nHttpError } from "./http.server";
import * as svc from "./service.server";
import { looksLikeNote } from "../noteExtract.server";
import { looksLikeTask, matchByName } from "../taskExtract.server";
import { appTimezone } from "./time.server";

export type CaptureResult = {
  ok: true;
  type: "task" | "note" | "inbox";
  id: string;
  duplicate: boolean;
  /** Tasks and notes: who filled the fields ("ai" or the local "regex" parser) and which ones. */
  via?: "ai" | "regex";
  filled?: string[];
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

/**
 * Decides the target for `auto` (pure): "catatan:"/"note:" or a [[link]] makes it a note, a
 * date, priority, estimate or status makes it a task, anything else goes to the inbox.
 */
export function autoTarget(text: string, now: Date, tz: string): "task" | "note" | "inbox" {
  if (looksLikeNote(text)) return "note";
  return looksLikeTask(text, now, tz) ? "task" : "inbox";
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
    // Full-field extraction (AI, regex fallback) over the message; explicit fields sent by n8n
    // (dates, priority, tags, project, description, url) always win over extracted values.
    const message = title && text ? `${title}\n${text}` : headline || text;
    const { captureTaskFromText } = await import("../taskCapture.server");
    const result = await captureTaskFromText(userId, message, {
      clock: { now, tz },
      origin,
      adjust: (resolved, candidates) => {
        const t = resolved.insert;
        if (body.description?.trim()) t.description = body.description.trim();
        if (body.url) t.description = [t.description, body.url].filter(Boolean).join("\n\n");
        if (t.description) t.description = t.description.slice(0, 20_000);
        if (body.start_date) t.start_date = new Date(body.start_date).toISOString();
        if (body.due_date) t.due_date = new Date(body.due_date).toISOString();
        if (body.priority) t.priority = body.priority;
        if (body.tags?.length)
          t.tags = [
            ...new Set([...body.tags.map((x) => x.replace(/^#/, "").toLowerCase()), ...t.tags]),
          ].slice(0, 20);
        if (body.project) {
          const project = matchByName(body.project, candidates.projects, (p) => p.name);
          if (project && project.id !== t.project_id) {
            t.project_id = project.id;
            resolved.project = project;
            // The assignee must belong to the project the task ends up in.
            if (
              t.assignee_id &&
              !candidates.members.some(
                (m) => m.project_id === project.id && m.user_id === t.assignee_id,
              )
            ) {
              t.assignee_id = null;
              t.assignee_name = null;
            }
          }
        }
        if (body.google_event_id) t.google_event_id = body.google_event_id;
      },
    });
    return {
      ok: true,
      type: "task",
      id: result.task.id,
      via: result.via,
      filled: result.resolved.filled,
    };
  }

  const summary = body.summarize && text ? await svc.summarizeForUser(userId, text) : null;
  if (target === "note") {
    // Full-field extraction (AI, local fallback) over title + text; explicit body fields (tags,
    // project) win, the AI summary and the url are appended as blocks.
    const message = [title, text].filter(Boolean).join("\n") || "Catatan";
    const { captureNoteFromText } = await import("../noteCapture.server");
    const { loadBlocks } = await import("@/lib/blocks");
    const result = await captureNoteFromText(userId, message, {
      clock: { now, tz },
      origin,
      adjust: (resolved, candidates) => {
        const n = resolved.insert;
        if (title) n.title = title.slice(0, 300);
        if (body.tags?.length) {
          n.tags = [
            ...new Set([...body.tags.map((x) => x.replace(/^#/, "").toLowerCase()), ...n.tags]),
          ].slice(0, 20);
          if (!resolved.filled.includes("tags")) resolved.filled.push("tags");
        }
        if (body.project) {
          const project = matchByName(body.project, candidates.projects, (p) => p.name);
          if (project) {
            n.project_id = project.id;
            resolved.project = project;
            if (!resolved.filled.includes("project")) resolved.filled.push("project");
          }
        }
        const extra = [summary ? `> Ringkasan AI\n${summary}\n\n---` : "", body.url ?? ""].filter(
          Boolean,
        );
        if (extra.length) {
          const blocks = loadBlocks({ blocks: [], content: extra.join("\n") });
          // Drop the empty placeholder block a note without body gets.
          const body = n.blocks.filter((b) => b.text || b.type === "divider");
          n.blocks = summary ? [...blocks, ...body] : [...body, ...blocks];
        }
      },
    });
    return {
      ok: true,
      type: "note",
      id: result.note.id,
      via: result.via,
      filled: result.resolved.filled,
    };
  }
  const content = (title && text ? `${title}\n\n${text}` : title || text) + link;
  const item = await svc.createInboxItem(userId, content, inboxSource, summary);
  return { ok: true, type: "inbox", id: item.id };
}

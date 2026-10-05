// Request schemas for /api/public/n8n/* (contracts: integrations/n8n/README.md). Pure, tested.
import { z } from "zod";

const chatId = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^-?\d{1,20}$/, "invalid chat_id"));
const optText = (max: number) => z.string().max(max).nullish();
const isoDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "invalid date" });

export const botSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    chat_id: chatId,
    message_id: z.number().int().nullish(),
    username: optText(64),
    first_name: optText(128),
    kind: z.enum(["text", "callback", "ocr", "voice"]),
    source: z.enum(["telegram", "ocr", "voice"]).nullish(),
    text: optText(8000),
    callback_data: z.string().max(64).nullish(),
    ocr_text: optText(20_000),
    file_name: optText(255),
    mime_type: optText(100),
    ocr_model: optText(100),
    transcript: optText(20_000),
    duration: z.number().nonnegative().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "text" && !v.text?.trim())
      ctx.addIssue({ code: "custom", path: ["text"], message: "required for kind=text" });
    if (v.kind === "callback" && !v.callback_data)
      ctx.addIssue({ code: "custom", path: ["callback_data"], message: "required" });
    if (v.kind === "ocr" && !v.ocr_text?.trim())
      ctx.addIssue({ code: "custom", path: ["ocr_text"], message: "required for kind=ocr" });
    if (v.kind === "voice" && !v.transcript?.trim())
      ctx.addIssue({ code: "custom", path: ["transcript"], message: "required for kind=voice" });
  });
export type BotRequest = z.infer<typeof botSchema>;

export const captureSchema = z
  .object({
    user_email: z.string().trim().email().max(320).nullish(),
    chat_id: chatId.nullish(),
    source: z
      .enum(["email", "google_calendar", "webhook", "telegram", "manual"])
      .default("webhook"),
    target: z.enum(["inbox", "task", "note", "auto"]).default("inbox"),
    title: optText(300),
    text: optText(20_000),
    description: optText(20_000),
    start_date: isoDate.nullish(),
    due_date: isoDate.nullish(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).nullish(),
    project: optText(200),
    priority: z.enum(["high", "medium", "low"]).nullish(),
    summarize: z.boolean().default(false),
    external_id: z.string().trim().min(1).max(500).nullish(),
    google_event_id: optText(1024),
    url: z.string().url().max(2000).nullish(),
  })
  .superRefine((v, ctx) => {
    if (!v.user_email && !v.chat_id)
      ctx.addIssue({
        code: "custom",
        path: ["user_email"],
        message: "user_email or chat_id required",
      });
    if (!v.title?.trim() && !v.text?.trim())
      ctx.addIssue({ code: "custom", path: ["text"], message: "title or text required" });
  });
export type CaptureRequest = z.infer<typeof captureSchema>;

export const DIGEST_KINDS = ["morning", "evening", "overdue", "weekly"] as const;
export type DigestKind = (typeof DIGEST_KINDS)[number];
export const digestQuerySchema = z.object({
  kind: z.enum(DIGEST_KINDS),
  user_id: z.string().uuid().optional(),
});

export const remindersSchema = z.object({
  lead_minutes: z.number().int().min(1).max(10_080).default(60),
  include_overdue: z.boolean().default(true),
  /** false = only preview, do not set tasks.reminded */
  mark: z.boolean().default(true),
  limit: z.number().int().min(1).max(1000).default(500),
});

export const MAINTENANCE_TASKS = [
  "purge_trash",
  "link_codes",
  "rate_limits",
  "n8n_events",
  "recurring",
] as const;
export const maintenanceSchema = z.object({
  tasks: z
    .array(z.enum(MAINTENANCE_TASKS))
    .min(1)
    .default(["purge_trash", "link_codes", "rate_limits", "n8n_events"]),
  purge_after_days: z.number().int().min(1).max(3650).default(30),
  events_after_days: z.number().int().min(1).max(3650).default(30),
});

export const backupQuerySchema = z.object({
  userId: z.union([z.literal("all"), z.string().uuid()]).default("all"),
  include: z.enum(["all", "active"]).default("all"),
  versions: z.enum(["0", "1"]).default("0"),
  page: z.coerce.number().int().min(0).max(100_000).default(0),
  page_size: z.coerce.number().int().min(1).max(50).default(10),
});

export const calendarSyncSchema = z.object({
  since_minutes: z.number().int().min(1).max(43_200).default(45),
  limit: z.number().int().min(1).max(500).default(200),
  user_id: z.string().uuid().optional(),
  /** linked = only tasks already sent to Google; all = every dated task changed in the window */
  mode: z.enum(["linked", "all"]).default("linked"),
});

export const eventSchema = z.object({
  type: z.string().trim().min(1).max(64),
  workflow: optText(200),
  node: optText(200),
  message: optText(4000),
  execution_id: optText(100),
  execution_url: z.string().url().max(2000).nullish(),
  at: isoDate.nullish(),
});

/** Parses `<action>:<id>[:<arg>]` callback data from inline buttons (≤ 64 bytes). */
export type Callback =
  | { action: "done" | "totask" | "tonote" | "del"; id: string }
  | { action: "snooze"; id: string; minutes: number }
  | { action: "page"; list: "inbox"; page: number };

const SNOOZE: Record<string, number> = { "1h": 60, "3h": 180, "1d": 1440, "1w": 10_080 };
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCallback(data: string): Callback | null {
  const [action, a, b] = data.split(":");
  if (action === "page" && a === "inbox" && /^\d{1,4}$/.test(b ?? "")) {
    return { action: "page", list: "inbox", page: Number(b) };
  }
  if (!a || !uuidRe.test(a)) return null;
  if (action === "snooze") {
    const minutes = SNOOZE[b ?? "1d"];
    return minutes ? { action, id: a, minutes } : null;
  }
  if (action === "done" || action === "totask" || action === "tonote" || action === "del")
    return { action, id: a };
  return null;
}

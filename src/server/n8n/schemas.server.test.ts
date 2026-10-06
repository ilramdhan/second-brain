import { describe, expect, it } from "vitest";

import {
  backupQuerySchema,
  botSchema,
  captureSchema,
  digestQuerySchema,
  maintenanceSchema,
  parseCallback,
  remindersSchema,
} from "./schemas.server";

const id = "7f3c2b1a-0000-4000-8000-000000000001";

describe("botSchema", () => {
  it("accepts a text update and normalizes chat_id", () => {
    const v = botSchema.parse({ update_id: 1, chat_id: 111, kind: "text", text: "/today" });
    expect(v.chat_id).toBe("111");
  });
  it("requires the payload of each kind", () => {
    expect(botSchema.safeParse({ update_id: 1, chat_id: "1", kind: "text" }).success).toBe(false);
    expect(
      botSchema.safeParse({ update_id: 1, chat_id: "1", kind: "ocr", text: null }).success,
    ).toBe(false);
    expect(
      botSchema.safeParse({ update_id: 1, chat_id: "1", kind: "voice", transcript: "halo" })
        .success,
    ).toBe(true);
    expect(botSchema.safeParse({ update_id: 1, chat_id: "1", kind: "callback" }).success).toBe(
      false,
    );
  });
  it("rejects malformed chat ids and oversized callback data", () => {
    expect(
      botSchema.safeParse({ update_id: 1, chat_id: "abc", kind: "text", text: "x" }).success,
    ).toBe(false);
    expect(
      botSchema.safeParse({
        update_id: 1,
        chat_id: "1",
        kind: "callback",
        callback_data: "x".repeat(65),
      }).success,
    ).toBe(false);
  });
});

describe("captureSchema", () => {
  it("needs a user and some content", () => {
    expect(captureSchema.safeParse({ text: "x" }).success).toBe(false);
    expect(captureSchema.safeParse({ user_email: "a@b.co" }).success).toBe(false);
    const v = captureSchema.parse({ user_email: "a@b.co", text: "hi" });
    expect(v).toMatchObject({ source: "webhook", target: "inbox", summarize: false });
  });
  it("validates dates, sources and emails", () => {
    expect(captureSchema.safeParse({ user_email: "x", text: "t" }).success).toBe(false);
    expect(captureSchema.safeParse({ chat_id: "1", text: "t", due_date: "nope" }).success).toBe(
      false,
    );
    expect(captureSchema.safeParse({ chat_id: "1", text: "t", source: "sms" }).success).toBe(false);
    expect(
      captureSchema.safeParse({
        chat_id: "1",
        text: "t",
        source: "google_calendar",
        target: "task",
      }).success,
    ).toBe(true);
  });
});

describe("query/body schemas", () => {
  it("digest kind is an enum", () => {
    expect(digestQuerySchema.safeParse({ kind: "weekly" }).success).toBe(true);
    expect(digestQuerySchema.safeParse({ kind: "monthly" }).success).toBe(false);
  });
  it("applies defaults", () => {
    expect(remindersSchema.parse({})).toMatchObject({
      lead_minutes: 60,
      include_overdue: true,
      mark: true,
    });
    expect(maintenanceSchema.parse({}).tasks).toContain("purge_trash");
    // Semantic indexing is opt-in (it calls the AI provider) with a bounded batch count.
    expect(maintenanceSchema.parse({}).tasks).not.toContain("semantic_index");
    expect(maintenanceSchema.parse({ tasks: ["semantic_index"] })).toMatchObject({
      tasks: ["semantic_index"],
      semantic_batches: 4,
    });
    expect(backupQuerySchema.parse({})).toMatchObject({ userId: "all", include: "all", page: 0 });
    expect(backupQuerySchema.parse({ page: "2", page_size: "5" })).toMatchObject({
      page: 2,
      page_size: 5,
    });
  });
  it("rejects invalid values", () => {
    expect(maintenanceSchema.safeParse({ tasks: ["drop_db"] }).success).toBe(false);
    expect(maintenanceSchema.safeParse({ semantic_batches: 21 }).success).toBe(false);
    expect(backupQuerySchema.safeParse({ userId: "nope" }).success).toBe(false);
    expect(remindersSchema.safeParse({ lead_minutes: 0 }).success).toBe(false);
  });
});

describe("parseCallback", () => {
  it("parses known actions", () => {
    expect(parseCallback(`done:${id}`)).toEqual({ action: "done", id });
    expect(parseCallback(`snooze:${id}:1h`)).toEqual({ action: "snooze", id, minutes: 60 });
    expect(parseCallback(`snooze:${id}`)).toEqual({ action: "snooze", id, minutes: 1440 });
    expect(parseCallback("page:inbox:2")).toEqual({ action: "page", list: "inbox", page: 2 });
  });
  it("rejects unknown actions and non-uuid ids", () => {
    expect(parseCallback("drop:x")).toBeNull();
    expect(parseCallback("done:123")).toBeNull();
    expect(parseCallback(`snooze:${id}:9y`)).toBeNull();
  });
});

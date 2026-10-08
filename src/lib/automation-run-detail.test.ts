import { describe, expect, it } from "vitest";

import {
  failureStep,
  formatRunDetail,
  parseRunDetail,
  RUN_DETAIL_MAX,
  runDetailTextId,
  serializeRunDetail,
  type RunStep,
} from "./automation-run-detail";
import { CronError } from "./cron";
import { format, messages, type Locale, type MessageKey, type MessageVars } from "./i18n";

const tr = (locale: Locale) => (key: MessageKey, vars?: MessageVars) =>
  format(messages[locale][key], vars);
const render = (locale: Locale, detail: string) => formatRunDetail(tr(locale), detail);

describe("formatRunDetail", () => {
  it("renders every step in the UI language", () => {
    const detail = serializeRunDetail("task", "Write spec", [
      { code: "setField", params: { field: "status", value: "done" } },
      { code: "setField", params: { field: "priority", value: "high" } },
      { code: "addTag", params: { tag: "urgent" } },
      { code: "shiftDue", params: { days: 2 } },
      { code: "comment" },
      { code: "telegram" },
      { code: "webhook" },
    ]);
    expect(render("id", detail)).toBe(
      "Write spec → Status → Selesai; Prioritas → Tinggi; tag #urgent ditambahkan; " +
        "tenggat digeser 2 hari; komentar ditambahkan; terkirim ke Telegram; webhook terkirim",
    );
    expect(render("en", detail)).toBe(
      "Write spec → Status → Done; Priority → High; tag #urgent added; " +
        "due date shifted by 2 days; comment added; sent to Telegram; webhook sent",
    );
  });

  it("renders note and schedule steps", () => {
    const note = serializeRunDetail("note", "Rapat", [
      { code: "tagExists", params: { tag: "rapat" } },
      { code: "linkProject", params: { project: "Kasir" } },
      { code: "createTask", params: { title: "Tindak lanjut" } },
      { code: "notApplicable", params: { action: "shift_due", scope: "note" } },
    ]);
    expect(render("en", note)).toBe(
      'Rapat → tag #rapat already present; linked to project Kasir; task "Tindak lanjut" ' +
        'created; action "Shift due date" does not apply to Note',
    );
    const sched = serializeRunDetail("schedule", "Pagi", [
      { code: "moveOverdue", params: { count: 3, status: "todo" } },
      { code: "digestSent", params: { kind: "morning", channel: "telegram" } },
      { code: "digestEmpty", params: { kind: "weekly" } },
      { code: "skippedDemo", params: { channel: "webhook" } },
    ]);
    expect(render("en", sched)).toBe(
      '⏰ Pagi → 3 overdue tasks → To do; "Today\'s plan" summary sent to Telegram; ' +
        '"Weekly summary" summary empty, not sent; webhook skipped (demo)',
    );
    expect(render("id", serializeRunDetail("schedule", "Pagi", []))).toBe("⏰ Pagi → tanpa aksi");
    expect(render("en", serializeRunDetail("schedule", "Pagi", []))).toBe("⏰ Pagi → no action");
  });

  it("translates known failures, cron errors and keeps unknown messages", () => {
    const detail = serializeRunDetail("schedule", "R", [
      failureStep(new Error("Akun Telegram belum ditautkan")),
      failureStep(new Error("Webhook 502")),
      failureStep(
        new CronError("cronErrRange", { field: "cronErrFieldHour", raw: "25", min: 0, max: 23 }),
      ),
      { code: "scheduleStopped" },
      failureStep(new Error("permission denied")),
    ]);
    const en = render("en", detail);
    expect(en).toContain("failed: Telegram account not linked");
    expect(en).toContain("failed: webhook answered HTTP 502");
    expect(en).toContain(
      `failed: ${format(messages.en.cronErrRange, { field: messages.en.cronErrFieldHour, raw: "25", min: 0, max: 23 })}`,
    );
    expect(en).toContain("schedule stopped; failed: permission denied");
    expect(render("id", detail)).toContain("gagal: akun Telegram belum ditautkan");
  });

  it("shows legacy plain-text rows and malformed JSON unchanged", () => {
    for (const legacy of [
      "Write spec → ubah tags",
      "⏰ Pagi → tanpa aksi",
      '{"not": "a detail"}',
      '{"v":1,"kind":"task","subject":"x","steps":[{"code":1}]}',
      '{"v":2,"kind":"task","subject":"x","steps":[]}',
      "{broken",
    ]) {
      expect(render("en", legacy)).toBe(legacy);
      expect(parseRunDetail(legacy)).toBeNull();
    }
    expect(render("en", "")).toBe("");
    expect(formatRunDetail(tr("en"), null)).toBe("");
  });

  it("shows an unknown (newer) step code as is", () => {
    const raw = JSON.stringify({ v: 1, kind: "task", subject: "x", steps: [{ code: "future" }] });
    expect(render("en", raw)).toBe("x → future");
  });
});

describe("serializeRunDetail", () => {
  it("stays valid JSON within the column limit, folding cut steps into `more`", () => {
    const steps: RunStep[] = Array.from({ length: 40 }, (_, i) => ({
      code: "createTask",
      params: { title: `Task number ${i} with a fairly long title` },
    }));
    const out = serializeRunDetail("note", "N".repeat(300), steps);
    expect(out.length).toBeLessThanOrEqual(RUN_DETAIL_MAX);
    const parsed = parseRunDetail(out)!;
    expect(parsed.subject.length).toBeLessThanOrEqual(120);
    const last = parsed.steps.at(-1)!;
    expect(last.code).toBe("more");
    expect(parsed.steps.length - 1 + Number(last.params!["count"])).toBe(40);
    expect(render("en", out)).toMatch(/\+\d+ more steps$/);
  });

  it("keeps short details intact", () => {
    const out = serializeRunDetail("task", "T", [{ code: "comment" }]);
    expect(JSON.parse(out)).toEqual({
      v: 1,
      kind: "task",
      subject: "T",
      steps: [{ code: "comment" }],
    });
  });
});

describe("failureStep", () => {
  it("maps SSRF refusals without echoing the URL", () => {
    expect(failureStep(new Error("Alamat webhook mengarah ke jaringan internal"))).toEqual({
      code: "failed",
      params: { reason: "webhookUnsafe" },
    });
    expect(failureStep(new Error("Telegram gagal [403]"))).toEqual({
      code: "failed",
      params: { reason: "telegramHttp", status: 403 },
    });
    expect(failureStep("weird")).toEqual({ code: "failed", params: { message: "error" } });
  });

  it("runDetailTextId renders Indonesian for server responses", () => {
    const d = serializeRunDetail("schedule", "Pagi", [failureStep(new Error("tag kosong"))]);
    expect(runDetailTextId(d)).toBe("⏰ Pagi → gagal: tag kosong");
  });
});

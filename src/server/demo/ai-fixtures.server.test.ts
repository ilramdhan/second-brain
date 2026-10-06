import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_BRAIN_DUMP_EXAMPLES,
  DEMO_INBOX_ITEMS,
  DEMO_MEETING_EXAMPLES,
  DEMO_MEETING_NOTE,
  DEMO_OCR_TEXT,
  DEMO_PARAPHRASE_EXAMPLES,
  DEMO_VOICE_TRANSCRIPT,
  isDemoGenericReply,
} from "@/lib/demo-examples";
import { zonedIsoDate } from "@/server/n8n/time.server";

import {
  demoBrainDump,
  demoDelay,
  demoText,
  demoTranscript,
  matchFixture,
} from "./ai-fixtures.server";

// Tue 6 Oct 2026, 03:00 in Jakarta (still Mon 5 Oct in UTC).
const clock = { now: new Date("2026-10-05T20:00:00Z"), tz: "Asia/Jakarta" };

afterEach(() => vi.useRealTimers());

describe("zonedIsoDate", () => {
  it("returns the calendar day in the app zone and shifts by days", () => {
    expect(zonedIsoDate(clock.now, "Asia/Jakarta")).toBe("2026-10-06");
    expect(zonedIsoDate(clock.now, "UTC")).toBe("2026-10-05");
    expect(zonedIsoDate(clock.now, "Asia/Jakarta", 27)).toBe("2026-11-02");
  });
});

describe("demoBrainDump", () => {
  it("answers every brain dump example with a fixture", () => {
    for (const example of DEMO_BRAIN_DUMP_EXAMPLES) {
      const items = demoBrainDump(example.text, [], clock);
      expect(items.length).toBeGreaterThanOrEqual(3);
      for (const item of items) {
        expect(item.title.length).toBeGreaterThan(3);
        expect(["task", "note", "issue"]).toContain(item.kind);
        expect(["high", "medium", "low"]).toContain(item.priority);
        if (item.due_date) expect(item.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("dates fixtures relative to today in APP_TIMEZONE", () => {
    const [bug, report] = demoBrainDump(DEMO_BRAIN_DUMP_EXAMPLES[0]!.text, [], clock);
    expect(bug).toMatchObject({ kind: "issue", priority: "high", due_date: "2026-10-07" });
    // "target Jumat": the next Friday after Tuesday 6 Oct.
    expect(report!.due_date).toBe("2026-10-09");
    const later = demoBrainDump(DEMO_BRAIN_DUMP_EXAMPLES[0]!.text, [], {
      ...clock,
      now: new Date("2026-12-01T05:00:00Z"),
    });
    expect(later[0]!.due_date).toBe("2026-12-02");
  });

  it("reuses the user's existing project names", () => {
    const items = demoBrainDump(DEMO_BRAIN_DUMP_EXAMPLES[0]!.text, ["aplikasi kasir"], clock);
    expect(new Set(items.map((i) => i.project))).toEqual(new Set(["aplikasi kasir"]));
  });

  it("matches edited examples by keyword", () => {
    const items = demoBrainDump("printer struk error di kasir cabang 2", [], clock);
    expect(items[0]!.title).toMatch(/printer Bluetooth/);
  });

  it("has fixtures for every seeded inbox item", () => {
    for (const item of DEMO_INBOX_ITEMS) {
      const [first] = demoBrainDump(item.content, [], clock);
      // A fixture, not the line-by-line fallback (which would echo the raw first line).
      expect(first!.title).not.toBe(item.content.split("\n")[0]);
      expect(first!.tags.length).toBeGreaterThan(0);
    }
    expect(demoBrainDump(DEMO_VOICE_TRANSCRIPT, [], clock)[0]!.title).toBe(
      "Kirim proposal ke klien",
    );
  });

  it("falls back to the local NLP parser, one item per line", () => {
    const items = demoBrainDump(
      "Agenda:\n- kirim invoice besok #keuangan !1\n- bug login di android\n- ide: tema gelap",
      ["Keuangan"],
      clock,
    );
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      title: "kirim invoice",
      due_date: "2026-10-07",
      tags: ["keuangan"],
      priority: "high",
      kind: "task",
    });
    expect(items[1]!.kind).toBe("issue");
    expect(items[2]!.kind).toBe("note");
  });
});

describe("demoText", () => {
  it("returns fixtures for the examples", () => {
    for (const example of DEMO_PARAPHRASE_EXAMPLES) {
      const out = demoText("paraphrase", example.text);
      expect(isDemoGenericReply(out)).toBe(false);
      expect(out.length).toBeGreaterThan(example.text.length);
    }
    for (const example of DEMO_MEETING_EXAMPLES) {
      const out = demoText("meeting", example.text);
      expect(out).toMatch(/^## Ringkasan/);
      expect(out).toContain("## Action Items");
    }
    expect(demoText("meeting", DEMO_MEETING_NOTE.content)).toContain("Budi");
  });

  it("answers free input with the generic example hint", () => {
    const out = demoText("paraphrase", "sesuatu yang lain sama sekali");
    expect(out).toMatch(/^Di demo, AI memakai contoh\. Coba salah satu contoh berikut/);
    expect(isDemoGenericReply(out)).toBe(true);
    expect(isDemoGenericReply(demoText("meeting", "rapat"))).toBe(true);
  });

  it("returns the sample OCR text, a bullet summary and the sample transcript", () => {
    expect(demoText("ocr", "")).toBe(DEMO_OCR_TEXT);
    expect(demoText("summary", "Satu. Dua.\n- tiga")).toBe("- Satu.\n- Dua.\n- tiga");
    expect(demoTranscript()).toBe(DEMO_VOICE_TRANSCRIPT);
  });

  it("requires enough keyword hits before matching", () => {
    expect(matchFixture("printer", { a: ["printer", "garansi"] }, [])).toBeNull();
    expect(matchFixture("garansi printer", { a: ["printer", "garansi"] }, [])).toBe("a");
  });
});

describe("demoDelay", () => {
  it("waits, then resolves", async () => {
    vi.useFakeTimers();
    let done = false;
    const wait = demoDelay(undefined, 800).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(799);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(done).toBe(true);
  });

  it("rejects when the request is aborted", async () => {
    const controller = new AbortController();
    const wait = demoDelay(controller.signal, 10_000);
    controller.abort();
    await expect(wait).rejects.toMatchObject({ name: "AbortError" });
    await expect(demoDelay(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_BRAIN_DUMP_EXAMPLES,
  DEMO_INBOX_ITEMS,
  DEMO_MEETING_EXAMPLES,
  DEMO_MEETING_NOTE,
  DEMO_NOTE_CAPTURE_EXAMPLES,
  DEMO_OCR_TEXT,
  DEMO_PARAPHRASE_EXAMPLES,
  DEMO_TASK_CAPTURE_EXAMPLES,
  DEMO_VOICE_TRANSCRIPT,
  isDemoGenericReply,
} from "@/lib/demo-examples";
import { zonedIsoDate } from "@/server/n8n/time.server";
import { extractedNoteSchema, resolveNoteExtraction } from "@/server/noteExtract.server";
import { extractedTaskSchema, resolveExtraction } from "@/server/taskExtract.server";

import {
  demoBrainDump,
  demoDelay,
  demoExtractNote,
  demoExtractTask,
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

describe("demoExtractTask", () => {
  const candidates = {
    projects: [{ id: "p1", name: "Aplikasi Kasir" }],
    members: [{ project_id: "p1", user_id: "u-rina", name: "Rina" }],
    tasks: [{ id: "t1", title: "API laporan penjualan harian" }],
  };

  it("fills every field for the full example, and the references resolve on the seed", () => {
    const x = demoExtractTask(DEMO_TASK_CAPTURE_EXAMPLES[0]!.text, candidates, clock);
    expect(extractedTaskSchema.safeParse(x).success).toBe(true);
    const r = resolveExtraction(x, candidates, clock, "");
    expect(r.insert).toMatchObject({ project_id: "p1", assignee_id: "u-rina", priority: "high" });
    expect(r.dependsOn).toEqual([{ id: "t1", title: "API laporan penjualan harian" }]);
    expect(r.comments).toHaveLength(1);
    expect(r.dropped).toEqual([]);
  });

  it("answers every example and falls back to the regex parser for free input", () => {
    for (const ex of DEMO_TASK_CAPTURE_EXAMPLES)
      expect(
        extractedTaskSchema.safeParse(demoExtractTask(ex.text, candidates, clock)).success,
      ).toBe(true);
    const free = demoExtractTask("Beli tinta printer besok !rendah", candidates, clock);
    expect(free).toMatchObject({ title: "Beli tinta printer", priority: "low" });
  });

  it("is in the demo inbox seed", () => {
    expect(DEMO_INBOX_ITEMS.map((i) => i.content)).toContain(DEMO_TASK_CAPTURE_EXAMPLES[0]!.text);
  });
});

describe("demoExtractNote", () => {
  const candidates = {
    projects: [{ id: "p1", name: "Aplikasi Kasir" }],
    notes: [{ id: "n1", title: "Mode offline" }],
    tags: ["riset"],
  };

  it("answers every note example with a valid, fully resolvable fixture", () => {
    for (const ex of DEMO_NOTE_CAPTURE_EXAMPLES) {
      const x = demoExtractNote(ex.text, candidates);
      expect(extractedNoteSchema.safeParse(x).success).toBe(true);
      const r = resolveNoteExtraction(x, candidates, ex.text);
      expect(r.dropped).toEqual([]);
      expect(r.filled).toContain("content");
    }
    const research = resolveNoteExtraction(
      demoExtractNote(DEMO_NOTE_CAPTURE_EXAMPLES[0]!.text, candidates),
      candidates,
      "",
    );
    expect(research.insert.project_id).toBe("p1");
    expect(research.links.map((l) => l.id)).toEqual(["n1"]);
  });

  it("falls back to the local parser for free input", () => {
    const x = demoExtractNote("Ide podcast #konten", candidates);
    expect(x).toMatchObject({ title: "Ide podcast", tags: ["konten"] });
  });

  it("is in the demo inbox seed", () => {
    expect(DEMO_INBOX_ITEMS.map((i) => i.content)).toContain(DEMO_NOTE_CAPTURE_EXAMPLES[0]!.text);
  });
});

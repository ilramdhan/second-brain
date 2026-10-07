import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { extractNoteFields, noteInsertRow, type NoteExtractDeps } from "./noteCapture.server";
import { resolveNoteExtraction, type ExtractedNote } from "./noteExtract.server";

const clock = { now: new Date("2026-10-07T03:00:00Z"), tz: "Asia/Jakarta" };
const candidates = { projects: [], notes: [], tags: [] };
const aiResult: ExtractedNote = {
  title: "Dari AI",
  blocks: [{ type: "bullet", text: "poin [[Ide]]", checked: null }],
  status: "draft",
  project: null,
  tags: ["ai"],
  links: [],
  pinned: null,
  properties: [],
};

const deps = (overrides: Partial<NoteExtractDeps> = {}): NoteExtractDeps => ({
  assertAi: vi.fn(async () => {}),
  consume: vi.fn(async () => true),
  ai: vi.fn(async () => aiResult),
  ...overrides,
});

describe("extractNoteFields", () => {
  const text = "Catatan: Riset QRIS #riset\n- Midtrans";

  it("uses AI when configured and within budget", async () => {
    const d = deps();
    const r = await extractNoteFields(text, candidates, clock, d);
    expect(r).toMatchObject({ via: "ai", extraction: { title: "Dari AI" } });
    expect(d.consume).toHaveBeenCalledOnce();
  });

  it("falls back locally without spending budget when AI is not configured", async () => {
    const d = deps({
      assertAi: vi.fn(async () => {
        throw new Error("AI belum dikonfigurasi");
      }),
    });
    const r = await extractNoteFields(text, candidates, clock, d);
    expect(r).toMatchObject({ via: "regex", reason: "ai_not_configured" });
    expect(r.extraction).toMatchObject({ title: "Riset QRIS", tags: ["riset"] });
    expect(d.consume).not.toHaveBeenCalled();
  });

  it("falls back when rate-limited or the AI call fails", async () => {
    const limited = await extractNoteFields(
      text,
      candidates,
      clock,
      deps({
        consume: vi.fn(async () => {
          throw new Error("Batas AI tercapai");
        }),
      }),
    );
    expect(limited).toMatchObject({ via: "regex", reason: "rate_limited" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await extractNoteFields(
      text,
      candidates,
      clock,
      deps({ ai: vi.fn(async () => Promise.reject(new Error("timeout"))) }),
    );
    expect(failed).toMatchObject({ via: "regex", reason: "ai_failed" });
    spy.mockRestore();
  });
});

describe("noteInsertRow", () => {
  it("mirrors content and the derived index columns (withNoteIndex)", () => {
    const row = noteInsertRow("u1", resolveNoteExtraction(aiResult, candidates, "poin [[Ide]]"));
    expect(row).toMatchObject({
      user_id: "u1",
      title: "Dari AI",
      status: "draft",
      tags: ["ai"],
      content: "- poin [[Ide]]",
      links: ["ide"],
      refs: [],
      excerpt: "- poin [[Ide]]",
    });
  });
});

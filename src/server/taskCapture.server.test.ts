import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { extractTaskFields, type ExtractDeps } from "./taskCapture.server";
import type { ExtractedTask, TaskCandidates } from "./taskExtract.server";

const clock = { now: new Date("2026-10-07T03:00:00Z"), tz: "Asia/Jakarta" };
const candidates: TaskCandidates = { projects: [], members: [], tasks: [] };
const aiResult: ExtractedTask = {
  title: "Dari AI",
  description: null,
  status: null,
  priority: "low",
  project: null,
  start: null,
  due: null,
  estimate_minutes: null,
  assignee: null,
  tags: [],
  depends_on: [],
  comments: [],
  recurrence: null,
};

function deps(overrides: Partial<ExtractDeps> = {}): ExtractDeps {
  return {
    assertAi: vi.fn(async () => {}),
    consume: vi.fn(async () => true),
    ai: vi.fn(async () => aiResult),
    ...overrides,
  };
}

describe("extractTaskFields", () => {
  const text = "Kirim proposal besok jam 9 !tinggi";

  it("uses AI when it is configured and the budget allows it", async () => {
    const d = deps();
    const r = await extractTaskFields(text, candidates, clock, d);
    expect(r.via).toBe("ai");
    expect(r.extraction.title).toBe("Dari AI");
    expect(d.consume).toHaveBeenCalledOnce();
  });

  it("falls back to the regex parser when AI is not configured (no budget spent)", async () => {
    const d = deps({
      assertAi: vi.fn(async () => {
        throw new Error("AI belum dikonfigurasi");
      }),
    });
    const r = await extractTaskFields(text, candidates, clock, d);
    expect(r).toMatchObject({ via: "regex", reason: "ai_not_configured" });
    expect(r.extraction).toMatchObject({ title: "Kirim proposal", priority: "high" });
    expect(d.consume).not.toHaveBeenCalled();
    expect(d.ai).not.toHaveBeenCalled();
  });

  it("falls back when rate-limited (also when the limiter throws)", async () => {
    for (const consume of [
      vi.fn(async () => false),
      vi.fn(async () => {
        throw new Error("Batas penggunaan AI tercapai");
      }),
    ]) {
      const d = deps({ consume });
      const r = await extractTaskFields(text, candidates, clock, d);
      expect(r).toMatchObject({ via: "regex", reason: "rate_limited" });
      expect(d.ai).not.toHaveBeenCalled();
    }
  });

  it("falls back when the AI call fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      ai: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    const r = await extractTaskFields(text, candidates, clock, d);
    expect(r).toMatchObject({ via: "regex", reason: "ai_failed" });
    expect(r.extraction.due).toBe("2026-10-08T09:00");
  });
});

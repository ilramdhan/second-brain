import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { parseCommand, splitNote } from "./bot.server";
import { autoTarget } from "./capture.server";

describe("bot parsing", () => {
  it("parses commands with bot suffix and arguments", () => {
    expect(parseCommand("/task Rapat besok")).toEqual({ cmd: "task", args: "Rapat besok" });
    expect(parseCommand("/Today@SecondBrainBot")).toEqual({ cmd: "today", args: "" });
    expect(parseCommand("halo /task")).toBeNull();
  });
  it("splits notes on | or the first line", () => {
    expect(splitNote("Judul | isi panjang")).toEqual({ title: "Judul", body: "isi panjang" });
    expect(splitNote("Judul\nbaris 2")).toEqual({ title: "Judul", body: "baris 2" });
  });
});

describe("capture auto target", () => {
  const now = new Date("2026-10-05T03:00:00Z");
  it("uses the NLP parser", () => {
    expect(autoTarget("Kirim proposal besok jam 9", now, "Asia/Jakarta")).toBe("task");
    expect(autoTarget("Ide artikel tentang PKM", now, "Asia/Jakarta")).toBe("inbox");
    expect(autoTarget("Catatan: riset QRIS", now, "Asia/Jakarta")).toBe("note");
    expect(autoTarget("lanjutan dari [[Mode offline]]", now, "Asia/Jakarta")).toBe("note");
  });
});

import { describe, expect, it } from "vitest";

import { toMarkdown, withNoteIndex } from "@/lib/blocks";

import {
  describeResolvedNote,
  extractedNoteSchema,
  fallbackNoteExtraction,
  looksLikeNote,
  noteCandidatesPrompt,
  resolveNoteExtraction,
  type ExtractedNote,
  type NoteCandidates,
} from "./noteExtract.server";

const candidates: NoteCandidates = {
  projects: [
    { id: "p-kasir", name: "Aplikasi Kasir" },
    { id: "p-web", name: "Website Toko" },
  ],
  notes: [
    { id: "n-offline", title: "Mode offline" },
    { id: "n-printer", title: "Printer Bluetooth ESC/POS" },
  ],
  tags: ["riset", "Q4"],
};

const base: ExtractedNote = {
  title: "Riset QRIS",
  blocks: [],
  status: null,
  project: null,
  tags: [],
  links: [],
  pinned: null,
  properties: [],
};

describe("resolveNoteExtraction", () => {
  it("builds typed blocks, strips leftover markdown prefixes and drops a repeated title", () => {
    const r = resolveNoteExtraction(
      {
        ...base,
        blocks: [
          { type: "h1", text: "Riset QRIS", checked: null },
          { type: "h2", text: "## Pembanding", checked: null },
          { type: "bullet", text: "- Midtrans", checked: null },
          { type: "numbered", text: "1. daftar akun", checked: null },
          { type: "todo", text: "[ ] tanya finance", checked: null },
          { type: "todo", text: "sudah cek biaya", checked: true },
          { type: "p", text: "   ", checked: null },
        ],
      },
      candidates,
      "riset QRIS",
    );
    expect(r.insert.blocks.map((b) => [b.type, b.text, b.checked])).toEqual([
      ["h2", "Pembanding", undefined],
      ["bullet", "Midtrans", undefined],
      ["numbered", "daftar akun", undefined],
      ["todo", "tanya finance", false],
      ["todo", "sudah cek biaya", true],
    ]);
    expect(r.filled).toContain("content");
    expect(new Set(r.insert.blocks.map((b) => b.id)).size).toBe(5);
  });

  it("matches project, tags and linked notes against the user's data only", () => {
    const r = resolveNoteExtraction(
      {
        ...base,
        project: "aplikasi kasir",
        tags: ["#Riset", "q4", "Pembayaran Digital"],
        links: ["mode offline", "Catatan Rahasia Orang Lain"],
        blocks: [{ type: "p", text: "lihat [[printer bluetooth esc/pos]]", checked: null }],
      },
      candidates,
      "x",
    );
    expect(r.insert.project_id).toBe("p-kasir");
    expect(r.insert.tags).toEqual(["riset", "Q4", "pembayaran-digital"]);
    expect(r.links.map((l) => l.id)).toEqual(["n-offline", "n-printer"]);
    // Linked notes not mentioned inline get a "Terkait" block so backlinks resolve.
    const md = toMarkdown(r.insert.blocks);
    expect(md).toContain("[[Printer Bluetooth ESC/POS]]");
    expect(md).toContain("Terkait: [[Mode offline]]");
    expect(withNoteIndex({ blocks: r.insert.blocks }).links).toEqual([
      "printer bluetooth esc/pos",
      "mode offline",
    ]);
    expect(r.dropped).toEqual(['catatan "Catatan Rahasia Orang Lain" tidak ditemukan']);
  });

  it("drops unknown projects and invented [[links]] / ((refs)) not in the message", () => {
    const r = resolveNoteExtraction(
      {
        ...base,
        project: "Proyek Rahasia",
        blocks: [
          { type: "p", text: "lihat [[Catatan Karangan]] dan ((abcdef12))", checked: null },
          { type: "p", text: "tulis [[Ide Baru]]", checked: null },
        ],
      },
      candidates,
      "tulis [[Ide Baru]]",
    );
    expect(r.insert.project_id).toBeNull();
    expect(r.dropped).toContain('proyek "Proyek Rahasia" tidak ditemukan');
    expect(r.insert.blocks[0]!.text).toBe("lihat Catatan Karangan dan");
    // Typed by the user: kept even though the note does not exist yet.
    expect(r.insert.blocks[1]!.text).toBe("tulis [[Ide Baru]]");
  });

  it("keeps the message body when the model returns no blocks", () => {
    const r = resolveNoteExtraction(
      { ...base, title: "" },
      candidates,
      "Belanja\n- beras\n- [ ] telur",
    );
    expect(r.insert.title).toBe("Belanja");
    expect(r.insert.blocks.map((b) => b.type)).toEqual(["bullet", "todo"]);
  });

  it("fills status, pin and properties (numbers parsed, keys normalised)", () => {
    const r = resolveNoteExtraction(
      {
        ...base,
        status: "final",
        pinned: true,
        properties: [
          { key: "Penulis Buku", value: "James Clear" },
          { key: "rating", value: "5" },
          { key: "", value: "x" },
        ],
      },
      candidates,
      "x",
    );
    expect(r.insert).toMatchObject({
      status: "final",
      pinned: true,
      properties: { penulis_buku: "James Clear", rating: 5 },
    });
    expect(r.filled).toEqual(expect.arrayContaining(["status", "pinned", "properties"]));
    expect(r.insert.blocks).toHaveLength(1); // empty placeholder block
    expect(r.filled).not.toContain("content");
  });
});

describe("fallbackNoteExtraction", () => {
  it("reads title, #tags, +project, status, !pin, properties and markdown body", () => {
    const x = fallbackNoteExtraction(
      [
        "Catatan: Riset QRIS +aplikasi-kasir status:draf !pin #riset",
        "sumber:: rapat vendor",
        "## Pembanding",
        "- Midtrans",
        "[] tanya finance #pembayaran",
      ].join("\n"),
    );
    expect(extractedNoteSchema.safeParse(x).success).toBe(true);
    expect(x).toMatchObject({
      title: "Riset QRIS",
      project: "aplikasi kasir",
      status: "draft",
      pinned: true,
      tags: ["riset", "pembayaran"],
      properties: [{ key: "sumber", value: "rapat vendor" }],
    });
    expect(x.blocks.map((b) => b.type)).toEqual(["h2", "bullet", "todo"]);
    const r = resolveNoteExtraction(x, candidates, "");
    expect(r.insert.project_id).toBe("p-kasir");
  });

  it("splits `Judul | isi`", () => {
    const x = fallbackNoteExtraction("Ide artikel | tulis tentang PKM");
    expect(x.title).toBe("Ide artikel");
    expect(x.blocks).toEqual([{ type: "p", text: "tulis tentang PKM", checked: null }]);
  });
});

describe("looksLikeNote / prompt / reply", () => {
  it("detects note-like messages", () => {
    expect(looksLikeNote("catatan: ide fitur")).toBe(true);
    expect(looksLikeNote("Notulen: weekly")).toBe(true);
    expect(looksLikeNote("lanjutan [[Mode offline]]")).toBe(true);
    expect(looksLikeNote("beli kopi besok")).toBe(false);
  });

  it("sends names only to the model", () => {
    const p = noteCandidatesPrompt(candidates);
    expect(p).toContain("Mode offline");
    expect(p).not.toContain("n-offline");
    expect(p).not.toContain("p-kasir");
  });

  it("summarises filled fields and escapes HTML", () => {
    const r = resolveNoteExtraction(
      {
        ...base,
        title: "<b>x</b>",
        project: "Aplikasi Kasir",
        tags: ["riset"],
        blocks: [
          { type: "h2", text: "A", checked: null },
          { type: "todo", text: "B", checked: false },
        ],
      },
      candidates,
      "x",
    );
    const text = describeResolvedNote(r, "ai");
    expect(text).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(text).toContain("📁 Aplikasi Kasir");
    expect(text).toContain("2 blok (1 subjudul, 1 checklist)");
    expect(text).toContain("Diisi AI");
  });
});

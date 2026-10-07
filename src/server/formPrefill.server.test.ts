import { describe, expect, it } from "vitest";

import { DEMO_PROJECT_PREFILL_EXAMPLES, DEMO_TEMPLATE_PREFILL_EXAMPLES } from "@/lib/demo-examples";

import { demoExtractProject, demoExtractTemplate } from "./demo/ai-fixtures.server";
import {
  extractedProjectSchema,
  extractedTemplateSchema,
  fallbackProjectExtraction,
  fallbackTemplateExtraction,
  projectUserPrompt,
  resolveProjectExtraction,
  resolveTemplateExtraction,
  type ExtractedProject,
  type ProjectCandidates,
} from "./formPrefill.server";

// Wednesday 7 October 2026, 10:00 in Jakarta.
const clock = { now: new Date("2026-10-07T03:00:00Z"), tz: "Asia/Jakarta" };
const candidates: ProjectCandidates = {
  projects: [
    { id: "p-kasir", name: "Aplikasi Kasir" },
    { id: "p-web", name: "Website Toko" },
  ],
  people: [
    { user_id: "u-rina", name: "Rina" },
    { user_id: "u-budi", name: "Budi" },
  ],
};
const base: ExtractedProject = {
  name: "Program loyalti",
  description: null,
  para_type: null,
  status: null,
  color: null,
  parent: null,
  start: null,
  due: null,
  launch: null,
  members: [],
};

describe("resolveProjectExtraction", () => {
  it("fills every field the text implies, matching parent and people by name", () => {
    const r = resolveProjectExtraction(
      {
        ...base,
        description: "Poin tiap transaksi",
        para_type: "project",
        status: "planning",
        color: "violet",
        parent: "aplikasi kasir",
        start: "2026-11-01",
        due: "2026-12-20",
        launch: "2026-12-31",
        members: ["rina"],
      },
      candidates,
      clock,
      "x",
    );
    expect(r.draft).toEqual({
      name: "Program loyalti",
      description: "Poin tiap transaksi",
      para_type: "project",
      status: "planning",
      color: "violet",
      parent_id: "p-kasir",
      start_date: "2026-11-01",
      due_date: "2026-12-20",
      launch_date: "2026-12-31",
    });
    expect(r.members).toEqual(["Rina"]);
    expect(r.filled).toEqual(
      expect.arrayContaining(["description", "status", "color", "parent", "members", "launch"]),
    );
    expect(r.dropped).toEqual([]);
  });

  it("never suggests strangers, unknown parents, invalid or unordered dates", () => {
    const r = resolveProjectExtraction(
      {
        ...base,
        parent: "Proyek Rahasia",
        start: "2026-12-31",
        due: "2026-12-01",
        launch: "2026-02-31",
        members: ["ceo@example.com", "Siapa Saja"],
      },
      candidates,
      clock,
      "x",
    );
    expect(r.draft).toMatchObject({
      parent_id: null,
      start_date: null,
      due_date: "2026-12-01",
      launch_date: null,
      para_type: "project",
      status: "active",
      color: "teal",
    });
    expect(r.members).toEqual([]);
    expect(r.dropped).toHaveLength(5);
  });

  it("sends names only to the model (no ids, no emails)", () => {
    const p = projectUserPrompt("x", candidates);
    expect(p).toContain("Rina");
    expect(p).not.toContain("u-rina");
    expect(p).not.toContain("p-kasir");
  });
});

describe("fallbackProjectExtraction", () => {
  it("reads name, description, colour, status, +parent and due date locally", () => {
    const x = fallbackProjectExtraction(
      "Redesain katalog +website-toko besok warna biru\nmasih perencanaan, fokus foto produk",
      clock,
    );
    expect(extractedProjectSchema.safeParse(x).success).toBe(true);
    expect(x).toMatchObject({
      name: "Redesain katalog warna biru",
      description: "masih perencanaan, fokus foto produk",
      color: "blue",
      status: "planning",
      parent: "website toko",
      due: "2026-10-08",
    });
    expect(resolveProjectExtraction(x, candidates, clock, "").draft.parent_id).toBe("p-web");
  });
});

describe("templates", () => {
  it("resets task-only fields for note templates and bounds the estimate", () => {
    const note = resolveTemplateExtraction(
      {
        kind: "note",
        name: "Retro",
        title: "Retro: ",
        body: "## Baik\n- ",
        tags: ["#Retro"],
        priority: "high",
        estimate_minutes: 60,
      },
      "",
    );
    expect(note.draft).toEqual({
      kind: "note",
      name: "Retro",
      title: "Retro: ",
      body: "## Baik\n-",
      tags: ["retro"],
      priority: "medium",
      estimate: 25,
    });
    const task = resolveTemplateExtraction(
      {
        kind: "task",
        name: "",
        title: null,
        body: null,
        tags: [],
        priority: "low",
        estimate_minutes: -5,
      },
      "Rilis app\nlangkah",
    );
    expect(task.draft).toMatchObject({ name: "Rilis app", priority: "low", estimate: 25 });
    expect(task.filled).toEqual(["priority"]);
  });

  it("falls back locally: kind from keywords, tags, priority and estimate", () => {
    const t = fallbackTemplateExtraction("Rilis aplikasi !tinggi ~2j #rilis\n- [ ] build", clock);
    expect(extractedTemplateSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({
      kind: "task",
      name: "Rilis aplikasi",
      priority: "high",
      estimate_minutes: 120,
      tags: ["rilis"],
      body: "- [ ] build",
    });
    expect(fallbackTemplateExtraction("Notulen meeting mingguan", clock).kind).toBe("note");
  });
});

describe("demo fixtures", () => {
  it("answers every prefill example with a valid, fully resolvable draft", () => {
    for (const ex of DEMO_PROJECT_PREFILL_EXAMPLES) {
      const x = demoExtractProject(ex.text, candidates, clock);
      expect(extractedProjectSchema.safeParse(x).success).toBe(true);
      const r = resolveProjectExtraction(x, candidates, clock, ex.text);
      expect(r.dropped).toEqual([]);
      expect(r.draft.parent_id).toBe("p-kasir");
      expect(r.members).toEqual(["Rina"]);
    }
    for (const ex of DEMO_TEMPLATE_PREFILL_EXAMPLES) {
      const x = demoExtractTemplate(ex.text, clock);
      expect(extractedTemplateSchema.safeParse(x).success).toBe(true);
      expect(resolveTemplateExtraction(x, ex.text).filled).toContain("body");
    }
  });
});

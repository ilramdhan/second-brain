import { describe, expect, it } from "vitest";

import {
  candidatesPrompt,
  describeResolvedTask,
  extractedTaskSchema,
  fallbackExtraction,
  looksLikeTask,
  matchByName,
  parseLocalDate,
  resolveExtraction,
  type ExtractedTask,
  type TaskCandidates,
} from "./taskExtract.server";

const TZ = "Asia/Jakarta";
// Wednesday 7 October 2026, 10:00 in Jakarta.
const clock = { now: new Date("2026-10-07T03:00:00Z"), tz: TZ };

const candidates: TaskCandidates = {
  projects: [
    { id: "p-kasir", name: "Aplikasi Kasir" },
    { id: "p-web", name: "Website Toko" },
  ],
  members: [
    { project_id: "p-kasir", user_id: "u-rina", name: "Rina" },
    { project_id: "p-kasir", user_id: "u-budi", name: "Budi" },
    { project_id: "p-web", user_id: "u-sari", name: "Sari" },
  ],
  tasks: [
    { id: "t-api", title: "API laporan penjualan harian" },
    { id: "t-db", title: "Desain skema database laporan" },
  ],
};

const empty: ExtractedTask = {
  title: "Uji laporan",
  description: null,
  status: null,
  priority: null,
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

describe("extractedTaskSchema", () => {
  it("accepts a full extraction and rejects bad enums or missing keys", () => {
    expect(extractedTaskSchema.safeParse({ ...empty, status: "review" }).success).toBe(true);
    expect(extractedTaskSchema.safeParse({ ...empty, status: "blocked" }).success).toBe(false);
    expect(extractedTaskSchema.safeParse({ ...empty, priority: "urgent" }).success).toBe(false);
    const { tags: _tags, ...missing } = empty;
    expect(extractedTaskSchema.safeParse(missing).success).toBe(false);
  });
});

describe("matchByName", () => {
  const items = ["Aplikasi Kasir", "Website Toko", "Website Admin"];
  it("matches exact, squashed and unique prefixes, ignoring case and punctuation", () => {
    expect(matchByName("aplikasi kasir", items, (x) => x)).toBe("Aplikasi Kasir");
    expect(matchByName("AplikasiKasir", items, (x) => x)).toBe("Aplikasi Kasir");
    expect(matchByName("aplikasi", items, (x) => x)).toBe("Aplikasi Kasir");
  });
  it("refuses ambiguous or unknown names", () => {
    expect(matchByName("website", items, (x) => x)).toBeNull();
    expect(matchByName("Proyek Rahasia", items, (x) => x)).toBeNull();
    expect(matchByName("", items, (x) => x)).toBeNull();
  });
});

describe("parseLocalDate", () => {
  it("reads wall-clock times in the app time zone", () => {
    expect(parseLocalDate("2026-10-08T09:00", clock, 17)?.toISOString()).toBe(
      "2026-10-08T02:00:00.000Z",
    );
    expect(parseLocalDate("2026-10-09", clock, 17)?.toISOString()).toBe("2026-10-09T10:00:00.000Z");
    expect(parseLocalDate("2026-10-09T10:00:00+07:00", clock, 17)?.toISOString()).toBe(
      "2026-10-09T03:00:00.000Z",
    );
  });
  it("rejects invalid, rolled-over and far-away dates", () => {
    expect(parseLocalDate("besok", clock, 17)).toBeNull();
    expect(parseLocalDate("2026-02-31", clock, 17)).toBeNull();
    expect(parseLocalDate("2040-01-01", clock, 17)).toBeNull();
    expect(parseLocalDate("2026-10-09T10:00", clock, 17)).not.toBeNull();
  });
});

describe("resolveExtraction", () => {
  it("fills every field from a valid extraction", () => {
    const r = resolveExtraction(
      {
        ...empty,
        description: "Pakai data pilot",
        priority: "high",
        project: "aplikasi kasir",
        assignee: "rina",
        start: "2026-10-08T09:00",
        due: "2026-10-09",
        estimate_minutes: 180,
        tags: ["#QA", "Laporan Harian", "qa"],
        depends_on: ["api laporan penjualan harian"],
        comments: ["  cek angka  "],
        recurrence: null,
      },
      candidates,
      clock,
      "",
    );
    expect(r.insert).toMatchObject({
      title: "Uji laporan",
      status: "todo",
      priority: "high",
      project_id: "p-kasir",
      assignee_id: "u-rina",
      assignee_name: "Rina",
      start_date: "2026-10-08T02:00:00.000Z",
      due_date: "2026-10-09T10:00:00.000Z",
      estimate_minutes: 180,
      tags: ["qa", "laporan-harian"],
    });
    expect(r.dependsOn).toEqual([{ id: "t-api", title: "API laporan penjualan harian" }]);
    expect(r.comments).toEqual(["cek angka"]);
    expect(r.filled).toEqual(
      expect.arrayContaining([
        "description",
        "priority",
        "project",
        "assignee",
        "start",
        "due",
        "estimate",
        "tags",
        "dependencies",
        "comments",
      ]),
    );
    expect(r.dropped).toEqual([]);
  });

  it("drops unknown projects, assignees outside the project and unknown tasks", () => {
    const r = resolveExtraction(
      {
        ...empty,
        project: "Proyek Rahasia",
        assignee: "Rina",
        depends_on: ["Tugas orang lain"],
      },
      candidates,
      clock,
      "",
    );
    expect(r.insert.project_id).toBeNull();
    expect(r.insert.assignee_id).toBeNull();
    expect(r.dependsOn).toEqual([]);
    expect(r.dropped).toHaveLength(3);

    const wrongProject = resolveExtraction(
      { ...empty, project: "Website Toko", assignee: "Budi" },
      candidates,
      clock,
      "",
    );
    expect(wrongProject.insert.project_id).toBe("p-web");
    expect(wrongProject.insert.assignee_id).toBeNull();
    expect(wrongProject.dropped[0]).toMatch(/bukan anggota/);
  });

  it("keeps a task with open blockers in todo and clamps bad values", () => {
    const r = resolveExtraction(
      {
        ...empty,
        title: "  ",
        status: "in_progress",
        depends_on: ["Desain skema database laporan"],
        estimate_minutes: -5,
        start: "2026-10-12",
        due: "2026-10-09",
      },
      candidates,
      clock,
      "Judul dari baris pertama\nbaris dua",
    );
    expect(r.insert.title).toBe("Judul dari baris pertama");
    expect(r.insert.status).toBe("todo");
    expect(r.insert.start_date).toBeNull();
    expect(r.insert).not.toHaveProperty("estimate_minutes");
    expect(r.filled).not.toContain("status");
  });

  it("stamps completed_at for done tasks", () => {
    const r = resolveExtraction({ ...empty, status: "done" }, candidates, clock, "");
    expect(r.insert.completed_at).toBe(clock.now.toISOString());
  });
});

describe("fallbackExtraction (regex)", () => {
  it("uses the local parser for the first line, comments and description", () => {
    const x = fallbackExtraction(
      "Uji laporan besok jam 9 #qa !tinggi +Aplikasi-Kasir @Rina ~2j status:review\nPakai data pilot\nkomentar: cek angka",
      clock,
    );
    expect(x).toMatchObject({
      title: "Uji laporan",
      priority: "high",
      project: "Aplikasi Kasir",
      assignee: "Rina",
      tags: ["qa"],
      estimate_minutes: 120,
      status: "review",
      due: "2026-10-08T09:00",
      description: "Pakai data pilot",
      comments: ["cek angka"],
    });
    const r = resolveExtraction(x, candidates, clock, "");
    expect(r.insert.project_id).toBe("p-kasir");
    expect(r.insert.assignee_id).toBe("u-rina");
    expect(r.insert.due_date).toBe("2026-10-08T02:00:00.000Z");
  });
});

describe("looksLikeTask", () => {
  it("needs a task signal in the first line", () => {
    expect(looksLikeTask("Kirim proposal besok", clock.now, TZ)).toBe(true);
    expect(looksLikeTask("Rapikan meja ~30m", clock.now, TZ)).toBe(true);
    expect(looksLikeTask("Ide artikel tentang PKM", clock.now, TZ)).toBe(false);
    expect(looksLikeTask(`besok ${"x".repeat(2000)}`, clock.now, TZ)).toBe(false);
  });
});

describe("prompt and reply", () => {
  it("sends names only, never ids", () => {
    const p = candidatesPrompt(candidates);
    expect(p).toContain("Aplikasi Kasir");
    expect(p).toContain("Rina");
    expect(p).not.toMatch(/p-kasir|u-rina|t-api/);
  });
  it("summarises the filled fields and escapes HTML", () => {
    const r = resolveExtraction(
      { ...empty, title: "Cek <b>", project: "Aplikasi Kasir", estimate_minutes: 90, tags: ["qa"] },
      candidates,
      clock,
      "",
    );
    const text = describeResolvedTask(r, "ai", TZ);
    expect(text).toContain("Cek &lt;b&gt;");
    expect(text).toContain("📁 Aplikasi Kasir");
    expect(text).toContain("⏱ 1 jam 30 mnt");
    expect(text).toContain("Diisi AI");
  });
});

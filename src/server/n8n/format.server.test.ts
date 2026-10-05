import { describe, expect, it } from "vitest";

import {
  buildDigest,
  buildReminder,
  escapeHtml,
  type DigestData,
  type DigestTask,
} from "./format.server";

const tz = "Asia/Jakarta";
const task = (
  id: string,
  title: string,
  due: string | null = "2026-10-06T02:00:00Z",
): DigestTask => ({
  id,
  title,
  due_date: due,
  priority: "high",
  status: "todo",
});
const empty: DigestData = {
  today: [],
  overdue: [],
  tomorrow: [],
  completedToday: [],
  inboxPending: 0,
};

describe("escapeHtml", () => {
  it("escapes Telegram HTML specials", () => {
    expect(escapeHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });
});

describe("buildDigest", () => {
  it("skips users with nothing to report", () => {
    for (const kind of ["morning", "evening", "overdue", "weekly"] as const)
      expect(buildDigest(kind, empty, tz)).toBeNull();
  });

  it("morning lists today, overdue and inbox with done buttons", () => {
    const d = buildDigest(
      "morning",
      {
        ...empty,
        today: [task("a", "Rapat <klien>")],
        overdue: [task("b", "Laporan")],
        inboxPending: 3,
      },
      tz,
    )!;
    expect(d.text).toContain("Selamat pagi");
    expect(d.text).toContain("Rapat &lt;klien&gt;");
    expect(d.text).toContain("Inbox menunggu diproses: <b>3</b>");
    expect(d.reply_markup?.inline_keyboard.map((r) => r[0]!.callback_data)).toEqual([
      "done:b",
      "done:a",
    ]);
  });

  it("evening shows completed and tomorrow", () => {
    const d = buildDigest(
      "evening",
      { ...empty, completedToday: [task("c", "Selesai")], tomorrow: [task("d", "Besok")] },
      tz,
    )!;
    expect(d.text).toContain("<s>Selesai</s>");
    expect(d.text).toContain("Besok (1)");
  });

  it("weekly summarizes stats", () => {
    const d = buildDigest(
      "weekly",
      {
        ...empty,
        week: {
          completed: 5,
          created: 7,
          overdue: 1,
          activeProjects: 2,
          newNotes: 3,
          focus: [task("e", "Fokus")],
        },
      },
      tz,
    )!;
    expect(d.text).toContain("Selesai: <b>5</b>");
    expect(d.text).toContain("Fokus");
  });

  it("truncates long sections", () => {
    const many = Array.from({ length: 14 }, (_, i) => task(`t${i}`, `Tugas ${i}`));
    const d = buildDigest("overdue", { ...empty, overdue: many }, tz)!;
    expect(d.text).toContain("dan 4 lainnya");
    expect(d.reply_markup?.inline_keyboard).toHaveLength(8);
  });
});

describe("buildReminder", () => {
  it("marks overdue tasks and offers done/snooze", () => {
    const r = buildReminder(task("x", "Bayar"), new Date("2026-10-07T00:00:00Z"), tz);
    expect(r.text).toContain("Terlambat");
    expect(r.reply_markup?.inline_keyboard[0]!.map((b) => b.callback_data)).toEqual([
      "done:x",
      "snooze:x:1h",
      "snooze:x:1d",
    ]);
  });
  it("formats the due time in the app time zone", () => {
    const r = buildReminder(task("x", "Bayar"), new Date("2026-10-05T00:00:00Z"), tz);
    expect(r.text).toContain("Segera jatuh tempo");
    expect(r.text).toMatch(/09[.:]00/);
  });
});

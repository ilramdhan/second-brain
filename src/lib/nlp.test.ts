import { describe, expect, it } from "vitest";

import { parseTaskText } from "@/lib/nlp";

// Wednesday 14 January 2026, 09:00 local time.
const NOW = new Date(2026, 0, 14, 9, 0);
const at = (d: number, h = 17, min = 0, m = 0, y = 2026) => new Date(y, m, d, h, min);
const parse = (s: string, now = NOW) => parseTaskText(s, now);

describe("parseTaskText: tokens", () => {
  it("parses the documented example", () => {
    const r = parse(
      "Meeting evaluasi tim marketing besok jam 10 pagi #urgent @budi !tinggi +Website",
    );
    expect(r).toMatchObject({
      title: "Meeting evaluasi tim marketing",
      tags: ["urgent"],
      assignee: "budi",
      priority: "high",
      project: "Website",
      recurrence: null,
      hasTime: true,
    });
    expect(r.due).toEqual(at(15, 10));
    expect(r.matches).toEqual(
      expect.arrayContaining(["#urgent", "@budi", "!tinggi", "+Website", "besok", "jam 10 pagi"]),
    );
  });

  it("collects lower-cased, de-duplicated tags and replaces dashes in project names", () => {
    const r = parse("Tulis laporan #Kerja #kerja #Q1 +Proyek-Besar_Baru");
    expect(r.tags).toEqual(["kerja", "q1"]);
    expect(r.project).toBe("Proyek Besar Baru");
    expect(r.title).toBe("Tulis laporan");
    expect(r.due).toBeNull();
  });

  it.each([
    ["!1", "high"],
    ["!high", "high"],
    ["p2", "medium"],
    ["!sedang", "medium"],
    ["!3", "low"],
    ["!rendah", "low"],
    ["p1", "high"],
  ])("maps priority %s → %s", (token, priority) => {
    expect(parse(`Task ${token}`).priority).toBe(priority);
  });

  it("treats urgent-like tags as high priority unless a priority is given", () => {
    expect(parse("Fix #asap").priority).toBe("high");
    expect(parse("Fix #penting !low").priority).toBe("low");
    expect(parse("Fix #misc").priority).toBeNull();
  });

  it("falls back to the raw input when everything was a token", () => {
    expect(parse("#tag @me").title).toBe("#tag @me");
  });

  it("trims leading/trailing punctuation from the title", () => {
    expect(parse("- Beli susu, besok").title).toBe("Beli susu");
  });
});

describe("parseTaskText: relative dates", () => {
  it.each([
    ["hari ini", at(14)],
    ["today", at(14)],
    ["besok", at(15)],
    ["tomorrow", at(15)],
    ["bsk", at(15)],
    ["lusa", at(16)],
    ["besok lusa", at(16)],
    ["minggu depan", at(21)],
    ["next week", at(21)],
    ["bulan depan", at(14, 17, 0, 1)],
    ["next month", at(14, 17, 0, 1)],
    ["3 hari lagi", at(17)],
    ["2 minggu lagi", at(28)],
    ["2 bulan lagi", at(14, 17, 0, 2)],
    ["in 5 days", at(19)],
    ["in 1 week", at(21)],
  ])("%s defaults to 17:00", (phrase, due) => {
    const r = parse(`Kerjakan ${phrase}`);
    expect(r.due).toEqual(due);
    expect(r.hasTime).toBe(false);
    expect(r.title).toBe("Kerjakan");
  });

  it("'nanti malam' means today at 19:00", () => {
    const r = parse("Telepon ibu nanti malam");
    expect(r.due).toEqual(at(14, 19));
    expect(r.hasTime).toBe(true);
  });
});

describe("parseTaskText: weekdays", () => {
  it("picks the next occurrence of a weekday", () => {
    expect(parse("Rapat jumat").due).toEqual(at(16));
    expect(parse("Rapat senin").due).toEqual(at(19));
    expect(parse("Rapat hari minggu").due).toEqual(at(18));
    expect(parse("Call next friday").due).toEqual(at(16));
  });

  it("uses today when the weekday is today, next week with 'depan'", () => {
    expect(parse("Rapat rabu").due).toEqual(at(14));
    expect(parse("Rapat rabu depan").due).toEqual(at(21));
    // Friday is later this week → "jumat depan" is the Friday after.
    expect(parse("Rapat jumat depan").due).toEqual(at(23));
  });
});

describe("parseTaskText: absolute dates", () => {
  it("parses '<day> <month> [year]' in Indonesian and English", () => {
    expect(parse("Bayar pajak 20 maret").due).toEqual(at(20, 17, 0, 2));
    expect(parse("Bayar pajak tgl 5 agustus 2027").due).toEqual(at(5, 17, 0, 7, 2027));
    expect(parse("Pay 3 dec").due).toEqual(at(3, 17, 0, 11));
  });

  it("rolls a past day/month without year into next year", () => {
    expect(parse("Ulang tahun 2 jan").due).toEqual(at(2, 17, 0, 0, 2027));
  });

  it("ignores '<n> <word>' when the word is not a month", () => {
    const r = parse("Beli 2 kopi");
    expect(r.due).toBeNull();
    expect(r.title).toBe("Beli 2 kopi");
  });

  it("parses d/m[/y] and d-m-y", () => {
    expect(parse("Deadline 25/12").due).toEqual(at(25, 17, 0, 11));
    expect(parse("Deadline 1/2/27").due).toEqual(at(1, 17, 0, 1, 2027));
    expect(parse("Deadline 1-2-2028").due).toEqual(at(1, 17, 0, 1, 2028));
  });

  it("'tgl <n>' picks this month, or next month when already past", () => {
    expect(parse("Gajian tgl 25").due).toEqual(at(25));
    expect(parse("Gajian tanggal 3").due).toEqual(at(3, 17, 0, 1));
  });
});

describe("parseTaskText: times", () => {
  it.each([
    ["besok jam 10", at(15, 10)],
    ["besok pukul 14:30", at(15, 14, 30)],
    ["besok jam 3 sore", at(15, 15)],
    ["besok jam 8 malam", at(15, 20)],
    ["besok jam 1 siang", at(15, 13)],
    ["besok jam 12 pagi", at(15, 0)],
    ["besok at 9pm", at(15, 21)],
    ["besok 07.15", at(15, 7, 15)],
    ["besok 4pm", at(15, 16)],
    ["besok 9 am", at(15, 9)],
  ])("%s", (phrase, due) => {
    const r = parse(`Olahraga ${phrase}`);
    expect(r.due).toEqual(due);
    expect(r.hasTime).toBe(true);
    expect(r.title).toBe("Olahraga");
  });

  it("a time without a date is today, or tomorrow when already past", () => {
    expect(parse("Standup jam 10").due).toEqual(at(14, 10));
    expect(parse("Sarapan jam 7").due).toEqual(at(15, 7));
  });

  it("ignores impossible times", () => {
    const r = parse("Cek jam 25");
    expect(r.hasTime).toBe(false);
    expect(r.due).toBeNull();
  });
});

describe("parseTaskText: recurrence", () => {
  it.each([
    ["setiap hari", "daily"],
    ["tiap minggu", "weekly"],
    ["every month", "monthly"],
    ["every day", "daily"],
    ["setiap bulan", "monthly"],
  ])("%s → %s, due today 17:00 without a date", (phrase, recurrence) => {
    const r = parse(`Siram tanaman ${phrase}`);
    expect(r.recurrence).toBe(recurrence);
    expect(r.due).toEqual(at(14));
    expect(r.title).toBe("Siram tanaman");
  });

  it("keeps an explicit date and time together with recurrence", () => {
    const r = parse("Review tiap minggu senin jam 9");
    expect(r.recurrence).toBe("weekly");
    expect(r.due).toEqual(at(19, 9));
  });
});

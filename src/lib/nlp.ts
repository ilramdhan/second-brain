import {
  addDays,
  addMonths,
  addWeeks,
  nextDay,
  setHours,
  setMinutes,
  startOfDay,
  type Day,
} from "date-fns";

export type ParsedTask = {
  title: string;
  due: Date | null;
  hasTime: boolean;
  tags: string[];
  assignee: string | null;
  priority: "high" | "medium" | "low" | null;
  project: string | null;
  recurrence: "daily" | "weekly" | "monthly" | null;
  /** `~30m`, `~2j`, `~1.5h`, `~1j30m` → minutes. */
  estimateMinutes: number | null;
  /** `status:review`, `status:dikerjakan`, `status:selesai` … */
  status: TaskStatusToken | null;
  matches: string[];
};

export type TaskStatusToken = "todo" | "in_progress" | "review" | "done";

const STATUS_WORDS: Record<string, TaskStatusToken> = {
  todo: "todo",
  "to-do": "todo",
  baru: "todo",
  in_progress: "in_progress",
  progress: "in_progress",
  proses: "in_progress",
  dikerjakan: "in_progress",
  review: "review",
  done: "done",
  selesai: "done",
};

/** Upper bound for a parsed estimate (one week of minutes). */
export const MAX_ESTIMATE_MINUTES = 7 * 24 * 60;

const DAYS: Record<string, Day> = {
  minggu: 0,
  ahad: 0,
  sunday: 0,
  senin: 1,
  monday: 1,
  selasa: 2,
  tuesday: 2,
  rabu: 3,
  wednesday: 3,
  kamis: 4,
  thursday: 4,
  jumat: 5,
  "jum'at": 5,
  friday: 5,
  sabtu: 6,
  saturday: 6,
};
const MONTHS: Record<string, number> = {
  jan: 0,
  januari: 0,
  feb: 1,
  februari: 1,
  mar: 2,
  maret: 2,
  apr: 3,
  april: 3,
  mei: 4,
  may: 4,
  jun: 5,
  juni: 5,
  jul: 6,
  juli: 6,
  agu: 7,
  agt: 7,
  agustus: 7,
  aug: 7,
  sep: 8,
  september: 8,
  okt: 9,
  oktober: 9,
  oct: 9,
  nov: 10,
  november: 10,
  des: 11,
  desember: 11,
  dec: 11,
};

/**
 * Parses a natural-language task line (Indonesian + English), e.g.
 * "Meeting evaluasi tim marketing besok jam 10 pagi #urgent @budi !tinggi +Website".
 */
export function parseTaskText(input: string, now = new Date()): ParsedTask {
  let text = ` ${input} `;
  const matches: string[] = [];
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(text);
    if (m) {
      fn(m);
      matches.push(m[0].trim());
      text = text.replace(m[0], " ");
    }
    return !!m;
  };

  const tags: string[] = [];
  let mt: RegExpExecArray | null;
  const tagRe = /\s#([\p{L}\p{N}_-]+)/u;
  while ((mt = tagRe.exec(text))) {
    tags.push(mt[1]!.toLowerCase());
    matches.push(mt[0].trim());
    text = text.replace(mt[0], " ");
  }

  let assignee: string | null = null;
  take(/\s@([\p{L}\p{N}_.-]+)/u, (m) => (assignee = m[1]!));
  let project: string | null = null;
  take(/\s\+([\p{L}\p{N}_-]+)/u, (m) => (project = m[1]!.replace(/[-_]/g, " ")));

  let priority: ParsedTask["priority"] = null;
  take(/\s(?:!|p)(1|2|3|tinggi|high|sedang|medium|rendah|low)\b/i, (m) => {
    const v = m[1]!.toLowerCase();
    priority =
      v === "1" || v === "tinggi" || v === "high"
        ? "high"
        : v === "3" || v === "rendah" || v === "low"
          ? "low"
          : "medium";
  });
  if (!priority && tags.some((t) => ["urgent", "penting", "asap"].includes(t))) priority = "high";

  let estimateMinutes: number | null = null;
  take(
    /\s~(\d+(?:[.,]\d+)?)(j|jam|h|m|mnt|menit|min)?(?:(\d+)(?:m|mnt|menit|min)?)?(?=\s)/i,
    (m) => {
      const n = Number(m[1]!.replace(",", "."));
      const hours = m[2] ? /^(j|jam|h)$/i.test(m[2]) : false;
      const total = Math.round(hours ? n * 60 + Number(m[3] ?? 0) : n);
      if (total > 0 && total <= MAX_ESTIMATE_MINUTES) estimateMinutes = total;
    },
  );

  let status: TaskStatusToken | null = null;
  take(/\sstatus[:=]([a-z_-]+)(?=\s)/i, (m) => {
    status = STATUS_WORDS[m[1]!.toLowerCase()] ?? null;
  });

  let recurrence: ParsedTask["recurrence"] = null;
  take(/\s(setiap|tiap|every)\s+(hari|day|minggu|week|bulan|month)\b/i, (m) => {
    const v = m[2]!.toLowerCase();
    recurrence =
      v === "hari" || v === "day" ? "daily" : v === "minggu" || v === "week" ? "weekly" : "monthly";
  });

  let due: Date | null = null;
  const today = startOfDay(now);
  // Try date patterns in priority order; `||` stops at the first match.
  void (
    take(/\s(hari ini|today|nanti malam|tonight)\b/i, (m) => {
      due = today;
      if (/malam|tonight/i.test(m[1]!)) text += " jam 19 ";
    }) ||
    take(/\s(besok lusa|lusa)\b/i, () => (due = addDays(today, 2))) ||
    take(/\s(besok|tomorrow|bsk)\b/i, () => (due = addDays(today, 1))) ||
    take(/\s(minggu depan|next week)\b/i, () => (due = addWeeks(today, 1))) ||
    take(/\s(bulan depan|next month)\b/i, () => (due = addMonths(today, 1))) ||
    take(/\s(\d+)\s+(hari|minggu|bulan)\s+lagi\b/i, (m) => {
      const n = Number(m[1]);
      due =
        m[2] === "hari"
          ? addDays(today, n)
          : m[2] === "minggu"
            ? addWeeks(today, n)
            : addMonths(today, n);
    }) ||
    take(
      /\s(?:in)\s+(\d+)\s+(days?|weeks?)\b/i,
      (m) =>
        (due = /week/i.test(m[2]!) ? addWeeks(today, Number(m[1])) : addDays(today, Number(m[1]))),
    ) ||
    take(
      /\s(?:hari\s+|next\s+)?(senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|ahad|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s+depan)?\b/i,
      (m) => {
        const d = DAYS[m[1]!.toLowerCase()]!;
        due = today.getDay() === d && !m[2] ? today : nextDay(today, d);
        if (m[2]) due = addWeeks(nextDay(today, d), today.getDay() < d ? 1 : 0);
      },
    ) ||
    take(/\s(?:tgl|tanggal|tg)?\s*(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?\b/i, (m) => {
      const mon = MONTHS[m[2]!.toLowerCase()];
      if (mon === undefined) {
        text = text + m[0];
        matches.pop();
        return;
      }
      const y = m[3] ? Number(m[3]) : now.getFullYear();
      let d = new Date(y, mon, Number(m[1]));
      if (!m[3] && d < today) d = new Date(y + 1, mon, Number(m[1]));
      due = d;
    }) ||
    take(/\s(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/, (m) => {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
      due = new Date(y, Number(m[2]) - 1, Number(m[1]));
    }) ||
    take(/\s(?:tgl|tanggal)\s+(\d{1,2})\b/i, (m) => {
      let d = new Date(now.getFullYear(), now.getMonth(), Number(m[1]));
      if (d < today) d = addMonths(d, 1);
      due = d;
    })
  );

  let hasTime = false;
  // Try time patterns in priority order; `||` stops at the first match.
  void (
    take(
      /\s(?:jam|pukul|pkl|at)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam|am|pm)?\b/i,
      (m) => setTime(m),
    ) ||
    take(/\s(\d{1,2})[:.](\d{2})\s*(pagi|siang|sore|malam|am|pm)?\b/i, (m) => setTime(m)) ||
    take(/\s(\d{1,2})\s*(pagi|siang|sore|malam|am|pm)\b/i, (m) =>
      setTime([m[0], m[1], undefined, m[2]] as unknown as RegExpExecArray),
    )
  );

  function setTime(m: RegExpExecArray) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const part = m[3]?.toLowerCase();
    if ((part === "sore" || part === "malam" || part === "pm") && h < 12) h += 12;
    if (part === "siang" && h < 11) h += 12;
    if ((part === "pagi" || part === "am") && h === 12) h = 0;
    if (h > 23 || min > 59) return;
    let base: Date = due ?? today;
    base = setMinutes(setHours(base, h), min);
    if (!due && base < now) base = addDays(base, 1);
    due = base;
    hasTime = true;
  }
  if (due && !hasTime) due = setHours(due as Date, 17);
  if (!due && recurrence) due = setHours(today, 17);

  const title = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–,.:]+|[-–,.:]+$/g, "")
    .trim();
  return {
    title: title || input.trim(),
    due,
    hasTime,
    tags: [...new Set(tags)],
    assignee,
    priority,
    project,
    recurrence,
    estimateMinutes,
    status,
    matches,
  };
}

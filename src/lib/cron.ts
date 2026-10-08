// Minimal 5-field cron parser for scheduled automations (Phase 9.4). Shared by the browser (form
// preview) and the server (validation in `scheduleAutomation`, `next_run_at` in the n8n tick), so
// both always agree. No dependency: the syntax we need is small and the time-zone math uses Intl.
//
// Syntax: `minute hour day-of-month month day-of-week`
//   *  a  a-b  */n  a-b/n  a/n  and comma lists of those. Months JAN–DEC and days SUN–SAT are
//   accepted (case-insensitive); day-of-week 7 = Sunday. Macros: @hourly @daily @weekly @monthly
//   @yearly. Like Vixie cron, when both day-of-month and day-of-week are restricted a day matches
//   if EITHER matches.
// Times are wall-clock times in an IANA time zone. A local time that does not exist (skipped by a
// DST jump) is skipped; a repeated local time (DST fall-back) runs once, at its first occurrence.

import { format, messages, type Locale, type MessageKey, type MessageVars } from "@/lib/i18n";

export type CronField = { values: number[]; any: boolean };
export type CronSchedule = {
  expr: string;
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
};

type CronErrorKey = Extract<MessageKey, `cronErr${string}`>;

/**
 * Invalid cron / time zone. `message` is the Indonesian text (the server reports it as is);
 * `code` + `vars` let the browser show it in the UI locale via `cronErrorText`.
 */
export class CronError extends Error {
  readonly code: CronErrorKey;
  readonly vars: MessageVars;
  constructor(code: CronErrorKey, vars: MessageVars = {}) {
    super(format(messages.id[code], localizedVars(vars, "id")));
    this.name = "CronError";
    this.code = code;
    this.vars = vars;
  }
}

/** `{field}` holds a field key (`cronErrFieldMinute`…), translated with the message. */
function localizedVars(vars: MessageVars, locale: Locale): MessageVars {
  const field = vars["field"];
  return typeof field === "string" && field in messages[locale]
    ? { ...vars, field: messages[locale][field as MessageKey] }
    : vars;
}

/** A `CronError` in the given UI locale (Indonesian = `error.message`). */
export function cronErrorText(error: CronError, locale: Locale = "id"): string {
  return format(messages[locale][error.code], localizedVars(error.vars, locale));
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};
const SPECS = [
  { name: "menit", key: "cronErrFieldMinute", min: 0, max: 59 },
  { name: "jam", key: "cronErrFieldHour", min: 0, max: 23 },
  { name: "tanggal", key: "cronErrFieldDom", min: 1, max: 31 },
  { name: "bulan", key: "cronErrFieldMonth", min: 1, max: 12, names: MONTHS },
  { name: "hari", key: "cronErrFieldDow", min: 0, max: 7, names: DAYS },
] as const;

export const MAX_CRON_LENGTH = 120;
/** How far `nextRuns` searches before deciding a schedule never fires (e.g. `0 0 31 2 *`). */
const SEARCH_DAYS = 366 * 5;

function parseNumber(raw: string, spec: (typeof SPECS)[number]): number {
  const upper = raw.toUpperCase();
  if ("names" in spec) {
    const i = (spec.names as readonly string[]).indexOf(upper);
    if (i >= 0) return spec.name === "bulan" ? i + 1 : i;
  }
  if (!/^\d{1,2}$/.test(raw)) throw new CronError("cronErrValue", { field: spec.key, raw });
  const n = Number(raw);
  if (n < spec.min || n > spec.max)
    throw new CronError("cronErrRange", { field: spec.key, min: spec.min, max: spec.max, raw });
  return n;
}

function parseField(raw: string, spec: (typeof SPECS)[number]): CronField {
  const set = new Set<number>();
  let any = false;
  for (const part of raw.split(",")) {
    if (!part) throw new CronError("cronErrEmptyList", { field: spec.key });
    const [range = "", stepRaw, extra] = part.split("/");
    if (extra !== undefined) throw new CronError("cronErrStep", { field: spec.key, raw: part });
    let step = 1;
    if (stepRaw !== undefined) {
      if (!/^\d{1,2}$/.test(stepRaw) || Number(stepRaw) < 1)
        throw new CronError("cronErrStep", { field: spec.key, raw: stepRaw });
      step = Number(stepRaw);
    }
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = spec.min;
      hi = spec.name === "hari" ? 6 : spec.max;
      if (step === 1) any = true;
    } else if (range.includes("-")) {
      const [a = "", b = "", more] = range.split("-");
      if (more !== undefined)
        throw new CronError("cronErrRangeInvalid", { field: spec.key, raw: range });
      lo = parseNumber(a, spec);
      hi = parseNumber(b, spec);
      if (lo > hi) throw new CronError("cronErrRangeReversed", { field: spec.key, raw: range });
    } else {
      lo = parseNumber(range, spec);
      // `a/n` means "from a to the end, every n".
      hi = stepRaw !== undefined ? (spec.name === "hari" ? 6 : spec.max) : lo;
    }
    for (let v = lo; v <= hi; v += step) set.add(spec.name === "hari" && v === 7 ? 0 : v);
  }
  return { values: [...set].sort((x, y) => x - y), any };
}

/** Parses a cron expression; throws `CronError` (Indonesian message) when it is invalid. */
export function parseCron(input: string): CronSchedule {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new CronError("cronErrEmpty");
  if (trimmed.length > MAX_CRON_LENGTH) throw new CronError("cronErrTooLong");
  const expr = MACROS[trimmed.toLowerCase()] ?? trimmed;
  const parts = expr.split(" ");
  if (parts.length !== 5) throw new CronError("cronErrParts", { count: parts.length });
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, SPECS[i]!)) as [
    CronField,
    CronField,
    CronField,
    CronField,
    CronField,
  ];
  return { expr, minute, hour, dom, month, dow };
}

export function isValidCron(input: string): boolean {
  try {
    parseCron(input);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ---------------- time zones ---------------- */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of `ms` in `tz`, packed as a UTC timestamp (minute precision). */
function localMs(ms: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(ms)))
    if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p["year"]!, p["month"]! - 1, p["day"]!, p["hour"]! % 24, p["minute"]!);
}

/**
 * UTC instant for a wall-clock time (packed like `localMs`) in `tz`, or null when that local
 * time does not exist (DST gap). For a repeated local time the earlier instant is returned.
 */
function instantOf(local: number, tz: string): number | null {
  const offsetAt = (ms: number) => localMs(ms, tz) - Math.floor(ms / 60_000) * 60_000;
  const candidates = new Set<number>();
  for (const probe of [local - 86_400_000, local, local + 86_400_000])
    candidates.add(local - offsetAt(probe));
  const hits = [...candidates].filter((ms) => localMs(ms, tz) === local).sort((a, b) => a - b);
  return hits[0] ?? null;
}

/** Local calendar date `YYYY-MM-DD` of an instant in `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Date(localMs(at.getTime(), tz)).toISOString().slice(0, 10);
}

/** UTC instant of `hh:mm` local time in `tz`, `days` days after the local day containing `at`. */
export function zonedTime(at: Date, tz: string, days: number, hh: number, mm = 0): Date {
  const d = new Date(localMs(at.getTime(), tz));
  const local = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, hh, mm);
  // A time inside a DST gap moves one hour later (it exists then).
  return new Date(instantOf(local, tz) ?? instantOf(local + 3_600_000, tz) ?? local);
}

/* ---------------- next runs ---------------- */

const has = (f: CronField, v: number) => f.values.includes(v);

function dayMatches(s: CronSchedule, d: Date): boolean {
  const domOk = has(s.dom, d.getUTCDate());
  const dowOk = has(s.dow, d.getUTCDay());
  if (s.dom.any && s.dow.any) return true;
  if (s.dom.any) return dowOk;
  if (s.dow.any) return domOk;
  return domOk || dowOk;
}

/**
 * The next `count` run instants strictly after `after`, in `tz`. Returns fewer (possibly none)
 * when the schedule does not fire within five years.
 */
export function nextRuns(
  schedule: CronSchedule | string,
  tz: string,
  after: Date,
  count = 1,
): Date[] {
  const s = typeof schedule === "string" ? parseCron(schedule) : schedule;
  if (!isValidTimeZone(tz)) throw new CronError("cronErrTimeZone", { tz });
  const out: Date[] = [];
  const afterMs = after.getTime();
  const startLocal = localMs(afterMs, tz);
  const startDay = Math.floor(startLocal / 86_400_000) * 86_400_000;
  for (let day = 0; day <= SEARCH_DAYS && out.length < count; day++) {
    const dayMs = startDay + day * 86_400_000;
    const d = new Date(dayMs);
    if (!has(s.month, d.getUTCMonth() + 1) || !dayMatches(s, d)) continue;
    for (const h of s.hour.values) {
      for (const m of s.minute.values) {
        const local = dayMs + h * 3_600_000 + m * 60_000;
        // Offsets differ by at most a few hours, so earlier local times cannot be after `after`.
        if (local < startLocal - 4 * 3_600_000) continue;
        const at = instantOf(local, tz);
        if (at === null || at <= afterMs) continue;
        if (out.length && at <= out[out.length - 1]!.getTime()) continue;
        out.push(new Date(at));
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

/** Next run strictly after `after`, or null when the schedule never fires. */
export function nextRun(schedule: CronSchedule | string, tz: string, after: Date): Date | null {
  return nextRuns(schedule, tz, after, 1)[0] ?? null;
}

/* ---------------- presets & description ---------------- */

export type SchedulePreset =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; hour: number; minute: number; day: number }
  | { kind: "monthly"; hour: number; minute: number; date: number }
  | { kind: "custom"; cron: string };

export function presetToCron(p: SchedulePreset): string {
  if (p.kind === "custom") return p.cron.trim();
  const base = `${p.minute} ${p.hour}`;
  if (p.kind === "daily") return `${base} * * *`;
  if (p.kind === "weekly") return `${base} * * ${p.day}`;
  return `${base} ${p.date} * *`;
}

/** Recognises the preset shapes produced by `presetToCron`; anything else is "custom". */
export function cronToPreset(expr: string): SchedulePreset {
  const m = /^(\d{1,2}) (\d{1,2}) (\*|\d{1,2}) \* (\*|\d)$/.exec(expr.trim());
  if (m) {
    const minute = Number(m[1]);
    const hour = Number(m[2]);
    if (minute <= 59 && hour <= 23) {
      if (m[3] === "*" && m[4] === "*") return { kind: "daily", hour, minute };
      if (m[3] === "*" && Number(m[4]) <= 6)
        return { kind: "weekly", hour, minute, day: Number(m[4]) };
      if (m[4] === "*" && Number(m[3]) >= 1 && Number(m[3]) <= 31)
        return { kind: "monthly", hour, minute, date: Number(m[3]) };
    }
  }
  return { kind: "custom", cron: expr };
}

export const WEEKDAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Weekday names (0 = Sunday) in a UI locale, for the schedule picker. */
export function weekdayNames(locale: Locale = "id"): readonly string[] {
  return locale === "en" ? WEEKDAYS_EN : WEEKDAYS_ID;
}

const pad = (n: number) => String(n).padStart(2, "0");

function listOf(f: CronField, label: (v: number) => string) {
  return f.values.map(label).join(", ");
}

/**
 * Human-readable description in a UI locale (default Indonesian), e.g. "Setiap Senin pukul
 * 09:00" / "Every Monday at 09:00". Only the browser shows it; parser errors are translated
 * from their code (`cronErrorText`), while `CronError.message` stays the server's Indonesian.
 */
export function describeCron(input: string, locale: Locale = "id"): string {
  const t = (key: MessageKey, vars?: MessageVars) => format(messages[locale][key], vars);
  const weekdays = weekdayNames(locale);
  const months = locale === "en" ? MONTHS_EN : MONTHS_ID;
  let s: CronSchedule;
  try {
    s = parseCron(input);
  } catch (e) {
    return e instanceof CronError
      ? t("autoCronInvalidDetail", { detail: cronErrorText(e, locale) })
      : t("autoCronInvalid");
  }
  const preset = cronToPreset(s.expr);
  if (preset.kind !== "custom") {
    const time = t("autoCronAt", { time: `${pad(preset.hour)}:${pad(preset.minute)}` });
    if (preset.kind === "daily") return t("autoCronDaily", { time });
    if (preset.kind === "weekly") return t("autoCronWeekly", { day: weekdays[preset.day]!, time });
    return t("autoCronMonthly", { date: preset.date, time });
  }
  const parts: string[] = [];
  const [mRaw = "", hRaw = ""] = s.expr.split(" ");
  const step = (raw: string) => /^\*\/(\d+)$/.exec(raw)?.[1];
  const mStep = step(mRaw);
  const hStep = step(hRaw);
  if (s.minute.any && s.hour.any) parts.push(t("autoCronEveryMinute"));
  else if (mStep && s.hour.any) parts.push(t("autoCronEveryNMinutes", { n: mStep }));
  else if (s.hour.any)
    parts.push(t("autoCronHourlyAtMinutes", { minutes: listOf(s.minute, String) }));
  else if (hStep && s.minute.values.length === 1)
    parts.push(t("autoCronEveryNHours", { n: hStep, minute: s.minute.values[0]! }));
  else if (s.minute.values.length * s.hour.values.length <= 6)
    parts.push(
      t("autoCronAtTimes", {
        times: s.hour.values
          .flatMap((h) => s.minute.values.map((m) => `${pad(h)}:${pad(m)}`))
          .join(", "),
      }),
    );
  else
    parts.push(
      t("autoCronHoursMinutes", {
        hours: listOf(s.hour, (h) => pad(h)),
        minutes: listOf(s.minute, (m) => pad(m)),
      }),
    );
  const days: string[] = [];
  if (!s.dom.any) days.push(t("autoCronOnDates", { dates: listOf(s.dom, String) }));
  if (!s.dow.any) days.push(t("autoCronOnWeekdays", { days: listOf(s.dow, (d) => weekdays[d]!) }));
  if (days.length) parts.push(days.join(` ${t("autoCronOr")} `));
  if (!s.month.any)
    parts.push(t("autoCronInMonths", { months: listOf(s.month, (m) => months[m - 1]!) }));
  return parts.join(", ");
}

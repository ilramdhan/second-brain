// Time-zone helpers for digests, reminders and NLP on servers that run in UTC (Vercel).
// APP_TIMEZONE (IANA name, default Asia/Jakarta) defines "today" for every user.
import { parseTaskText, type ParsedTask } from "@/lib/nlp";

export const DEFAULT_TIMEZONE = "Asia/Jakarta";

export function appTimezone(env: Record<string, string | undefined> = process.env) {
  const tz = env["APP_TIMEZONE"]?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function zonedParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `tz` from UTC at `date`, in ms (Asia/Jakarta → +7 h). */
export function tzOffsetMs(date: Date, tz: string) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight in `tz`, `days` days from the day containing `date`. */
export function startOfZonedDay(date: Date, tz: string, days = 0) {
  const p = zonedParts(date, tz);
  const guess = Date.UTC(p.year, p.month - 1, p.day + days);
  return new Date(guess - tzOffsetMs(new Date(guess), tz));
}

/** Calendar date (YYYY-MM-DD) in `tz`, `days` days from the day containing `date`. */
export function zonedIsoDate(date: Date, tz: string, days = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  if (!days) return today;
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** `parseTaskText` evaluated in `tz` instead of the server's local zone. */
export function parseTaskTextInZone(text: string, now: Date, tz: string): ParsedTask {
  const shift = tzOffsetMs(now, tz) + now.getTimezoneOffset() * 60_000;
  const parsed = parseTaskText(text, new Date(now.getTime() + shift));
  return { ...parsed, due: parsed.due ? new Date(parsed.due.getTime() - shift) : null };
}

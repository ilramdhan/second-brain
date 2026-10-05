// Pure message builders for Telegram replies, reminders and digests (parse_mode HTML).
import type { DigestKind } from "./schemas.server";

export type InlineButton = { text: string; callback_data: string };
export type ReplyMarkup = { inline_keyboard: InlineButton[][] } | null;
export type OutMessage = {
  chat_id: string;
  text: string;
  parse_mode: "HTML";
  reply_markup: ReplyMarkup;
};

export type DigestTask = {
  id: string;
  title: string;
  due_date: string | null;
  priority: string;
  status: string;
  tags?: string[] | null;
};

const PRIORITY_ICON: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };

export function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatDue(iso: string, tz: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function taskLine(task: DigestTask, tz: string) {
  const icon = PRIORITY_ICON[task.priority] ?? "▫️";
  const due = task.due_date ? ` · 📅 ${formatDue(task.due_date, tz)}` : "";
  return `${icon} ${escapeHtml(task.title)}${due}`;
}

/** One ✅ button per task (max 8 rows) so a digest stays readable. */
export function doneButtons(tasks: DigestTask[], max = 8): ReplyMarkup {
  const rows = tasks
    .slice(0, max)
    .map((t) => [{ text: `✅ ${t.title.slice(0, 28)}`, callback_data: `done:${t.id}` }]);
  return rows.length ? { inline_keyboard: rows } : null;
}

export function section(title: string, tasks: DigestTask[], tz: string, max = 10) {
  if (!tasks.length) return "";
  const more = tasks.length > max ? `\n… dan ${tasks.length - max} lainnya` : "";
  return `<b>${title}</b>\n${tasks
    .slice(0, max)
    .map((t) => taskLine(t, tz))
    .join("\n")}${more}`;
}

export type DigestData = {
  today: DigestTask[];
  overdue: DigestTask[];
  tomorrow: DigestTask[];
  completedToday: DigestTask[];
  inboxPending: number;
  week?: {
    completed: number;
    created: number;
    overdue: number;
    activeProjects: number;
    newNotes: number;
    focus: DigestTask[];
  };
};

/** Returns null when there is nothing to tell the user (the digest is skipped). */
export function buildDigest(
  kind: DigestKind,
  data: DigestData,
  tz: string,
): { text: string; reply_markup: ReplyMarkup } | null {
  const parts: string[] = [];
  let buttons: DigestTask[] = [];
  if (kind === "morning") {
    if (!data.today.length && !data.overdue.length && !data.inboxPending) return null;
    parts.push("☀️ <b>Selamat pagi!</b> Ini rencana hari ini.");
    parts.push(section(`📋 Hari ini (${data.today.length})`, data.today, tz));
    parts.push(section(`⚠️ Terlambat (${data.overdue.length})`, data.overdue, tz, 5));
    if (data.inboxPending) parts.push(`📥 Inbox menunggu diproses: <b>${data.inboxPending}</b>`);
    buttons = [...data.overdue, ...data.today];
  } else if (kind === "overdue") {
    if (!data.overdue.length) return null;
    parts.push(`⚠️ <b>${data.overdue.length} tugas terlambat</b>`);
    parts.push(section("Selesaikan atau jadwalkan ulang:", data.overdue, tz));
    buttons = data.overdue;
  } else if (kind === "evening") {
    if (!data.completedToday.length && !data.tomorrow.length && !data.overdue.length) return null;
    parts.push("🌙 <b>Ringkasan hari ini</b>");
    parts.push(
      data.completedToday.length
        ? `✅ Selesai hari ini: <b>${data.completedToday.length}</b>\n${data.completedToday
            .slice(0, 10)
            .map((t) => `• <s>${escapeHtml(t.title)}</s>`)
            .join("\n")}`
        : "Belum ada tugas yang selesai hari ini.",
    );
    parts.push(section(`📅 Besok (${data.tomorrow.length})`, data.tomorrow, tz));
    if (data.overdue.length) parts.push(`⚠️ Masih terlambat: <b>${data.overdue.length}</b>`);
    buttons = data.overdue;
  } else {
    const w = data.week;
    if (!w || (!w.completed && !w.created && !w.overdue && !w.newNotes)) return null;
    parts.push("📊 <b>Weekly review</b> (7 hari terakhir)");
    parts.push(
      [
        `✅ Selesai: <b>${w.completed}</b>`,
        `➕ Tugas baru: <b>${w.created}</b>`,
        `⚠️ Terlambat: <b>${w.overdue}</b>`,
        `📁 Proyek aktif: <b>${w.activeProjects}</b>`,
        `📝 Catatan baru: <b>${w.newNotes}</b>`,
        `📥 Inbox pending: <b>${data.inboxPending}</b>`,
      ].join("\n"),
    );
    parts.push(section("🎯 Saran fokus minggu depan", w.focus, tz, 5));
    buttons = w.focus;
  }
  return { text: parts.filter(Boolean).join("\n\n"), reply_markup: doneButtons(buttons) };
}

export function buildReminder(
  task: DigestTask,
  now: Date,
  tz: string,
): { text: string; reply_markup: ReplyMarkup } {
  const overdue = task.due_date ? new Date(task.due_date) < now : false;
  const head = overdue ? "🔴 <b>Terlambat</b>" : "⏰ <b>Segera jatuh tempo</b>";
  const due = task.due_date ? `\n📅 ${formatDue(task.due_date, tz)}` : "";
  return {
    text: `${head}: ${escapeHtml(task.title)}${due}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Selesai", callback_data: `done:${task.id}` },
          { text: "⏰ +1 jam", callback_data: `snooze:${task.id}:1h` },
          { text: "📅 Besok", callback_data: `snooze:${task.id}:1d` },
        ],
      ],
    },
  };
}

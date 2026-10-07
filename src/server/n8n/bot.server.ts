// POST /api/public/n8n/bot — Telegram bot logic for n8n mode. n8n downloads files and runs
// OCR/transcription; this module only receives text and returns the reply for n8n to send
// (`method: "send"` → sendMessage, `method: "callback"` → answerCallbackQuery + editMessageText).
import { escapeHtml, formatDue, taskLine, type ReplyMarkup } from "./format.server";
import { parseCallback, type BotRequest } from "./schemas.server";
import * as svc from "./service.server";
import { looksLikeNote } from "../noteExtract.server";
import { looksLikeTask } from "../taskExtract.server";
import { appTimezone, startOfZonedDay } from "./time.server";

export type BotReply =
  | {
      method: "send";
      text: string;
      parse_mode: "HTML";
      reply_markup: ReplyMarkup;
      reply_to?: boolean;
    }
  | {
      method: "callback";
      toast: string;
      text: string;
      parse_mode: "HTML";
      reply_markup: ReplyMarkup;
    };

const send = (text: string, reply_markup: ReplyMarkup = null): BotReply => ({
  method: "send",
  text,
  parse_mode: "HTML",
  reply_markup,
});
const callback = (toast: string, text: string, reply_markup: ReplyMarkup = null): BotReply => ({
  method: "callback",
  toast,
  text,
  parse_mode: "HTML",
  reply_markup,
});

export const HELP_TEXT = [
  "<b>Second Brain bot</b>",
  "Kirim teks apa pun → Inbox (tugas bila ada tanggal/prioritas, catatan bila diawali <i>catatan:</i> atau berisi [[tautan]]).",
  "",
  "/task &lt;teks&gt; — buat tugas lengkap (AI mengisi proyek, PJ, tanggal, estimasi, tag, dependensi, komentar; tanpa AI: <i>besok 9:00 #tag !high +proyek @orang ~2j status:review</i>)",
  "/note &lt;teks&gt; — buat catatan lengkap (AI menyusun judul, subjudul/poin/checklist, status, proyek, tag, tautan [[catatan]], properti; tanpa AI: <i>Judul | isi #tag +proyek status:draf !pin</i>)",
  "/inbox — item Inbox yang menunggu",
  "/today, /upcoming, /overdue, /week — daftar tugas",
  "/done &lt;kata kunci&gt; — tandai selesai",
  "/search &lt;kueri&gt; — cari tugas &amp; catatan",
  "/sum &lt;teks&gt; — ringkas dengan AI → catatan",
  "/link KODE, /unlink, /help",
  "Foto/PDF → OCR, voice note → transkripsi.",
].join("\n");

const LINK_HOWTO =
  "Buka Second Brain → Pengaturan → Bot Telegram → <b>Hubungkan Telegram</b>, lalu kirim " +
  "<code>/link KODE</code> ke sini (berlaku 10 menit, sekali pakai).";
const NOT_LINKED = `Akun belum terhubung.\n\n${LINK_HOWTO}`;
const LINK_FAILED =
  "Kode tidak valid atau sudah kedaluwarsa. Buat kode baru di Pengaturan → Bot Telegram.";

/** Splits `/cmd@Bot args` → ["cmd", "args"]; null for non-commands. */
export function parseCommand(text: string): { cmd: string; args: string } | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  return { cmd: m[1]!.toLowerCase(), args: (m[2] ?? "").trim() };
}

/** `/note Judul | isi` → {title, body}; without `|` the first line is the title. */
export function splitNote(args: string): { title: string; body: string } {
  const bar = args.indexOf("|");
  if (bar >= 0) return { title: args.slice(0, bar).trim(), body: args.slice(bar + 1).trim() };
  const [first, ...rest] = args.split("\n");
  return { title: (first ?? "").trim(), body: rest.join("\n").trim() };
}

function inboxButtons(id: string): ReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Jadikan tugas", callback_data: `totask:${id}` },
        { text: "📝 Jadikan catatan", callback_data: `tonote:${id}` },
      ],
      [{ text: "🗑 Hapus", callback_data: `del:${id}` }],
    ],
  };
}

type Ctx = { userId: string; origin: string | null; tz: string; now: Date };

function taskButtons(taskId: string): ReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Selesai", callback_data: `done:${taskId}` },
        { text: "📅 Besok", callback_data: `snooze:${taskId}:1d` },
      ],
    ],
  };
}

/**
 * Creates a fully filled task from free text: AI extraction (projects, members and open tasks of
 * the user as candidates) with the regex parser as fallback, then the reply lists every field
 * that was filled and what was ignored.
 */
async function createTaskFromText(ctx: Ctx, text: string, source: string | null) {
  const { captureTaskFromText } = await import("../taskCapture.server");
  const { describeResolvedTask } = await import("../taskExtract.server");
  const result = await captureTaskFromText(ctx.userId, text, {
    clock: { now: ctx.now, tz: ctx.tz },
    origin: ctx.origin,
    note: source ? `Dibuat dari Telegram (${source})` : null,
  });
  return send(
    describeResolvedTask(result.resolved, result.via, ctx.tz, {
      dependencies: result.dependencies,
      comments: result.comments,
    }),
    taskButtons(result.task.id),
  );
}

/**
 * Creates a fully filled note from free text: AI extraction (projects, note titles and tags of the
 * user as candidates) with the local fallback; the reply lists the filled fields.
 */
async function createNoteFromText(ctx: Ctx, text: string, extraTags: string[] = []) {
  const { captureNoteFromText } = await import("../noteCapture.server");
  const { describeResolvedNote } = await import("../noteExtract.server");
  const result = await captureNoteFromText(ctx.userId, text, {
    clock: { now: ctx.now, tz: ctx.tz },
    origin: ctx.origin,
    adjust: (r) => {
      if (!extraTags.length) return;
      r.insert.tags = [...new Set([...r.insert.tags, ...extraTags])];
      if (!r.filled.includes("tags")) r.filled.push("tags");
    },
  });
  return describeResolvedNote(result.resolved, result.via);
}

async function captureText(ctx: Ctx, text: string, source: "telegram" | "ocr" | "voice") {
  // Plain text becomes a task only when the local parser finds a task signal (date, priority,
  // estimate or status token); the full field extraction then runs on the whole message.
  // "catatan: …" / "note: …" or a [[link]] makes it a note instead.
  if (source === "telegram" && looksLikeNote(text))
    return send(await createNoteFromText(ctx, text));
  if (source === "telegram" && looksLikeTask(text, ctx.now, ctx.tz))
    return createTaskFromText(ctx, text, null);
  const item = await svc.createInboxItem(ctx.userId, text, source);
  return send(`📥 Tersimpan di Inbox`, inboxButtons(item.id));
}

async function listReply(ctx: Ctx, kind: "today" | "upcoming" | "overdue" | "week") {
  const today = startOfZonedDay(ctx.now, ctx.tz);
  const ranges = {
    today: { dueFrom: today, dueBefore: startOfZonedDay(ctx.now, ctx.tz, 1), title: "📋 Hari ini" },
    upcoming: {
      dueFrom: startOfZonedDay(ctx.now, ctx.tz, 1),
      dueBefore: startOfZonedDay(ctx.now, ctx.tz, 8),
      title: "📆 7 hari ke depan",
    },
    overdue: { dueFrom: undefined, dueBefore: ctx.now, title: "⚠️ Terlambat" },
    week: { dueFrom: today, dueBefore: startOfZonedDay(ctx.now, ctx.tz, 7), title: "🗓 Minggu ini" },
  } as const;
  const r = ranges[kind];
  const tasks = await svc.listTasks(ctx.userId, {
    open: true,
    ...(r.dueFrom ? { dueFrom: r.dueFrom } : {}),
    dueBefore: r.dueBefore,
    limit: 20,
  });
  if (!tasks.length) return send(`${r.title}: tidak ada tugas. 🎉`);
  return send(
    `<b>${r.title} (${tasks.length})</b>\n${tasks.map((t) => taskLine(t, ctx.tz)).join("\n")}`,
    {
      inline_keyboard: tasks
        .slice(0, 8)
        .map((t) => [{ text: `✅ ${t.title.slice(0, 28)}`, callback_data: `done:${t.id}` }]),
    },
  );
}

const INBOX_PAGE = 10;

async function inboxReply(ctx: Ctx, page: number) {
  const { items, total } = await svc.pendingInbox(ctx.userId, page * INBOX_PAGE, INBOX_PAGE);
  if (!total) return { text: "📥 Inbox kosong. 🎉", reply_markup: null as ReplyMarkup };
  const lines = items.map(
    (it, i) => `${page * INBOX_PAGE + i + 1}. ${escapeHtml(it.content.slice(0, 120))}`,
  );
  const rows = items.map((it, i) => [
    { text: `✅ ${page * INBOX_PAGE + i + 1}`, callback_data: `totask:${it.id}` },
    { text: "📝", callback_data: `tonote:${it.id}` },
    { text: "🗑", callback_data: `del:${it.id}` },
  ]);
  const nav = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: `page:inbox:${page - 1}` });
  if ((page + 1) * INBOX_PAGE < total)
    nav.push({ text: "▶️", callback_data: `page:inbox:${page + 1}` });
  if (nav.length) rows.push(nav);
  return {
    text: `<b>📥 Inbox (${total})</b>\n${lines.join("\n")}`,
    reply_markup: { inline_keyboard: rows } as ReplyMarkup,
  };
}

async function doneByKeyword(ctx: Ctx, keyword: string) {
  if (!keyword) return send("Pakai: <code>/done kata kunci</code>");
  const tasks = await svc.listTasks(ctx.userId, { open: true, search: keyword, limit: 8 });
  if (!tasks.length)
    return send(`Tidak ada tugas terbuka yang cocok dengan "${escapeHtml(keyword)}".`);
  if (tasks.length > 1)
    return send("Pilih tugas yang selesai:", {
      inline_keyboard: tasks.map((t) => [
        { text: `✅ ${t.title.slice(0, 40)}`, callback_data: `done:${t.id}` },
      ]),
    });
  const task = await svc.findTask(ctx.userId, tasks[0]!.id);
  if (!task) return send("Tugas tidak ditemukan.");
  return send(await completeText(ctx, task));
}

async function completeText(ctx: Ctx, task: svc.Task) {
  const result = await svc.completeTask(ctx.userId, task, ctx.origin);
  if (!result.ok && result.reason === "blocked")
    return `🔒 Terkunci: tunggu "${escapeHtml(result.blocker)}" selesai dulu.`;
  if (!result.ok) return `✔️ <s>${escapeHtml(task.title)}</s> sudah selesai.`;
  const extra = [
    result.recurring?.due_date
      ? `🔁 Berikutnya: ${formatDue(result.recurring.due_date, ctx.tz)}`
      : null,
    result.unblocked.length ? `🔓 ${result.unblocked.length} tugas tidak terkunci lagi` : null,
  ].filter(Boolean);
  return `✔️ <s>${escapeHtml(task.title)}</s>${extra.length ? `\n${extra.join("\n")}` : ""}`;
}

async function searchReply(ctx: Ctx, q: string) {
  if (q.length < 2) return send("Pakai: <code>/search kueri</code>");
  const [tasks, notes] = await Promise.all([
    svc.listTasks(ctx.userId, { search: q, limit: 8 }),
    svc.searchNotes(ctx.userId, q, 5),
  ]);
  if (!tasks.length && !notes.length) return send(`Tidak ada hasil untuk "${escapeHtml(q)}".`);
  const parts = [];
  if (tasks.length)
    parts.push(
      `<b>Tugas</b>\n${tasks.map((t) => `${t.status === "done" ? "✔️" : "▫️"} ${escapeHtml(t.title)}`).join("\n")}`,
    );
  if (notes.length)
    parts.push(`<b>Catatan</b>\n${notes.map((n) => `📝 ${escapeHtml(n.title)}`).join("\n")}`);
  return send(parts.join("\n\n"));
}

async function sumReply(ctx: Ctx, text: string) {
  if (!text) return send("Pakai: <code>/sum teks</code>");
  const summary = await svc.summarizeForUser(ctx.userId, text);
  if (!summary)
    return send("AI belum dikonfigurasi atau batas penggunaan tercapai. Coba lagi nanti.");
  const title = `Ringkasan ${new Intl.DateTimeFormat("id-ID", { timeZone: ctx.tz, dateStyle: "medium" }).format(ctx.now)}`;
  const note = await svc.createNote(
    ctx.userId,
    title,
    `${summary}\n\n---\n${text}`,
    { tags: ["ringkasan"] },
    ctx.origin,
  );
  return send(`📝 <b>${escapeHtml(note.title)}</b>\n\n${escapeHtml(summary)}`);
}

async function handleCommand(ctx: Ctx, cmd: string, args: string): Promise<BotReply> {
  switch (cmd) {
    case "help":
    case "start":
      return send(HELP_TEXT);
    case "task":
    case "tugas":
      return args ? createTaskFromText(ctx, args, null) : send("Pakai: <code>/task teks</code>");
    case "note":
    case "catatan":
      return args
        ? send(await createNoteFromText(ctx, args))
        : send("Pakai: <code>/note teks</code> (atau <code>/note Judul | isi</code>)");
    case "inbox": {
      if (args) {
        const item = await svc.createInboxItem(ctx.userId, args, "telegram");
        return send("📥 Tersimpan di Inbox", inboxButtons(item.id));
      }
      const r = await inboxReply(ctx, 0);
      return send(r.text, r.reply_markup);
    }
    case "today":
    case "upcoming":
    case "overdue":
    case "week":
      return listReply(ctx, cmd);
    case "done":
      return doneByKeyword(ctx, args);
    case "search":
    case "cari":
      return searchReply(ctx, args);
    case "sum":
      return sumReply(ctx, args);
    case "unlink": {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("profiles")
        .update({ telegram_chat_id: null, telegram_username: null })
        .eq("id", ctx.userId);
      return send("🔌 Akun diputus dari chat ini.");
    }
    default:
      return send(`Perintah tidak dikenal.\n\n${HELP_TEXT}`);
  }
}

async function handleCallback(ctx: Ctx, data: string): Promise<BotReply> {
  const cb = parseCallback(data);
  if (!cb) return callback("Tombol tidak valid", "⚠️ Tombol sudah tidak berlaku.");
  if (cb.action === "page") {
    const r = await inboxReply(ctx, cb.page);
    return callback("", r.text, r.reply_markup);
  }
  if (cb.action === "done" || cb.action === "snooze") {
    const task = await svc.findTask(ctx.userId, cb.id);
    if (!task)
      return callback("Tugas tidak ditemukan", "⚠️ Tugas tidak ditemukan atau sudah dihapus.");
    if (cb.action === "done") {
      const text = await completeText(ctx, task);
      return callback(text.startsWith("🔒") ? "Masih terkunci" : "Ditandai selesai", text);
    }
    const due = await svc.snoozeTask(
      ctx.userId,
      task,
      cb.action === "snooze" ? cb.minutes : 1440,
      ctx.origin,
    );
    return callback(
      "Ditunda",
      `⏰ ${escapeHtml(task.title)}\n📅 ${formatDue(due.toISOString(), ctx.tz)}`,
      { inline_keyboard: [[{ text: "✅ Selesai", callback_data: `done:${task.id}` }]] },
    );
  }
  const item = await svc.findInboxItem(ctx.userId, cb.id);
  if (!item || item.status !== "pending")
    return callback("Sudah diproses", "✔️ Item Inbox sudah diproses.");
  if (cb.action === "del") {
    await svc.deleteInboxItem(ctx.userId, item.id);
    return callback("Dihapus", `🗑 <s>${escapeHtml(item.content.slice(0, 200))}</s>`);
  }
  if (cb.action === "totask") {
    const { captureTaskFromText } = await import("../taskCapture.server");
    const result = await captureTaskFromText(ctx.userId, item.content, {
      clock: { now: ctx.now, tz: ctx.tz },
      origin: ctx.origin,
    });
    await svc.setInboxStatus(ctx.userId, item.id, "processed");
    const { describeResolvedTask } = await import("../taskExtract.server");
    return callback(
      "Tugas dibuat",
      describeResolvedTask(result.resolved, result.via, ctx.tz, {
        dependencies: result.dependencies,
        comments: result.comments,
      }),
      { inline_keyboard: [[{ text: "✅ Selesai", callback_data: `done:${result.task.id}` }]] },
    );
  }
  const text = await createNoteFromText(ctx, item.content);
  await svc.setInboxStatus(ctx.userId, item.id, "processed");
  return callback("Catatan dibuat", text);
}

/** OCR/voice: caption decides the target (/task, /note, /inbox, /sum); default note + inbox. */
async function handleMedia(ctx: Ctx, body: BotRequest): Promise<BotReply> {
  const content = (body.kind === "ocr" ? body.ocr_text : body.transcript)!.trim();
  const source = body.kind === "ocr" ? "ocr" : "voice";
  const caption = parseCommand(body.text ?? "");
  if (caption?.cmd === "task")
    return createTaskFromText(ctx, `${caption.args} ${content}`.trim().slice(0, 500), source);
  if (caption?.cmd === "sum") return sumReply(ctx, content);
  // "/note" caption: the transcript/OCR text becomes a fully filled note (caption text first,
  // so "/note Judul" still names it).
  if (caption?.cmd === "note" || caption?.cmd === "catatan")
    return send(await createNoteFromText(ctx, `${caption.args}\n${content}`.trim(), [source]));
  if (caption?.cmd === "inbox") {
    const item = await svc.createInboxItem(ctx.userId, content, source);
    return send("📥 Tersimpan di Inbox", inboxButtons(item.id));
  }
  if (source === "voice" && !caption) return captureText(ctx, content, "voice");
  const stamp = new Intl.DateTimeFormat("id-ID", {
    timeZone: ctx.tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ctx.now);
  const title = `${source === "ocr" ? "OCR" : "Voice"} ${stamp}`;
  const note = await svc.createNote(ctx.userId, title, content, { tags: [source] }, ctx.origin);
  const item = await svc.createInboxItem(ctx.userId, content, source);
  return send(
    `📝 <b>${escapeHtml(note.title)}</b> tersimpan.\n\n${escapeHtml(content.slice(0, 600))}${content.length > 600 ? "…" : ""}`,
    inboxButtons(item.id),
  );
}

export async function handleBot(body: BotRequest, origin: string | null): Promise<BotReply> {
  const text = (body.text ?? "").trim();
  const command = body.kind === "text" ? parseCommand(text) : null;

  // Linking works before the chat is known; same one-time-code flow as app mode.
  if (command && (command.cmd === "link" || (command.cmd === "start" && command.args))) {
    if (!command.args) return send(LINK_HOWTO);
    const { redeemTelegramLinkCode } = await import("../telegramLink.server");
    const result = await redeemTelegramLinkCode(command.args, body.chat_id, body.username ?? null);
    return send(result.ok ? "✅ Akun terhubung! Kirim /help untuk daftar perintah." : LINK_FAILED);
  }

  const userId = await svc.userIdByChat(body.chat_id);
  if (!userId) {
    if (command?.cmd === "start" || command?.cmd === "help")
      return send(`${HELP_TEXT}\n\n${LINK_HOWTO}`);
    return body.kind === "callback"
      ? callback("Akun belum terhubung", NOT_LINKED)
      : send(NOT_LINKED);
  }
  const ctx: Ctx = { userId, origin, tz: appTimezone(), now: new Date() };

  if (body.kind === "callback") return handleCallback(ctx, body.callback_data!);
  if (body.kind === "ocr" || body.kind === "voice") return handleMedia(ctx, body);
  if (command) return handleCommand(ctx, command.cmd, command.args);
  return captureText(ctx, text, "telegram");
}

// Scheduled automation rules (Phase 9.4): `schedule` trigger + 5-field cron + time zone.
//
// n8n calls `POST /api/public/n8n/automations/tick` every 5 minutes (workflow 10). The tick reads
// enabled rules whose `next_run_at` is due (across all users, service role), then for each rule:
//   1. claims the window with a compare-and-swap: `UPDATE ... SET next_run_at = <next>,
//      last_run_at = now WHERE id = ? AND next_run_at = <value it read>`. Only one tick can win a
//      given window, so overlapping ticks, n8n retries and a slow previous run never run it twice;
//   2. runs the actions for the rule's owner (every query scoped to that user);
//   3. logs the run in `automation_runs` and bumps `run_count`.
// Missed windows (n8n down for a day) run once on the next tick, then `next_run_at` jumps to the
// first window after "now": no burst of catch-up runs.
//
// Scheduled rules have no task or note to act on, so they get their own, deliberately small set
// of actions (see ACTIONS_BY_SCOPE.schedule):
//   * create_task  : inserts a task for the owner (title placeholders {{date}} {{weekday}} {{rule}},
//                    optional project the owner can reach, priority, due N days later at 17:00);
//   * move_overdue : moves the owner's open overdue tasks (or those of one reachable project) to
//                    todo / in_progress / review. Never to "done": completion has its own rules
//                    (blocked check, recurrence) in `complete_task`. At most 200 tasks per run;
//   * digest       : sends the same digest as workflow 02 (morning/overdue/evening/weekly) to the
//                    owner's linked Telegram chat or an HTTPS webhook (SSRF-guarded, text only).
// Like every other action they write directly and never trigger rules.
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Tables } from "@/integrations/supabase/types";
import type { Action, Trigger } from "@/lib/automation-types";
import { CronError, isValidTimeZone, localDate, nextRun, WEEKDAYS_ID } from "@/lib/cron";

import {
  appUrl,
  createTaskFromAction,
  parseAction,
  projectAccessible,
  telegramToUser,
} from "./automationActions.server";

type Rule = Tables<"automations">;
type Client = SupabaseClient<Database>;

export const MOVE_OVERDUE_LIMIT = 200;

/** Time zone of a rule: its own when valid, else the deployment's APP_TIMEZONE. */
export function ruleTimezone(rule: Pick<Rule, "schedule_tz">, fallback: string) {
  return rule.schedule_tz && isValidTimeZone(rule.schedule_tz) ? rule.schedule_tz : fallback;
}

/**
 * `next_run_at` for a rule after `after`: null when it is not a schedule rule, disabled, has no
 * cron, or never fires. Throws `CronError` for an invalid cron/time zone.
 */
export function computeNextRun(
  rule: Pick<Rule, "enabled" | "trigger" | "schedule_cron" | "schedule_tz">,
  after: Date,
  fallbackTz: string,
): string | null {
  if ((rule.trigger as unknown as Trigger | null)?.type !== "schedule") return null;
  if (!rule.enabled || !rule.schedule_cron) return null;
  if (rule.schedule_tz && !isValidTimeZone(rule.schedule_tz))
    throw new CronError(`zona waktu "${rule.schedule_tz}" tidak dikenal`);
  return nextRun(rule.schedule_cron, ruleTimezone(rule, fallbackTz), after)?.toISOString() ?? null;
}

/* ---------------- actions ---------------- */

type RunCtx = {
  db: Client;
  userId: string;
  rule: Rule;
  now: Date;
  tz: string;
  origin: string | null;
  demo: boolean;
};

/**
 * Telegram-HTML digest → plain text for webhooks. The digest builder only emits `<b>`/`<s>` and
 * escapes user text (`escapeHtml`), so dropping exactly those tags and then decoding the three
 * entities in one pass yields the original text. Nothing here is rendered as HTML.
 */
const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&" };
export function digestToText(html: string) {
  return html.replace(/<\/?[bs]>|&(?:lt|gt|amp);/g, (m) => ENTITIES[m] ?? "");
}

async function moveOverdue(ctx: RunCtx, projectId: string | null | undefined, status: string) {
  const { db, userId, now } = ctx;
  let query = db
    .from("tasks")
    .select("id")
    .neq("status", "done")
    .neq("status", status)
    .lt("due_date", now.toISOString())
    .is("deleted_at", null)
    .is("archived_at", null);
  if (projectId) {
    if (!(await projectAccessible(db, userId, projectId)))
      throw new Error("Proyek tidak ditemukan");
    query = query.eq("project_id", projectId);
  } else {
    query = query.eq("user_id", userId);
  }
  const { data, error } = await query.limit(MOVE_OVERDUE_LIMIT);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((t) => t.id);
  if (!ids.length) return 0;
  const { error: upd } = await db
    .from("tasks")
    .update({ status, completed_at: null, updated_at: now.toISOString() })
    .in("id", ids);
  if (upd) throw new Error(upd.message);
  return ids.length;
}

async function sendDigest(ctx: RunCtx, a: Extract<Action, { type: "digest" }>) {
  const { loadDigestData } = await import("./n8n/digest.server");
  const { buildDigest } = await import("./n8n/format.server");
  const digest = buildDigest(
    a.kind,
    await loadDigestData(a.kind, ctx.userId, ctx.now, ctx.tz),
    ctx.tz,
  );
  if (!digest) return "ringkasan kosong";
  if (ctx.demo) return `${a.channel} dilewati (demo)`;
  if (a.channel === "telegram") {
    await telegramToUser(ctx.db, ctx.userId, digest.text, {
      parse_mode: "HTML",
      reply_markup: digest.reply_markup ?? undefined,
    });
    return "ringkasan telegram";
  }
  if (!a.url) throw new Error("URL webhook kosong");
  const { safeWebhookPost } = await import("./ssrf.server");
  const text = digestToText(digest.text);
  await safeWebhookPost(a.url, {
    text,
    content: text,
    rule: ctx.rule.name,
    event: "schedule",
    kind: a.kind,
    url: appUrl(ctx.origin, "/today"),
  });
  return "ringkasan webhook";
}

/** Runs the actions of one claimed scheduled rule; returns `{ok, log}`. */
export async function runScheduledActions(ctx: RunCtx) {
  const log: string[] = [];
  let ok = true;
  const date = localDate(ctx.now, ctx.tz);
  const weekday = WEEKDAYS_ID[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  const values = {
    date: new Intl.DateTimeFormat("id-ID", { timeZone: ctx.tz, dateStyle: "medium" }).format(
      ctx.now,
    ),
    weekday,
    rule: ctx.rule.name,
  };
  for (const raw of (ctx.rule.actions as unknown[]) ?? []) {
    const a = parseAction(raw);
    try {
      if (!a) throw new Error("aksi tidak valid");
      if (a.type === "create_task") {
        const task = await createTaskFromAction(ctx.db, ctx.userId, a, {
          values,
          tz: ctx.tz,
          now: ctx.now,
        });
        log.push(`tugas "${task.title}"`);
      } else if (a.type === "move_overdue") {
        const n = await moveOverdue(ctx, a.project_id, a.status);
        log.push(`${n} tugas terlambat → ${a.status}`);
      } else if (a.type === "digest") {
        log.push(await sendDigest(ctx, a));
      } else {
        log.push(`${a.type} tidak berlaku untuk jadwal`);
      }
    } catch (e) {
      ok = false;
      log.push(`gagal: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return { ok, log };
}

/* ---------------- tick ---------------- */

export type TickResult = {
  now: string;
  due: number;
  ran: number;
  skipped: number;
  failed: number;
  results: {
    rule_id: string;
    user_id: string;
    ok: boolean;
    next_run_at: string | null;
    detail: string;
  }[];
};

/**
 * Runs every due scheduled rule once (see the file header). `db` defaults to the service-role
 * client; `userId` limits the tick to one user (debugging from n8n).
 */
export async function runDueAutomations(
  opts: { now?: Date; limit?: number; userId?: string; origin?: string | null } = {},
  db: Client = supabaseAdmin,
): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const { appTimezone } = await import("./n8n/time.server");
  const { isDemoMode } = await import("./demo/mode.server");
  const fallbackTz = appTimezone();
  const demo = isDemoMode();
  let query = db
    .from("automations")
    .select("*")
    .eq("enabled", true)
    .not("next_run_at", "is", null)
    .lte("next_run_at", now.toISOString());
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data: due, error } = await query
    .order("next_run_at", { ascending: true })
    .limit(opts.limit ?? 100);
  if (error) throw new Error(`due rules failed: ${error.message}`);

  const result: TickResult = {
    now: now.toISOString(),
    due: due?.length ?? 0,
    ran: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };
  for (const rule of due ?? []) {
    let next: string | null;
    let invalid: string | null = null;
    try {
      next = computeNextRun(rule, now, fallbackTz);
    } catch (e) {
      next = null;
      invalid = e instanceof Error ? e.message : "cron tidak valid";
    }
    // Claim this window (compare-and-swap on the next_run_at we read).
    const { data: claimed, error: claimError } = await db
      .from("automations")
      .update({ next_run_at: next, last_run_at: now.toISOString(), run_count: rule.run_count + 1 })
      .eq("id", rule.id)
      .eq("next_run_at", rule.next_run_at!)
      .select("id");
    if (claimError) throw new Error(`claim failed: ${claimError.message}`);
    if (!claimed?.length) {
      result.skipped++;
      continue;
    }
    const userId = rule.user_id;
    const run = invalid
      ? { ok: false, log: [`gagal: ${invalid}; jadwal dihentikan`] }
      : await runScheduledActions({
          db,
          userId,
          rule,
          now,
          tz: ruleTimezone(rule, fallbackTz),
          origin: opts.origin ?? null,
          demo,
        });
    const detail = `⏰ ${rule.name} → ${run.log.join("; ") || "tanpa aksi"}`.slice(0, 500);
    await db.from("automation_runs").insert({
      user_id: userId,
      automation_id: rule.id,
      ok: run.ok,
      detail,
    });
    result.ran++;
    if (!run.ok) result.failed++;
    result.results.push({
      rule_id: rule.id,
      user_id: userId,
      ok: run.ok,
      next_run_at: next,
      detail,
    });
  }
  return result;
}

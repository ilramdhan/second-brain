// Server-side automation rule engine shared by `runAutomations` (browser, RLS client) and the
// n8n endpoints (service-role client acting for a resolved user).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables, TablesUpdate } from "@/integrations/supabase/types";
import type { Action, Condition, TaskSnapshot, Trigger } from "@/lib/automation-types";

type T = Tables<"tasks">;

function triggerMatches(
  t: Trigger,
  event: "created" | "updated",
  before: TaskSnapshot | undefined,
  task: T,
) {
  if (t.type === "task_created") return event === "created";
  if (event !== "updated" || !before) return false;
  const field = {
    status_changed: "status",
    priority_changed: "priority",
    assignee_changed: "assignee_name",
    due_changed: "due_date",
  }[t.type] as keyof TaskSnapshot;
  if (t.type === "assignee_changed") {
    if (before.assignee_name === task.assignee_name && before.assignee_id === task.assignee_id)
      return false;
    return true;
  }
  if (before[field] === undefined || before[field] === task[field]) return false;
  return !t.to || t.to === task[field];
}

function conditionMatches(c: Condition, task: T) {
  const v = c.value.trim().toLowerCase();
  if (c.field === "tag") {
    const has = (task.tags ?? []).some((x) => x.toLowerCase() === v.replace(/^#/, ""));
    return c.op === "neq" ? !has : has;
  }
  const actual = String(task[c.field] ?? "").toLowerCase();
  if (c.op === "eq") return actual === v;
  if (c.op === "neq") return actual !== v;
  return actual.includes(v);
}

function fill(tpl: string, task: T, projectName: string) {
  return tpl
    .replaceAll("{{title}}", String(task.title ?? ""))
    .replaceAll("{{status}}", String(task.status ?? ""))
    .replaceAll("{{priority}}", String(task.priority ?? ""))
    .replaceAll("{{assignee}}", String(task.assignee_name ?? "-"))
    .replaceAll("{{project}}", projectName || "-")
    .replaceAll(
      "{{due}}",
      task.due_date ? new Date(String(task.due_date)).toLocaleDateString("id-ID") : "-",
    );
}

/**
 * Minimal task payload for outgoing webhooks. Never send the full row: it contains internal
 * ids (user_id, assignee_id), descriptions and other fields third parties do not need.
 */
function webhookTask(task: T, origin: string | null) {
  let url: string | null;
  try {
    url = origin
      ? new URL(task.project_id ? `/projects/${task.project_id}` : "/tasks", origin).toString()
      : null;
  } catch {
    url = null;
  }
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    project_id: task.project_id,
    tags: task.tags ?? [],
    url,
  };
}

export type AutomationEvent = {
  event: "created" | "updated";
  taskId: string;
  before?: TaskSnapshot | undefined;
};

/**
 * Evaluates the user's enabled rules for one task event. `supabase` is either the caller's RLS
 * client (browser-triggered `runAutomations`) or the service-role client used by the n8n
 * endpoints; every query is scoped to `userId` explicitly, so both behave the same. Actions write
 * directly and never re-trigger rules.
 */
export async function runAutomationRules(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: AutomationEvent,
  origin: string | null,
): Promise<{ ran: number; changed: boolean }> {
  const { data: rules } = await supabase
    .from("automations")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (!rules?.length) return { ran: 0, changed: false };
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", data.taskId)
    .maybeSingle();
  if (!task) return { ran: 0, changed: false };
  let current: T = task;
  let projectName = "";
  if (task.project_id) {
    const { data: p } = await supabase
      .from("projects")
      .select("name")
      .eq("id", task.project_id)
      .maybeSingle();
    projectName = p?.name ?? "";
  }
  let ran = 0;
  let changed = false;
  for (const rule of rules) {
    const trigger = rule.trigger as unknown as Trigger;
    const conditions = (rule.conditions as unknown as Condition[]) ?? [];
    const actions = (rule.actions as unknown as Action[]) ?? [];
    if (!triggerMatches(trigger, data.event, data.before, current)) continue;
    if (!conditions.every((c) => conditionMatches(c, current))) continue;
    const log: string[] = [];
    let ok = true;
    for (const a of actions) {
      try {
        if (a.type === "set_field" || a.type === "add_tag" || a.type === "shift_due") {
          const patch: TablesUpdate<"tasks"> = {};
          if (a.type === "set_field") {
            patch[a.field] = a.value;
            if (a.field === "assignee_name") patch.assignee_id = null;
            if (a.field === "status")
              patch.completed_at = a.value === "done" ? new Date().toISOString() : null;
          } else if (a.type === "add_tag") {
            const tag = a.value.replace(/^#/, "").trim();
            patch.tags = [...new Set([...(current.tags ?? []), tag])];
          } else if (current.due_date) {
            patch.due_date = new Date(
              new Date(String(current.due_date)).getTime() + a.days * 86400000,
            ).toISOString();
            patch.reminded = false;
          }
          const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
          if (error) throw new Error(error.message);
          current = { ...current, ...patch } as T;
          changed = true;
          log.push(`ubah ${Object.keys(patch).join(",")}`);
        } else if (a.type === "comment") {
          const { error } = await supabase.from("task_comments").insert({
            task_id: task.id,
            user_id: userId,
            content: `🤖 ${fill(a.text, current, projectName)}`.slice(0, 2000),
          });
          if (error) throw new Error(error.message);
          changed = true;
          log.push("komentar");
        } else if (a.type === "telegram") {
          const { data: prof } = await supabase
            .from("profiles")
            .select("telegram_chat_id")
            .eq("id", userId)
            .maybeSingle();
          if (!prof?.telegram_chat_id) throw new Error("Akun Telegram belum ditautkan");
          const { sendTelegram } = await import("@/lib/telegram.server");
          const err = await sendTelegram(prof.telegram_chat_id, fill(a.text, current, projectName));
          if (err) throw new Error(err);
          log.push("telegram");
        } else if (a.type === "webhook") {
          const { safeWebhookPost } = await import("@/server/ssrf.server");
          const text = fill(
            `[${rule.name}] {{title}} — status {{status}}, prioritas {{priority}}`,
            current,
            projectName,
          );
          await safeWebhookPost(a.url, {
            text,
            content: text,
            rule: rule.name,
            event: data.event,
            project: projectName,
            task: webhookTask(current, origin),
          });
          log.push("webhook");
        }
      } catch (e) {
        ok = false;
        log.push(`gagal: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    ran++;
    await supabase.from("automation_runs").insert({
      user_id: userId,
      automation_id: rule.id,
      task_id: task.id,
      ok,
      detail: `${current.title} → ${log.join("; ")}`.slice(0, 500),
    });
    await supabase
      .from("automations")
      .update({ run_count: rule.run_count + 1, last_run_at: new Date().toISOString() })
      .eq("id", rule.id);
  }
  return { ran, changed };
}

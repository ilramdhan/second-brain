// GET /api/public/n8n/digest — builds one Telegram message per linked user. Data loading here,
// formatting in format.server.ts (pure, tested).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { buildDigest, type DigestData, type OutMessage } from "./format.server";
import type { DigestKind } from "./schemas.server";
import * as svc from "./service.server";
import { appTimezone, startOfZonedDay } from "./time.server";

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

async function countRows(
  table: "tasks" | "notes" | "inbox_items",
  apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>,
) {
  const { count } = await apply(base(table));
  return count ?? 0;
  function base(t: typeof table) {
    return supabaseAdmin.from(t).select("id", { count: "exact", head: true });
  }
}

export async function loadDigestData(
  kind: DigestKind,
  userId: string,
  now: Date,
  tz: string,
): Promise<DigestData> {
  const projects = await svc.accessibleProjectIds(userId);
  const today = startOfZonedDay(now, tz);
  const tomorrow = startOfZonedDay(now, tz, 1);
  const dayAfter = startOfZonedDay(now, tz, 2);
  const [todayTasks, overdue, tomorrowTasks, completedToday, inboxPending] = await Promise.all([
    kind === "morning"
      ? svc.listTasks(userId, { open: true, dueFrom: today, dueBefore: tomorrow }, projects)
      : Promise.resolve([]),
    svc.listTasks(
      userId,
      { open: true, dueBefore: kind === "morning" ? today : now, limit: 50 },
      projects,
    ),
    kind === "evening"
      ? svc.listTasks(userId, { open: true, dueFrom: tomorrow, dueBefore: dayAfter }, projects)
      : Promise.resolve([]),
    kind === "evening"
      ? svc.listTasks(userId, { completedFrom: today }, projects)
      : Promise.resolve([]),
    countRows("inbox_items", (q) => q.eq("user_id", userId).eq("status", "pending")),
  ]);
  const data: DigestData = {
    today: todayTasks,
    overdue,
    tomorrow: tomorrowTasks,
    completedToday,
    inboxPending,
  };
  if (kind === "weekly") {
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const scope = svc.scopeFilter(userId, projects);
    const [completed, created, newNotes, upcoming] = await Promise.all([
      countRows("tasks", (q) =>
        q
          .or(scope)
          .eq("status", "done")
          .gte("completed_at", weekAgo.toISOString())
          .is("deleted_at", null),
      ),
      countRows("tasks", (q) =>
        q.or(scope).gte("created_at", weekAgo.toISOString()).is("deleted_at", null),
      ),
      countRows("notes", (q) =>
        q.or(scope).gte("created_at", weekAgo.toISOString()).is("deleted_at", null),
      ),
      svc.listTasks(
        userId,
        { open: true, dueFrom: today, dueBefore: startOfZonedDay(now, tz, 8) },
        projects,
      ),
    ]);
    const { count: activeProjects } = await supabaseAdmin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .in("id", projects.length ? projects : ["00000000-0000-0000-0000-000000000000"])
      .eq("status", "active")
      .is("deleted_at", null);
    const focus = [...overdue, ...upcoming]
      .sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
          String(a.due_date).localeCompare(String(b.due_date)),
      )
      .slice(0, 5);
    data.week = {
      completed,
      created,
      overdue: overdue.length,
      activeProjects: activeProjects ?? 0,
      newNotes,
      focus,
    };
  }
  return data;
}

export async function buildDigests(kind: DigestKind, userId?: string) {
  const tz = appTimezone();
  const now = new Date();
  const messages: OutMessage[] = [];
  for (const { userId: uid, chatId } of await svc.linkedProfiles(userId)) {
    try {
      const digest = buildDigest(kind, await loadDigestData(kind, uid, now, tz), tz);
      if (digest) messages.push({ chat_id: chatId, parse_mode: "HTML", ...digest });
    } catch (error) {
      console.error(
        "[n8n] digest failed for a user",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { kind, count: messages.length, messages };
}

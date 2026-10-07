// Turns one free-text message into a fully filled task, server-side. Shared by the Telegram bot
// (app mode webhook and n8n mode), n8n capture and the inbox "Jadikan tugas (AI)" server function.
//
//   1. loadTaskCandidates: the user's accessible projects, their people and recent open tasks
//      (service role, every query scoped to the user like src/server/n8n/service.server.ts).
//   2. extractTaskFields: AI structured output (aiExtractTask) when AI is available and the
//      per-user AI budget allows it; otherwise, or on any AI error, the local regex parser.
//   3. resolveExtraction (taskExtract.server.ts): validates values and references.
//   4. writeExtractedTask: inserts the task, dependencies (cycle-checked with the shared rule) and
//      comments, then runs `runAutomationRules` ("created"). Semantic search picks the row up by
//      content hash on the next sync (semantic_pending), like every other server-side writer.
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Tables } from "@/integrations/supabase/types";
import { createsDependencyCycle } from "@/lib/task-rules";

import { runAutomationRules } from "./automationEngine.server";
import { accessibleProjectIds, scopeFilter } from "./n8n/service.server";
import {
  CANDIDATE_LIMITS,
  MAX_EXTRACT_INPUT,
  fallbackExtraction,
  resolveExtraction,
  type Clock,
  type ExtractedTask,
  type ResolvedTask,
  type TaskCandidates,
} from "./taskExtract.server";

type Db = SupabaseClient<Database>;

/** Loads what a message may reference, scoped to `userId` (never other users' rows). */
export async function loadTaskCandidates(userId: string, db: Db = supabaseAdmin) {
  const projectIds = await accessibleProjectIds(userId);
  const [{ data: projects }, { data: members }, { data: tasks }] = await Promise.all([
    projectIds.length
      ? db
          .from("projects")
          .select("id,name,user_id")
          .in("id", projectIds)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(CANDIDATE_LIMITS.projects)
      : Promise.resolve({ data: [] as { id: string; name: string; user_id: string }[] }),
    projectIds.length
      ? db.from("project_members").select("project_id,user_id").in("project_id", projectIds)
      : Promise.resolve({ data: [] as { project_id: string; user_id: string }[] }),
    db
      .from("tasks")
      .select("id,title")
      .or(scopeFilter(userId, projectIds))
      .neq("status", "done")
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(CANDIDATE_LIMITS.tasks),
  ]);
  const people = [
    ...(projects ?? []).map((p) => ({ project_id: p.id, user_id: p.user_id })),
    ...(members ?? []),
  ];
  const ids = [...new Set(people.map((p) => p.user_id))];
  const { data: profiles } = ids.length
    ? await db.from("profiles").select("id,display_name").in("id", ids)
    : { data: [] as { id: string; display_name: string | null }[] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.display_name?.trim() ?? ""]));
  const seen = new Set<string>();
  const candidates: TaskCandidates = {
    projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name })),
    // Only people with a display name can be referenced by name (emails never reach the model).
    members: people.flatMap((p) => {
      const name = nameOf.get(p.user_id);
      const key = `${p.project_id}:${p.user_id}`;
      if (!name || seen.has(key)) return [];
      seen.add(key);
      return [{ project_id: p.project_id, user_id: p.user_id, name }];
    }),
    tasks: tasks ?? [],
  };
  return candidates;
}

export type ExtractVia = "ai" | "regex";

export type ExtractDeps = {
  /** Throws when AI cannot run (assertAiAvailable). */
  assertAi: () => Promise<void>;
  /** Spends one unit of the user's AI budget; false when exhausted or the limiter failed. */
  consume: () => Promise<boolean>;
  ai: (text: string, candidates: TaskCandidates, clock: Clock) => Promise<ExtractedTask>;
};

/**
 * AI extraction with the regex fallback: AI not configured, budget exhausted or any AI error
 * (timeout, invalid JSON, provider down) → `fallbackExtraction`. Never throws for AI reasons.
 */
export async function extractTaskFields(
  text: string,
  candidates: TaskCandidates,
  clock: Clock,
  deps: ExtractDeps,
): Promise<{ extraction: ExtractedTask; via: ExtractVia; reason?: string }> {
  const input = text.slice(0, MAX_EXTRACT_INPUT);
  const fallback = (reason: string) => ({
    extraction: fallbackExtraction(input, clock),
    via: "regex" as const,
    reason,
  });
  try {
    await deps.assertAi();
  } catch {
    return fallback("ai_not_configured");
  }
  if (!(await deps.consume().catch(() => false))) return fallback("rate_limited");
  try {
    return { extraction: await deps.ai(input, candidates, clock), via: "ai" };
  } catch (error) {
    console.error(
      "[capture] AI task extraction failed",
      error instanceof Error ? error.message : error,
    );
    return fallback("ai_failed");
  }
}

/** Default deps for server-side callers without a user JWT (bot, n8n): service-role limiter. */
export function serviceExtractDeps(userId: string, request: Request): ExtractDeps {
  return {
    assertAi: async () => {
      const { assertAiAvailable } = await import("@/lib/ai.server");
      await assertAiAvailable();
    },
    consume: async () => {
      const { AI_RATE_LIMIT } = await import("./rateLimit.server");
      const { data, error } = await supabaseAdmin.rpc("consume_rate_limit_for", {
        _user_id: userId,
        _bucket: AI_RATE_LIMIT.bucket,
        _max: AI_RATE_LIMIT.max,
        _window_seconds: AI_RATE_LIMIT.windowSeconds,
      });
      return !error && data === true;
    },
    ai: async (text, candidates, clock) => {
      const { aiExtractTask } = await import("@/lib/ai.server");
      return aiExtractTask(request, text, candidates, clock);
    },
  };
}

export type WrittenTask = {
  task: Tables<"tasks">;
  dependencies: number;
  comments: number;
};

/**
 * Inserts the resolved task as `userId` through `db` (the caller's RLS client in server functions,
 * the service role for bot/n8n), then its dependencies and comments, then runs the automation
 * rules for "created". Dependencies that would close a cycle are skipped (same rule as
 * useDependencyActions); dependency/comment failures never undo the task.
 */
export async function writeExtractedTask(
  db: Db,
  userId: string,
  resolved: ResolvedTask,
  origin: string | null,
): Promise<WrittenTask> {
  const { data: task, error } = await db
    .from("tasks")
    .insert({ ...resolved.insert, user_id: userId })
    .select("*")
    .single();
  if (error || !task) throw new Error(`task insert failed: ${error?.message}`);

  let dependencies = 0;
  for (const blocker of resolved.dependsOn) {
    const cycle = await createsDependencyCycle(blocker.id, task.id, async (ids) => {
      const { data } = await db
        .from("task_dependencies")
        .select("blocked_id")
        .in("blocker_id", ids)
        .limit(500);
      return (data ?? []).map((d) => d.blocked_id);
    });
    if (cycle) continue;
    const { error: depError } = await db
      .from("task_dependencies")
      .insert({ blocker_id: blocker.id, blocked_id: task.id, user_id: userId });
    if (depError) console.error("[capture] dependency insert failed", depError.message);
    else dependencies++;
  }

  let comments = 0;
  if (resolved.comments.length) {
    const { error: commentError } = await db
      .from("task_comments")
      .insert(resolved.comments.map((content) => ({ task_id: task.id, user_id: userId, content })));
    if (commentError) console.error("[capture] comment insert failed", commentError.message);
    else comments = resolved.comments.length;
  }

  await runAutomationRules(db, userId, { event: "created", taskId: task.id }, origin).catch((e) =>
    console.error("[capture] automations failed", e),
  );
  return { task, dependencies, comments };
}

/** Full pipeline for bot/n8n callers (service role, scoped to `userId`). */
export async function captureTaskFromText(
  userId: string,
  text: string,
  opts: {
    clock: Clock;
    origin: string | null;
    request?: Request;
    deps?: ExtractDeps;
    /** Extra description appended (e.g. "Dibuat dari Telegram (voice)"). */
    note?: string | null;
    /** Explicit values from the caller (n8n capture fields) applied after validation. */
    adjust?: (resolved: ResolvedTask, candidates: TaskCandidates) => void;
  },
) {
  const candidates = await loadTaskCandidates(userId);
  const request = opts.request ?? new Request("https://capture.internal/task");
  const { extraction, via } = await extractTaskFields(
    text,
    candidates,
    opts.clock,
    opts.deps ?? serviceExtractDeps(userId, request),
  );
  const resolved = resolveExtraction(extraction, candidates, opts.clock, text);
  opts.adjust?.(resolved, candidates);
  if (opts.note)
    resolved.insert.description = [resolved.insert.description, opts.note]
      .filter(Boolean)
      .join("\n\n");
  const written = await writeExtractedTask(supabaseAdmin, userId, resolved, opts.origin);
  return { ...written, resolved, via };
}

// POST /api/public/n8n/maintenance — housekeeping that Supabase Free / Vercel Hobby cannot
// schedule themselves (no pg_cron guarantee, one Vercel cron per day): purge old trash, expired
// Telegram link codes, stale rate-limit windows and old idempotency keys. `semantic_index`
// (opt-in) embeds tasks/notes whose semantic search embedding is missing or outdated, for every
// user (service role), so the index catches up even for rows written by n8n or other devices.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import type { z } from "zod";
import type { maintenanceSchema } from "./schemas.server";

const DAY = 86_400_000;

async function purge(
  table: "tasks" | "notes" | "projects" | "habits",
  cutoff: string,
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .delete()
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .select("id");
  if (error) throw new Error(`purge ${table} failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function runMaintenance(input: z.infer<typeof maintenanceSchema>, now = new Date()) {
  const result: {
    ok: true;
    purged?: { tasks: number; notes: number; projects: number; habits: number };
    link_codes_deleted?: number;
    rate_limits_deleted?: number;
    n8n_events_deleted?: number;
    recurring_created?: number;
    semantic?: { embedded: number; remaining: number; model: string } | { skipped: string };
  } = { ok: true };
  const tasks = new Set(input.tasks);

  if (tasks.has("purge_trash")) {
    const cutoff = new Date(now.getTime() - input.purge_after_days * DAY).toISOString();
    // Tasks and notes before projects (project rows cascade to their milestones).
    const t = await purge("tasks", cutoff);
    const n = await purge("notes", cutoff);
    const p = await purge("projects", cutoff);
    const h = await purge("habits", cutoff); // check-ins cascade
    result.purged = { tasks: t, notes: n, projects: p, habits: h };
  }
  if (tasks.has("link_codes")) {
    const cutoff = new Date(now.getTime() - DAY).toISOString();
    const { data, error } = await supabaseAdmin
      .from("telegram_link_codes")
      .delete()
      .or(`expires_at.lt.${now.toISOString()},used_at.lt.${cutoff}`)
      .select("id");
    if (error) throw new Error(`link codes cleanup failed: ${error.message}`);
    result.link_codes_deleted = data?.length ?? 0;
  }
  if (tasks.has("rate_limits")) {
    // The longest allowed window is 24 h (consume_rate_limit), so older rows are dead.
    const { data, error } = await supabaseAdmin
      .from("rate_limits")
      .delete()
      .lt("window_start", new Date(now.getTime() - DAY).toISOString())
      .select("user_id");
    if (error) throw new Error(`rate limits cleanup failed: ${error.message}`);
    result.rate_limits_deleted = data?.length ?? 0;
  }
  if (tasks.has("n8n_events")) {
    const { data, error } = await supabaseAdmin
      .from("n8n_events")
      .delete()
      .lt("created_at", new Date(now.getTime() - input.events_after_days * DAY).toISOString())
      .select("source");
    if (error) throw new Error(`n8n events cleanup failed: ${error.message}`);
    result.n8n_events_deleted = data?.length ?? 0;
  }
  // The next instance of a recurring task is created when it is completed (useTaskActions /
  // completeTask), so there is nothing to backfill; accepted for older workflow versions.
  if (tasks.has("recurring")) result.recurring_created = 0;
  if (tasks.has("semantic_index")) {
    const { AiNotConfiguredError } = await import("@/lib/ai.server");
    const { syncSemanticIndex } = await import("@/server/semantic.server");
    try {
      result.semantic = await syncSemanticIndex(supabaseAdmin, { batches: input.semantic_batches });
    } catch (error) {
      // No AI configured is not a maintenance failure: the other tasks still succeeded.
      if (!(error instanceof AiNotConfiguredError)) throw error;
      result.semantic = { skipped: "ai_not_configured" };
    }
  }
  return result;
}

/**
 * Shared, pure helpers around the task-rule RPCs from migration 0017 (`complete_task`,
 * `shift_task_dependents`). Used by `useTaskActions` (browser) and the n8n service so both
 * callers interpret the database result the same way. No Supabase or React imports.
 */
import type { Json, Tables } from "@/integrations/supabase/types";

type TaskRow = Tables<"tasks">;

export type CompleteTaskOutcome =
  | {
      status: "ok";
      task: TaskRow;
      recurring: TaskRow | null;
      unblocked: { id: string; title: string }[];
    }
  | { status: "blocked"; blocker: string }
  | { status: "already_done"; task: TaskRow };

/** Narrows the jsonb returned by `complete_task`. Throws on an unexpected shape. */
export function parseCompleteResult(raw: Json | null): CompleteTaskOutcome {
  const r = (raw ?? {}) as {
    status?: unknown;
    blocker?: unknown;
    task?: unknown;
    recurring?: unknown;
    unblocked?: unknown;
  };
  if (r.status === "blocked") return { status: "blocked", blocker: String(r.blocker ?? "") };
  if (r.status === "already_done") return { status: "already_done", task: r.task as TaskRow };
  if (r.status === "ok" && r.task && typeof r.task === "object") {
    return {
      status: "ok",
      task: r.task as TaskRow,
      recurring: (r.recurring as TaskRow | null) ?? null,
      unblocked: Array.isArray(r.unblocked) ? (r.unblocked as { id: string; title: string }[]) : [],
    };
  }
  throw new Error("complete_task returned an unexpected result");
}

/**
 * Milliseconds a deadline moved later, or 0. Dependents are only auto-shifted when a blocker's
 * existing due date is pushed later.
 */
export function dueShiftMs(before: string | null | undefined, after: string | null | undefined) {
  if (!before || !after) return 0;
  const delta = new Date(after).getTime() - new Date(before).getTime();
  return Number.isFinite(delta) && delta > 0 ? delta : 0;
}

/** Copy of `row` with only the comma-separated `cols` (e.g. `TASK_COLS`) that are present. */
export function pickColumns<T extends object>(row: T, cols: string): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const c of cols.split(",")) if (c in row) out[c] = (row as Record<string, unknown>)[c];
  return out as Partial<T>;
}

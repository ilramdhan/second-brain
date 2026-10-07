import { queryOptions } from "@tanstack/react-query";

import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";
import type { DailyRow } from "@/lib/reports";

export type ReportParams = {
  from: string;
  to: string;
  /** IANA zone the days are cut in (the browser's, like `complete_task`). */
  tz: string;
  projectId?: string | null;
  milestoneId?: string | null;
};

/**
 * Daily aggregates from `report_daily` (migration 0026, SECURITY INVOKER: only rows RLS lets the
 * caller see). The key includes every parameter, and `qk.reports` is invalidated after task
 * writes elsewhere only by staleness (one minute), since reports never need to be instant.
 */
export const reportDailyQuery = (p: ReportParams) =>
  queryOptions({
    queryKey: [
      ...qk.reports,
      "daily",
      p.from,
      p.to,
      p.tz,
      p.projectId ?? null,
      p.milestoneId ?? null,
    ],
    staleTime: 60_000,
    queryFn: async (): Promise<DailyRow[]> => {
      const { data, error } = await supabase.rpc("report_daily", {
        _from: p.from,
        _to: p.to,
        _tz: p.tz,
        ...(p.projectId ? { _project_id: p.projectId } : {}),
        ...(p.milestoneId ? { _milestone_id: p.milestoneId } : {}),
      });
      if (error) throw error;
      return data;
    },
  });

/** Local midnight of a `YYYY-MM-DD` day in the browser's zone, as an ISO instant. */
const localStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();

/**
 * Focus-timer entries started in [from, to] (local days), for the per-project and per-task
 * breakdown. Own rows only (time_entries RLS); breaks are dropped by the caller.
 */
export const timeEntriesQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: [...qk.reports, "time-entries", from, to],
    staleTime: 60_000,
    queryFn: async () => {
      const end = new Date(`${to}T00:00:00`);
      end.setDate(end.getDate() + 1);
      const { data, error } = await supabase
        .from("time_entries")
        .select("id,task_id,project_id,duration_seconds,started_at,mode")
        .gte("started_at", localStart(from))
        .lt("started_at", end.toISOString())
        .limit(5000);
      if (error) throw error;
      return data;
    },
  });

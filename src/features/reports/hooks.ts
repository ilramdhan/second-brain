import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { reportDailyQuery, timeEntriesQuery, type ReportParams } from "@/features/reports/api";

/** Daily report rows; keeps the previous range on screen while a new one loads. */
export function useReportDaily(params: ReportParams) {
  return useQuery({ ...reportDailyQuery(params), placeholderData: keepPreviousData });
}

/** Focus-timer entries of a range (per-project / per-task breakdown). */
export function useTimeEntries(from: string, to: string) {
  return useQuery({ ...timeEntriesQuery(from, to), placeholderData: keepPreviousData });
}

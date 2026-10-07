import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

import type { ChartPoint } from "@/components/charts/types";
import { addDays, type Bucket, type BucketMode, type BurndownPoint } from "@/lib/reports";

/** `YYYY-MM-DD` → a local Date at noon (for formatting only). */
export const asDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
};
const fmt = (iso: string, pattern: string) => format(asDate(iso), pattern, { locale: localeId });

/** Axis and tooltip labels for one bucket (a day, or an ISO week clipped to the range). */
export function bucketLabels(b: Bucket, mode: BucketMode, total: number) {
  if (mode === "week") {
    const end = addDays(b.start, 6);
    return {
      label: fmt(b.start, "d/M"),
      long: `Minggu ${fmt(b.start, "d MMM")} – ${fmt(end, "d MMM yyyy")}`,
    };
  }
  return {
    label: total <= 7 ? fmt(b.start, "EEEEEE") : fmt(b.start, "d/M"),
    long: fmt(b.start, "EEEE, d MMM yyyy"),
  };
}

export function bucketPoints(
  buckets: readonly Bucket[],
  mode: BucketMode,
  values: (b: Bucket) => Record<string, number | null>,
): ChartPoint[] {
  return buckets.map((b) => ({
    key: b.start,
    ...bucketLabels(b, mode, buckets.length),
    values: values(b),
  }));
}

export function burndownPoints(points: readonly BurndownPoint[]): ChartPoint[] {
  return points.map((p) => ({
    key: p.day,
    label: fmt(p.day, "d/M"),
    long: fmt(p.day, "EEEE, d MMM yyyy"),
    values: { remaining: p.remaining, ideal: p.ideal },
  }));
}

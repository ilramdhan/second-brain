/** One series of a chart. `tone` picks a token from styles.css (chart-1/2 validated as a pair). */
export type ChartSeries = {
  key: string;
  label: string;
  tone: "chart-1" | "chart-2" | "muted";
  /** Line charts: draw dashed (a projection such as the ideal burndown line). */
  dashed?: boolean;
};

/** One x position: a short axis label, a long tooltip/table label and a value per series. */
export type ChartPoint = {
  key: string;
  label: string;
  long: string;
  values: Record<string, number | null>;
};

export const TONE_BG: Record<ChartSeries["tone"], string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  muted: "bg-muted-foreground",
};
export const TONE_STROKE: Record<ChartSeries["tone"], string> = {
  "chart-1": "stroke-chart-1",
  "chart-2": "stroke-chart-2",
  muted: "stroke-muted-foreground",
};

/** Show at most ~`max` x labels: every n-th, always the last. */
export function labelStep(count: number, max = 8) {
  return Math.max(1, Math.ceil(count / max));
}

/** Indexes that get an x label: every `step`-th, plus the last one unless it would crowd the previous. */
export function labelIndexes(count: number, max = 8) {
  const step = labelStep(count, max);
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  const last = count - 1;
  if (count > 0 && out.at(-1) !== last) {
    if (last - out.at(-1)! < step / 2) out.pop();
    out.push(last);
  }
  return out;
}

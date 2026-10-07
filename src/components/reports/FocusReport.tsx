import { format } from "date-fns";
import { Timer } from "lucide-react";

import { color } from "@/lib/constants";
import { tr, useI18n } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/*
 * Weekly focus report body (/reports). Mobile first: every grid declares `grid-cols-1`, so on
 * phones the single track is `1fr` (minmax(auto, 1fr)) instead of an implicit `auto` column that
 * grows to the longest truncated project/task title and pushes the cards off-screen. Text uses
 * text tokens; the bars carry no text colour of their own.
 */

/** "3 j 45 m" / "25 m". */
export function formatFocus(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  const mu = tr("admMinuteUnit");
  return h ? `${h} ${tr("admHourUnit")} ${m} ${mu}` : `${m} ${mu}`;
}

export type FocusDay = { d: Date; sec: number };
export type FocusRow = {
  id: string;
  label: string;
  sec: number;
  /** Project colour key (constants `COLORS`), for the identity dot. */
  color?: string | undefined;
  /** Extra text after the duration, e.g. " / est. 30 m". */
  suffix?: string | undefined;
};

const CARD = "min-w-0 rounded-2xl border bg-card p-4 sm:p-5";

export function FocusSummary({
  total,
  sessions,
  days,
}: {
  total: number;
  sessions: number;
  days: FocusDay[];
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <section className={CARD} aria-labelledby="focus-total">
        <h2 id="focus-total" className="text-xs text-muted-foreground">
          {t("admFocusTotal")}
        </h2>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatFocus(total)}</p>
        <p className="text-xs text-muted-foreground">{t("admSessions", { n: sessions })}</p>
      </section>
      <DailyChart days={days} />
    </div>
  );
}

/**
 * Focus time per weekday: one series in one hue, bars stretch with the card, the busiest day is
 * labelled and each column has a tooltip. A visually hidden table gives the exact values to
 * screen readers (the drawing itself is `aria-hidden`).
 */
export function DailyChart({ days }: { days: FocusDay[] }) {
  const { t, dateFns } = useI18n();
  const max = Math.max(1, ...days.map((x) => x.sec));
  const peak = Math.max(0, ...days.map((x) => x.sec));
  return (
    <section className={cn(CARD, "lg:col-span-2")} aria-labelledby="focus-daily">
      <h2 id="focus-daily" className="mb-3 text-xs text-muted-foreground">
        {t("admPerDayTitle")}
      </h2>
      <div className="flex h-36 items-end gap-1.5 sm:gap-2" aria-hidden data-testid="focus-bars">
        {days.map(({ d, sec }) => (
          <div
            key={d.toISOString()}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={`${format(d, "EEEE", { locale: dateFns })}: ${formatFocus(sec)}`}
          >
            {sec > 0 && sec === peak && (
              <span className="text-[10px] font-medium whitespace-nowrap text-foreground tabular-nums">
                {formatFocus(sec)}
              </span>
            )}
            <div
              className="w-full max-w-12 rounded-t bg-primary/80"
              style={{ height: `${(sec / max) * 100}px`, minHeight: sec ? 4 : 0 }}
            />
            <span className="text-[11px] text-muted-foreground capitalize">
              {format(d, "EEEEEE", { locale: dateFns })}
            </span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t("admFocusPerDay")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("admDay")}</th>
            <th scope="col">{t("admFocus")}</th>
          </tr>
        </thead>
        <tbody>
          {days.map(({ d, sec }) => (
            <tr key={d.toISOString()}>
              <th scope="row">{format(d, "EEEE d MMM", { locale: dateFns })}</th>
              <td>{formatFocus(sec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function FocusEmpty() {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground sm:p-8">
      <Timer className="mx-auto mb-2 h-6 w-6" aria-hidden />
      {t("admFocusEmpty")}
    </div>
  );
}

export function FocusBreakdown({
  total,
  byProject,
  byTask,
}: {
  total: number;
  byProject: FocusRow[];
  byTask: FocusRow[];
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className={CARD} aria-labelledby="focus-projects">
        <h2 id="focus-projects" className="mb-3 font-semibold">
          {t("admPerProject")}
        </h2>
        <ul className="space-y-3">
          {byProject.map((row) => {
            const pct = total ? Math.round((row.sec / total) * 100) : 0;
            return (
              <li key={row.id} className="min-w-0">
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    {row.color && (
                      <span
                        className={cn("h-2 w-2 shrink-0 rounded-full", color(row.color).dot)}
                        aria-hidden
                      />
                    )}
                    <span className="truncate">{row.label}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatFocus(row.sec)} · {pct}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary" aria-hidden>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section className={CARD} aria-labelledby="focus-tasks">
        <h2 id="focus-tasks" className="mb-3 font-semibold">
          {t("admTopTasks")}
        </h2>
        <ul className="divide-y">
          {byTask.map((row) => (
            <li
              key={row.id}
              className="flex min-w-0 flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
            >
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:text-sm">
                {formatFocus(row.sec)}
                {row.suffix ?? ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

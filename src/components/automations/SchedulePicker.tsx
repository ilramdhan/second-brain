import { useMemo } from "react";

import { Field } from "@/components/common/TagInput";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/ui/date-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CronError,
  cronErrorText,
  cronToPreset,
  describeCron,
  nextRuns,
  presetToCron,
  weekdayNames,
  type SchedulePreset,
} from "@/lib/cron";
import { useI18n } from "@/lib/preferences";

/** Time zones offered in the picker (the deployment default comes first). */
const ZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Amsterdam",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];
export const DEFAULT_ZONE = "Asia/Jakarta";
const pad = (n: number) => String(n).padStart(2, "0");

type Props = {
  cron: string;
  tz: string;
  onChange: (cron: string, tz: string) => void;
};

/**
 * Schedule editor for `schedule` rules: presets (daily / weekly / monthly at HH:MM) or a custom
 * 5-field cron, with a readable description and the next three run times. The same parser
 * (src/lib/cron.ts) validates the cron again on the server when the rule is saved.
 */
export function SchedulePicker({ cron, tz, onChange }: Props) {
  const { t, locale, intl } = useI18n();
  const preset = cronToPreset(cron);
  const zones = ZONES.includes(tz) ? ZONES : [tz, ...ZONES];
  const preview = useMemo(() => {
    try {
      const runs = nextRuns(cron, tz, new Date(), 3);
      return { runs, error: null };
    } catch (e) {
      return {
        runs: [],
        error: e instanceof CronError ? cronErrorText(e, locale) : t("autoCronInvalid"),
      };
    }
  }, [cron, tz, t, locale]);
  const fmt = new Intl.DateTimeFormat(intl, {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const set = (p: SchedulePreset) => onChange(presetToCron(p), tz);
  const time = preset.kind === "custom" ? null : `${pad(preset.hour)}:${pad(preset.minute)}`;
  const withTime = (value: string) => {
    if (preset.kind === "custom") return;
    const [h = "0", m = "0"] = value.split(":");
    set({ ...preset, hour: Number(h) || 0, minute: Number(m) || 0 });
  };

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t("autoRepeat")}>
          <Select
            value={preset.kind}
            onValueChange={(v) => {
              const base = preset.kind === "custom" ? { hour: 8, minute: 0 } : preset;
              if (v === "daily") set({ kind: "daily", hour: base.hour, minute: base.minute });
              else if (v === "weekly")
                set({ kind: "weekly", hour: base.hour, minute: base.minute, day: 1 });
              else if (v === "monthly")
                set({ kind: "monthly", hour: base.hour, minute: base.minute, date: 1 });
              // Custom keeps the current expression; a preset-shaped one would read back as that
              // preset, so start from a weekday example instead.
              else onChange(preset.kind === "custom" ? cron : "0 8 * * 1-5", tz);
            }}
          >
            <SelectTrigger className="h-9" aria-label={t("autoRepeat")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">{t("autoEveryDay")}</SelectItem>
              <SelectItem value="weekly">{t("autoEveryWeek")}</SelectItem>
              <SelectItem value="monthly">{t("autoEveryMonth")}</SelectItem>
              <SelectItem value="custom">{t("autoCustomCron")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("autoTimeZone")}>
          <Select value={tz} onValueChange={(v) => onChange(cron, v)}>
            <SelectTrigger className="h-9" aria-label={t("autoTimeZone")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zones.map((z) => (
                <SelectItem key={z} value={z}>
                  {z}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {preset.kind === "custom" ? (
        <Field label={t("autoCronExpr")}>
          <Input
            className="h-9 font-mono"
            value={cron}
            maxLength={120}
            onChange={(e) => onChange(e.target.value, tz)}
            placeholder="0 8 * * 1-5"
            spellCheck={false}
          />
        </Field>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {preset.kind === "weekly" && (
            <Field label={t("autoDay")}>
              <Select
                value={String(preset.day)}
                onValueChange={(v) => set({ ...preset, day: Number(v) })}
              >
                <SelectTrigger className="h-9" aria-label={t("autoDay")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekdayNames(locale).map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {preset.kind === "monthly" && (
            <Field label={t("autoMonthDay")}>
              <Input
                className="h-9"
                type="number"
                min={1}
                max={31}
                value={preset.date}
                onChange={(e) =>
                  set({ ...preset, date: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
                }
              />
            </Field>
          )}
          <Field label={t("autoHour")}>
            <TimeInput value={time ?? "08:00"} onChange={(e) => withTime(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="text-xs" aria-live="polite">
        {preview.error ? (
          <p className="text-destructive">{describeCron(cron, locale)}</p>
        ) : (
          <>
            <p className="font-medium">{describeCron(cron, locale)}</p>
            {preview.runs.length ? (
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {preview.runs.map((r) => (
                  <li key={r.toISOString()}>→ {fmt.format(r)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-destructive">{t("autoNeverRuns")}</p>
            )}
          </>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">{t("autoSchedulerNote")}</p>
      </div>
    </div>
  );
}

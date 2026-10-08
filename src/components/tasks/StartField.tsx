import { useId } from "react";

import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/**
 * Task start: one full-width field plus a small "Pakai jam" / "Use time" switch. On: a
 * `datetime-local` field; off: a date field (all day). The editor keeps its own model (`date` as
 * yyyy-MM-dd and `time` as HH:mm); this component only joins and splits them, so switching the
 * toggle never loses the date or the last chosen time.
 */
export function StartField({
  date,
  time,
  useTime,
  onDateChange,
  onTimeChange,
  onUseTimeChange,
  className,
}: {
  date: string;
  time: string;
  useTime: boolean;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
  onUseTimeChange: (useTime: boolean) => void;
  className?: string | undefined;
}) {
  const { t } = useI18n();
  const id = useId();
  const switchId = `${id}-time`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {t("taskFieldStart")}
        </label>
        <span className="flex items-center gap-2">
          <label htmlFor={switchId} className="text-xs text-muted-foreground">
            {t("taskUseTime")}
          </label>
          <Switch id={switchId} checked={useTime} onCheckedChange={onUseTimeChange} />
        </span>
      </div>
      {useTime ? (
        <DateTimeInput
          id={id}
          value={date ? `${date}T${time}` : ""}
          onChange={(e) => {
            const [d = "", hm] = e.target.value.split("T");
            onDateChange(d);
            if (hm) onTimeChange(hm.slice(0, 5));
          }}
        />
      ) : (
        <DateInput id={id} value={date} onChange={(e) => onDateChange(e.target.value)} />
      )}
    </div>
  );
}

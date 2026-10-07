import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarDays, Flag, FolderKanban, Hash, Repeat, User, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { priorityOf, RECURRENCE, labelOf } from "@/lib/constants";
import { useProjects, useTaskActions } from "@/lib/data";
import { parseTaskText } from "@/lib/nlp";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/preferences";
import { enumLabel } from "@/components/tasks/labels";

export function QuickTask({
  onDone,
  projectId,
}: {
  onDone?: () => void;
  projectId?: string | null | undefined;
}) {
  const [text, setText] = useState("");
  const { data: projects = [] } = useProjects();
  const { create } = useTaskActions();
  const { t, dateFns } = useI18n();
  const parsed = useMemo(() => parseTaskText(text), [text]);
  const project = parsed.project
    ? projects.find(
        (p) =>
          p.name.toLowerCase().startsWith(parsed.project!.toLowerCase()) ||
          p.name.toLowerCase().replace(/\s+/g, "") ===
            parsed.project!.toLowerCase().replace(/\s+/g, ""),
      )
    : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const row = await create({
      title: parsed.title.slice(0, 300),
      due_date: parsed.due?.toISOString() ?? null,
      tags: parsed.tags,
      assignee_name: parsed.assignee,
      priority: parsed.priority ?? "medium",
      project_id: project?.id ?? projectId ?? null,
      recurrence: parsed.recurrence,
    });
    if (row) {
      toast.success(t("taskQuickCreated", { title: row.title }));
      setText("");
      onDone?.();
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2">
        <Input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("taskQuickPlaceholder")}
          className="h-11"
          aria-label={t("taskQuickLabel")}
        />
        <Button type="submit" className="h-11" disabled={!text.trim()}>
          <Zap /> {t("taskQuickCreate")}
        </Button>
      </div>
      {text.trim() && (
        <div className="space-y-1.5 rounded-xl border bg-secondary/30 p-3">
          <p className="text-sm font-medium">{parsed.title}</p>
          <div className="flex flex-wrap gap-1.5">
            {parsed.due && (
              <Chip icon={CalendarDays}>
                {format(parsed.due, parsed.hasTime ? "EEE d MMM, HH:mm" : "EEE d MMM", {
                  locale: dateFns,
                })}
              </Chip>
            )}
            {parsed.priority && (
              <Chip icon={Flag} className={priorityOf(parsed.priority).className}>
                {enumLabel(t, "priority", parsed.priority, priorityOf(parsed.priority).label)}
              </Chip>
            )}
            {parsed.tags.map((tag) => (
              <Chip key={tag} icon={Hash}>
                {tag}
              </Chip>
            ))}
            {parsed.assignee && <Chip icon={User}>{parsed.assignee}</Chip>}
            {parsed.project && (
              <Chip icon={FolderKanban} className={project ? "" : "line-through opacity-60"}>
                {project?.name ?? parsed.project}
              </Chip>
            )}
            {parsed.recurrence && (
              <Chip icon={Repeat}>
                {enumLabel(
                  t,
                  "recurrence",
                  parsed.recurrence,
                  labelOf(RECURRENCE, parsed.recurrence),
                )}
              </Chip>
            )}
          </div>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("taskQuickHintPrefix")} <b>besok, lusa, senin, 12 okt, 12/10, jam 10 pagi, 14:30</b> ·{" "}
        <b>#tag</b> · <b>@orang</b> · <b>+proyek</b> · <b>!tinggi / !1</b> · <b>setiap minggu</b>.{" "}
        {t("taskQuickHintPressPrefix")} <kbd className="rounded border px-1">Q</kbd>{" "}
        {t("taskQuickHintPressSuffix")}
      </p>
    </form>
  );
}

function Chip({
  icon: Icon,
  children,
  className,
}: {
  icon: typeof Hash;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

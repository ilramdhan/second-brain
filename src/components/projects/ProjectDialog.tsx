import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FillFromText } from "@/components/common/FillFromText";
import { Field } from "@/components/common/TagInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fieldLabels, PROJECT_FIELD_LABEL } from "@/lib/capture-fields";
import { COLORS, PARA, PROJECT_STATUS } from "@/lib/constants";
import { DEMO_PROJECT_PREFILL_EXAMPLES } from "@/lib/demo-examples";
import { draftProjectFromText } from "@/lib/prefill.functions";
import { useProjectActions, useProjects, type Project } from "@/lib/data";
import { useI18n } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { optionLabel } from "@/lib/option-labels";
import { useConfirm } from "@/components/common/confirm-context";

const NONE = "none";

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  defaults,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project?: Project | null | undefined;
  defaults?: Partial<Project> | undefined;
  onDeleted?: (() => void) | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {open && (
          <ProjectForm
            key={project?.id ?? "new"}
            project={project ?? undefined}
            defaults={defaults}
            onClose={() => onOpenChange(false)}
            onDeleted={onDeleted}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  project,
  defaults,
  onClose,
  onDeleted,
}: {
  project?: Project | undefined;
  defaults?: Partial<Project> | undefined;
  onClose: () => void;
  onDeleted?: (() => void) | undefined;
}) {
  const { data: projects = [] } = useProjects();
  const actions = useProjectActions();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [para, setPara] = useState(project?.para_type ?? defaults?.para_type ?? "project");
  const [status, setStatus] = useState(project?.status ?? defaults?.status ?? "active");
  const [col, setCol] = useState(project?.color ?? "teal");
  const [parent, setParent] = useState(project?.parent_id ?? defaults?.parent_id ?? NONE);
  const [start, setStart] = useState(project?.start_date ?? "");
  const [due, setDue] = useState(project?.due_date ?? "");
  const [launch, setLaunch] = useState(project?.launch_date ?? "");
  const draftProject = useServerFn(draftProjectFromText);
  const { t } = useI18n();
  const confirm = useConfirm();

  async function save() {
    if (!name.trim()) {
      toast.error(t("wsProjectNameRequired"));
      return;
    }
    const payload = {
      name: name.trim().slice(0, 120),
      description: description.trim() || null,
      para_type: para,
      status,
      color: col,
      parent_id: parent === NONE ? null : parent,
      start_date: start || null,
      due_date: due || null,
      launch_date: launch || null,
    };
    if (project) await actions.update(project.id, payload);
    else await actions.create(payload);
    toast.success(project ? t("wsProjectSaved") : t("wsProjectCreated"));
    onClose();
  }

  async function remove() {
    if (
      !project ||
      !(await confirm({
        title: t("wsProjectDeleteConfirmTitle"),
        description: t("wsProjectDeleteConfirmDesc", { name: project.name }),
        destructive: true,
      }))
    )
      return;
    await actions.remove(project.id);
    toast.success(t("wsProjectDeleted"));
    onClose();
    onDeleted?.();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{project ? t("wsEditProject") : t("wsNewProject")}</DialogTitle>
        <DialogDescription>{t("wsProjectDialogDescription")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {!project && (
          <FillFromText
            examples={DEMO_PROJECT_PREFILL_EXAMPLES}
            placeholder={t("wsProjectFillPlaceholder")}
            labels={fieldLabels(t, PROJECT_FIELD_LABEL)}
            onFill={(text) => draftProject({ data: { text } })}
            onApply={({ draft: d }) => {
              setName(d.name);
              setDescription(d.description ?? "");
              setPara(d.para_type);
              setStatus(d.status);
              setCol(d.color);
              setParent(d.parent_id ?? defaults?.parent_id ?? NONE);
              setStart(d.start_date ?? "");
              setDue(d.due_date ?? "");
              setLaunch(d.launch_date ?? "");
            }}
            // Members are suggestions only: inviting stays an explicit owner action.
            extraSummary={(r) =>
              r.members.length ? [t("wsProjectInviteHint", { names: r.members.join(", ") })] : []
            }
          />
        )}
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("wsProjectNamePlaceholder")}
          aria-label={t("wsProjectName")}
          className="h-11 text-base font-medium"
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("wsProjectDescPlaceholder")}
          aria-label={t("wsDescription")}
          rows={3}
          className="min-h-24"
        />
        {/* One column on phones so selects and date pickers never collapse. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("wsProjectPara")}>
            <Select value={para} onValueChange={setPara}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARA.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {optionLabel(t, "para", p.id, p.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("wsStatus")}>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {optionLabel(t, "projectStatus", p.id, p.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("wsProjectParent")} className="sm:col-span-2">
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("wsProjectNoParent")}</SelectItem>
                {projects
                  .filter((p) => p.id !== project?.id)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("wsStart")}>
            <DateInput value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t("wsDue")}>
            <DateInput value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label={t("wsLaunchDate")}>
            <DateInput value={launch} onChange={(e) => setLaunch(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("wsColor")}</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(COLORS).map(([k, c]) => (
              // eslint-disable-next-line no-restricted-syntax -- exception: colour swatch
              <button
                key={k}
                type="button"
                onClick={() => setCol(k)}
                aria-label={optionLabel(t, "color", k, c.label)}
                aria-pressed={col === k}
                className={cn(
                  "tap-target h-9 w-9 rounded-full ring-offset-2 ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-7 sm:w-7",
                  c.dot,
                  col === k && "ring-2 ring-ring",
                )}
              />
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        {project && (
          <Button variant="danger-ghost" onClick={remove} className="sm:mr-auto">
            <Trash2 /> {t("wsDelete")}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t("wsCancel")}
        </Button>
        <Button onClick={save}>{project ? t("wsSave") : t("wsCreateProject")}</Button>
      </DialogFooter>
    </>
  );
}

/** Full task editor rendered inside the global task dialog. Lazy-loaded by TaskDialogProvider. */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Archive, Trash2, Plus, Send, Lock, X } from "lucide-react";
import { toast } from "sonner";

import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagInput, Field } from "@/components/common/TagInput";
import { supabase } from "@/integrations/supabase/client";
import { PRIORITY, RECURRENCE, TASK_STATUS } from "@/lib/constants";
import {
  dateToIso,
  getUid,
  isoToDate,
  openBlockers,
  useDependencyActions,
  useDeps,
  useMe,
  useMilestones,
  usePeople,
  useProjects,
  useTaskActions,
  useTasks,
  type Task,
} from "@/lib/data";
import { cn } from "@/lib/utils";
import { FocusTimer } from "@/components/tasks/FocusTimer";
import { syncTaskToGoogle } from "@/lib/googleCalendar.functions";
import { CheckCircle } from "@/components/tasks/CheckCircle";
import type { TaskDefaults } from "@/components/tasks/TaskDialogProvider";
import { toastError } from "@/lib/errors";
import { useI18n } from "@/lib/preferences";
import { enumLabel } from "@/components/tasks/labels";

const NONE = "none";

export default function TaskEditor({
  taskId,
  defaults,
  onClose,
  onOpen,
}: {
  taskId: string | null;
  defaults: TaskDefaults;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: milestones = [] } = useMilestones();
  const actions = useTaskActions();
  const { t, dateFns } = useI18n();
  const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;

  const [title, setTitle] = useState(task?.title ?? defaults.title ?? "");
  const [description, setDescription] = useState(task?.description ?? defaults.description ?? "");
  const [status, setStatus] = useState(task?.status ?? defaults.status ?? "todo");
  const [priority, setPriority] = useState(task?.priority ?? defaults.priority ?? "medium");
  const [projectId, setProjectId] = useState(task?.project_id ?? defaults.project_id ?? NONE);
  const [milestoneId, setMilestoneId] = useState(
    task?.milestone_id ?? defaults.milestone_id ?? NONE,
  );
  const [start, setStart] = useState(isoToDate(task?.start_date ?? defaults.start_date ?? null));
  const [due, setDue] = useState(isoToDate(task?.due_date ?? defaults.due_date ?? null));
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? NONE);
  const [assigneeName, setAssigneeName] = useState(task?.assignee_name ?? "");
  const [tags, setTags] = useState<string[]>(task?.tags ?? defaults.tags ?? []);
  const [recurrence, setRecurrence] = useState(task?.recurrence ?? defaults.recurrence ?? NONE);
  const [estimate, setEstimate] = useState(
    task?.estimate_minutes ?? defaults.estimate_minutes ?? 25,
  );
  const [startTime, setStartTime] = useState(
    task?.start_date ? new Date(task.start_date).toTimeString().slice(0, 5) : "09:00",
  );
  const [endTime, setEndTime] = useState(
    task?.time_block_end ? new Date(task.time_block_end).toTimeString().slice(0, 5) : "09:25",
  );
  const [saving, setSaving] = useState(false);

  const pid = projectId === NONE ? null : projectId;
  const { data: people = [] } = usePeople(pid);
  const projectMilestones = milestones.filter((m) => m.project_id === pid);
  const parent = task?.parent_id ? tasks.find((t) => t.id === task.parent_id) : undefined;

  const { data: deps = [] } = useDeps();
  async function save() {
    if (!title.trim()) {
      toast.error(t("taskTitleRequired"));
      return;
    }
    if (task && status !== "todo" && status !== task.status) {
      const b = openBlockers(task.id, deps, tasks);
      if (b.length) {
        toast.error(t("taskLockedWaitFor", { title: b[0]!.title }));
        return;
      }
    }
    if (start && due && start > due) {
      toast.error(t("taskStartAfterDue"));
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      project_id: pid,
      milestone_id: pid && milestoneId !== NONE ? milestoneId : null,
      start_date: start ? new Date(`${start}T${startTime}:00`).toISOString() : null,
      due_date: dateToIso(due),
      assignee_id: assigneeId === NONE ? null : assigneeId,
      assignee_name: assigneeId === NONE ? assigneeName.trim() || null : null,
      tags,
      recurrence: recurrence === NONE ? null : recurrence,
      estimate_minutes: estimate,
      time_block_end: start && endTime ? new Date(`${start}T${endTime}:00`).toISOString() : null,
      completed_at: status === "done" ? (task?.completed_at ?? new Date().toISOString()) : null,
    };
    if (task) {
      if (task.due_date !== payload.due_date) Object.assign(payload, { reminded: false });
      await actions.update(task.id, payload);
      toast.success(t("taskSaved"));
      onClose();
    } else {
      const created = await actions.create({ ...payload, parent_id: defaults.parent_id ?? null });
      if (created) {
        toast.success(t("taskCreated"));
        onClose();
      }
    }
    setSaving(false);
  }

  async function remove() {
    if (!task || !confirm(t("taskConfirmTrash"))) return;
    await actions.remove(task.id);
    toast.success(t("taskDeleted"));
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{task ? t("taskDetailTitle") : t("taskNewTitle")}</DialogTitle>
        <DialogDescription>
          {parent ? (
            <button
              className="underline-offset-2 hover:underline"
              onClick={() => onOpen(parent.id)}
            >
              {t("taskSubtaskOf", { title: parent.title })}
            </button>
          ) : task ? (
            t("taskCreatedAgo", {
              ago: formatDistanceToNow(new Date(task.created_at), {
                addSuffix: true,
                locale: dateFns,
              }),
            })
          ) : (
            t("taskEditorHint")
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <Input
          autoFocus={!task}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("taskTitlePlaceholder")}
          className="h-11 text-base font-medium"
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("taskDescriptionPlaceholder")}
          rows={3}
          className="min-h-24"
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={t("taskFieldStatus")}>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {enumLabel(t, "status", s.id, s.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("taskFieldPriority")}>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", p.dot)} />
                      {enumLabel(t, "priority", p.id, p.label)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("taskFieldProject")} className="col-span-2 sm:col-span-1">
            <Select
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v);
                setMilestoneId(NONE);
                setAssigneeId(NONE);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("taskNoProject")}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {/* Date + time need the full row on phones, or the date collapses to "dd/". */}
          <Field label={t("taskFieldStart")} className="col-span-2 sm:col-span-1">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem] sm:gap-1">
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </Field>
          <Field label={t("taskFieldDue")}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label={t("taskFieldRecurrence")}>
            <Select value={recurrence} onValueChange={setRecurrence}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRENCE.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {enumLabel(t, "recurrence", r.id, r.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("taskFieldEstimate")}>
            <Input
              type="number"
              min={1}
              max={1440}
              value={estimate}
              onChange={(e) => setEstimate(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
          <Field label={t("taskFieldTimeBlockEnd")}>
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={!start}
            />
          </Field>
          {pid && (
            <Field label={t("taskFieldMilestone")}>
              <Select value={milestoneId} onValueChange={setMilestoneId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("taskNoMilestone")}</SelectItem>
                  {projectMilestones.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t("taskFieldAssignee")} className={pid ? "" : "col-span-2"}>
            {people.length > 1 ? (
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("taskNoAssignee")}</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.display_name || p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={assigneeName}
                onChange={(e) => setAssigneeName(e.target.value)}
                placeholder={t("taskAssigneePlaceholder")}
              />
            )}
          </Field>
        </div>

        <Field label={t("taskFieldTags")}>
          <TagInput value={tags} onChange={setTags} />
        </Field>

        {task && <FocusTimer task={{ ...task, estimate_minutes: estimate }} />}
        {task && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const result = await syncTaskToGoogle({ data: { taskId: task.id } });
                  if (!result.connected) toast.error(t("taskGoogleNotConnected"));
                  else toast.success(t("taskGoogleSynced"));
                } catch (error) {
                  toastError(error, t("taskGoogleSyncFailed"));
                }
              }}
            >
              {t("taskSendToGoogle")}
            </Button>
          </div>
        )}
        {task && <Dependencies task={task} onOpen={onOpen} />}
        {task && <Subtasks parent={task} onOpen={onOpen} />}
        {task && <Comments key={task.id} taskId={task.id} />}
      </div>

      {/* Phones: primary on top, then Batal, then the secondary actions; desktop: one row. */}
      <DialogFooter>
        {task && (
          <div className="grid grid-cols-2 gap-2 sm:mr-auto sm:flex">
            <Button
              variant="ghost"
              onClick={remove}
              className="h-11 text-destructive hover:text-destructive sm:h-9"
            >
              <Trash2 /> {t("taskDelete")}
            </Button>
            <Button
              variant="ghost"
              className="h-11 sm:h-9"
              onClick={async () => {
                await actions.archive(task.id);
                onClose();
              }}
            >
              <Archive /> {t("taskArchive")}
            </Button>
          </div>
        )}
        <Button variant="outline" onClick={onClose}>
          {t("taskCancel")}
        </Button>
        <Button onClick={save} disabled={saving}>
          {task ? t("taskSave") : t("taskCreate")}
        </Button>
      </DialogFooter>
    </>
  );
}

function Dependencies({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { data: tasks = [] } = useTasks();
  const { data: deps = [] } = useDeps();
  const { add, remove } = useDependencyActions();
  const { t } = useI18n();
  const blockedBy = deps.filter((d) => d.blocked_id === task.id);
  const blocking = deps.filter((d) => d.blocker_id === task.id);
  const linked = new Set([
    task.id,
    ...blockedBy.map((d) => d.blocker_id),
    ...blocking.map((d) => d.blocked_id),
  ]);
  const candidates = tasks.filter((t) => !linked.has(t.id) && !t.parent_id && t.status !== "done");
  const open = openBlockers(task.id, deps, tasks);

  const row = (id: string, depId: string) => {
    const dep = tasks.find((x) => x.id === id);
    if (!dep) return null;
    return (
      <li
        key={depId}
        className="group flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-accent/50"
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            dep.status === "done" ? "bg-success" : "bg-priority-medium",
          )}
        />
        <button
          onClick={() => onOpen(dep.id)}
          className={cn(
            "flex-1 truncate text-left",
            dep.status === "done" && "text-muted-foreground line-through",
          )}
        >
          {dep.title}
        </button>
        <button
          onClick={() => remove(depId)}
          aria-label={t("taskDepRemove")}
          className="opacity-60 hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </li>
    );
  };
  const picker = (label: string, onPick: (id: string) => void) => (
    <Select value="" onValueChange={onPick}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {candidates.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("taskDepNoOtherTasks")}
          </div>
        )}
        {candidates.slice(0, 100).map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t("taskDepTitle")}</span>
        {open.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-priority-high">
            <Lock className="h-3 w-3" /> {t("taskDepLocked")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{t("taskDepBlockedBy")}</p>
          <ul>{blockedBy.map((d) => row(d.blocker_id, d.id))}</ul>
          {picker(t("taskDepAddBlocker"), (id) => add(id, task.id))}
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{t("taskDepBlocking")}</p>
          <ul>{blocking.map((d) => row(d.blocked_id, d.id))}</ul>
          {picker(t("taskDepAddWaiting"), (id) => add(task.id, id))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("taskDepAutoShiftHint")}</p>
    </div>
  );
}

function Subtasks({ parent, onOpen }: { parent: Task; onOpen: (id: string) => void }) {
  const { data: tasks = [] } = useTasks();
  const actions = useTaskActions();
  const [draft, setDraft] = useState("");
  const { t } = useI18n();
  const subs = tasks.filter((t) => t.parent_id === parent.id);
  const done = subs.filter((s) => s.status === "done").length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    await actions.create({
      title: draft.trim(),
      parent_id: parent.id,
      project_id: parent.project_id,
      priority: parent.priority,
    });
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t("taskSubtasksTitle")}</span>
        {subs.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {done}/{subs.length}
          </span>
        )}
      </div>
      {subs.length > 0 && (
        <div className="h-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-success motion-safe:transition-all"
            style={{ width: `${(done / subs.length) * 100}%` }}
          />
        </div>
      )}
      <ul className="space-y-1">
        {subs.map((s) => (
          <li
            key={s.id}
            className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/50"
          >
            <CheckCircle
              done={s.status === "done"}
              onClick={() => actions.setStatus(s, s.status === "done" ? "todo" : "done")}
            />
            <button
              onClick={() => onOpen(s.id)}
              className={cn(
                "flex-1 truncate text-left text-sm",
                s.status === "done" && "text-muted-foreground line-through",
              )}
            >
              {s.title}
            </button>
            <button
              onClick={() => actions.remove(s.id)}
              className="opacity-0 group-hover:opacity-100"
              aria-label={t("taskSubtaskDelete")}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("taskSubtaskAddPlaceholder")}
          className="h-8"
        />
        <Button type="submit" size="sm" variant="secondary">
          <Plus />
        </Button>
      </form>
    </div>
  );
}

function Comments({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { t, dateFns } = useI18n();
  const [draft, setDraft] = useState("");
  const key = ["comments", taskId];
  const { data: comments = [] } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_comments")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    const user_id = await getUid();
    const { error } = await supabase
      .from("task_comments")
      .insert({ task_id: taskId, user_id, content: draft.trim().slice(0, 2000) });
    if (error) {
      toastError(error);
      return;
    }
    setDraft("");
    qc.invalidateQueries({ queryKey: key });
  }

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">{t("taskCommentsTitle")}</span>
      <ul className="space-y-2">
        {comments.map((c) => (
          <li key={c.id} className="rounded-lg bg-secondary/60 px-3 py-2 text-sm">
            <p className="whitespace-pre-wrap">{c.content}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {c.user_id === me?.id ? t("taskCommentYou") : t("taskCommentMember")} ·{" "}
              {formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: dateFns })}
            </p>
          </li>
        ))}
      </ul>
      <form onSubmit={send} className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("taskCommentPlaceholder")}
          className="h-8"
        />
        <Button type="submit" size="sm" variant="secondary">
          <Send />
        </Button>
      </form>
    </div>
  );
}

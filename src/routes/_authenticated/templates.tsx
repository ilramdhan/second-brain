import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { CheckSquare, Pencil, Plus, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FillFromText } from "@/components/common/FillFromText";
import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { Button, IconButton, ResponsiveButton } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { fieldLabels, TEMPLATE_FIELD_LABEL } from "@/lib/capture-fields";
import { PRIORITY } from "@/lib/constants";
import { DEMO_TEMPLATE_PREFILL_EXAMPLES } from "@/lib/demo-examples";
import { draftTemplateFromText } from "@/lib/prefill.functions";
import { getUid, useNoteActions } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { toastError } from "@/lib/errors";
import { usePreferences } from "@/lib/preferences";
import { pageHead } from "@/lib/page-head";
import { optionLabel } from "@/lib/option-labels";
import { useConfirm } from "@/components/common/confirm-context";

export const Route = createFileRoute("/_authenticated/templates")({
  head: (ctx) => pageHead(ctx, { title: "metaTemplatesTitle", desc: "metaTemplatesDesc" }),
  component: TemplatesPage,
  errorComponent: RouteError,
});

type Payload = {
  title?: string;
  body?: string;
  priority?: string;
  tags?: string[];
  estimate?: number;
  subtasks?: string[];
};

function TemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { newTask } = useTaskDialog();
  const notes = useNoteActions();
  const { t: tr } = usePreferences();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<(typeof data)[number] | null>(null);
  const { data = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("templates").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });

  async function use(t: (typeof data)[number]) {
    const p = (t.payload ?? {}) as Payload;
    if (t.kind === "task") {
      newTask({
        title: p.title ?? t.name,
        description: p.body ?? null,
        priority: p.priority ?? "medium",
        tags: p.tags ?? [],
        estimate_minutes: p.estimate ?? 25,
      });
      // Note: subtasks from template are not pre-filled in the task dialog draft mode,
      // because TaskDialogProvider doesn't expose defaults.subtasks yet. They would need
      // to be stored in TaskDefaults and passed through, which is a larger change.
    } else {
      const body = p.body ?? "";
      const blocks = body
        .split("\n")
        .map((text) => ({ id: crypto.randomUUID(), type: "paragraph", text }));
      const row = await notes.create({
        title: p.title ?? t.name,
        content: body,
        tags: p.tags ?? [],
        blocks,
      });
      if (row) navigate({ to: "/notes/$noteId", params: { noteId: row.id } });
    }
  }
  async function remove(id: string) {
    const ok = await confirm({
      title: tr("wsTplDeleteConfirmTitle"),
      description: tr("wsTplDeleteConfirmDesc", {
        name: data.find((x) => x.id === id)?.name ?? "",
      }),
      destructive: true,
    });
    if (!ok) return;
    await supabase.from("templates").delete().eq("id", id);
    void qc.invalidateQueries({ queryKey: ["templates"] });
  }

  return (
    <PageContainer>
      <PageHeader
        title={tr("templates")}
        subtitle={tr("wsTplSubtitle")}
        actions={
          <ResponsiveButton onClick={() => setOpen(true)} icon={<Plus />} label={tr("templates")} />
        }
      />
      {data.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          {tr("wsTplEmpty")}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void seed("note", tr("wsTplSeedMeetingName"), {
                  title: tr("wsTplSeedMeetingTitle"),
                  body: tr("wsTplSeedMeetingBody"),
                  tags: ["meeting"],
                })
              }
            >
              + {tr("wsTplSeedMeetingName")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void seed("task", tr("wsTplSeedBugName"), {
                  title: "Fix: ",
                  body: tr("wsTplSeedBugBody"),
                  priority: "high",
                  tags: ["bug"],
                  estimate: 50,
                })
              }
            >
              + {tr("wsTplSeedBugButton")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => {
            const p = (t.payload ?? {}) as Payload;
            const Icon = t.kind === "task" ? CheckSquare : StickyNote;
            return (
              <article key={t.id} className="flex flex-col rounded-md border bg-card p-4">
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold">{t.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t.kind === "task" ? tr("wsKindTask") : tr("wsKindNote")}
                      {p.tags?.length ? ` · ${p.tags.map((x) => `#${x}`).join(" ")}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <IconButton
                      variant="secondary"
                      size="icon-sm"
                      onClick={() => {
                        setEditingTemplate(t);
                        setOpen(true);
                      }}
                      label="Edit template"
                    >
                      <Pencil />
                    </IconButton>
                    <IconButton
                      variant="danger-ghost"
                      size="icon-sm"
                      onClick={() => remove(t.id)}
                      label={tr("wsTplDelete")}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                </div>
                {p.body && (
                  <p className="mt-2 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">
                    {p.body}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-auto self-start pt-0"
                  style={{ marginTop: 12 }}
                  onClick={() => use(t)}
                >
                  {tr("wsTplUse")}
                </Button>
              </article>
            );
          })}
        </div>
      )}
      <TemplateDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setEditingTemplate(null);
        }}
        initial={editingTemplate}
        onSave={async (id, kind, name, payload) => {
          if (id) {
            await update(id, kind, name, payload);
          } else {
            await seed(kind, name, payload);
          }
          setOpen(false);
          setEditingTemplate(null);
        }}
      />
    </PageContainer>
  );

  async function seed(kind: "task" | "note", name: string, payload: Payload) {
    const user_id = await getUid();
    const { error } = await supabase.from("templates").insert({ user_id, kind, name, payload });
    if (error) toastError(error);
    else toast.success(tr("wsTplSaved"));
    void qc.invalidateQueries({ queryKey: ["templates"] });
  }
  async function update(id: string, kind: "task" | "note", name: string, payload: Payload) {
    const { error } = await supabase.from("templates").update({ kind, name, payload }).eq("id", id);
    if (error) toastError(error);
    else toast.success(tr("wsTplSaved"));
    void qc.invalidateQueries({ queryKey: ["templates"] });
  }
}

function TemplateDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: { id: string; kind: "task" | "note"; name: string; payload: unknown } | null;
  onSave: (id: string | null, kind: "task" | "note", name: string, p: Payload) => Promise<void>;
}) {
  const [kind, setKind] = useState<"task" | "note">("task");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("medium");
  const [tags, setTags] = useState("");
  const [estimate, setEstimate] = useState(25);
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const draftTemplate = useServerFn(draftTemplateFromText);
  const { t: tr } = usePreferences();

  // Sync state when initial changes (edit mode)
  useEffect(() => {
    if (initial) {
      const p = (initial.payload ?? {}) as Payload;
      setKind(initial.kind);
      setName(initial.name);
      setTitle(p.title ?? "");
      setBody(p.body ?? "");
      setPriority(p.priority ?? "medium");
      setTags(p.tags?.join(", ") ?? "");
      setEstimate(p.estimate ?? 25);
      setSubtasks(p.subtasks ?? []);
    } else {
      // Reset for new template
      setKind("task");
      setName("");
      setTitle("");
      setBody("");
      setPriority("medium");
      setTags("");
      setEstimate(25);
      setSubtasks([]);
    }
    setSubtaskDraft("");
  }, [initial]);

  async function save() {
    if (!name.trim()) {
      toast.error(tr("wsTplNameRequired"));
      return;
    }
    const payload: Payload = {
      title,
      body,
      tags: tags
        .split(/[,\s]+/)
        .map((x) => x.replace(/^#/, ""))
        .filter(Boolean),
    };
    if (kind === "task") {
      payload.priority = priority;
      payload.estimate = estimate;
      if (subtasks.length > 0) {
        payload.subtasks = subtasks;
      }
    }
    await onSave(initial?.id ?? null, kind, name.trim(), payload);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("wsTplNew")}</DialogTitle>
          <DialogDescription>{tr("wsTplNewDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FillFromText
            examples={DEMO_TEMPLATE_PREFILL_EXAMPLES}
            placeholder={tr("wsTplFillPlaceholder")}
            labels={fieldLabels(tr, TEMPLATE_FIELD_LABEL)}
            onFill={(text) => draftTemplate({ data: { text } })}
            onApply={({ draft: d }) => {
              setKind(d.kind);
              setName(d.name);
              setTitle(d.title);
              setBody(d.body);
              setTags(d.tags.join(", "));
              setPriority(d.priority);
              setEstimate(d.estimate);
              if ((d as { subtasks?: string[] }).subtasks) {
                setSubtasks((d as { subtasks?: string[] }).subtasks ?? []);
              }
            }}
          />
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as "task" | "note")}>
              <SelectTrigger aria-label={tr("wsTplKind")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task">{tr("wsKindTask")}</SelectItem>
                <SelectItem value="note">{tr("wsKindNote")}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr("wsTplName")}
              aria-label={tr("wsTplName")}
            />
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tr("wsTplTitlePlaceholder")}
            aria-label={tr("wsTplTitle")}
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={kind === "task" ? tr("wsTplBodyTask") : tr("wsTplBodyNote")}
            rows={6}
            className="min-h-32"
            aria-label={kind === "task" ? tr("wsTplBodyTaskLabel") : tr("wsTplBodyNote")}
          />
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={tr("wsTplTagsPlaceholder")}
            aria-label={tr("wsTplTags")}
          />
          {kind === "task" && (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-2">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger aria-label={tr("wsPriority")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {optionLabel(tr, "priority", p.id, p.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={5}
                step={5}
                value={estimate}
                onChange={(e) => setEstimate(Number(e.target.value))}
                aria-label={tr("wsTplEstimate")}
              />
            </div>
          )}
          {kind === "task" && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Sub-tugas / checklist
              </div>
              {subtasks.length > 0 && (
                <ul className="space-y-1">
                  {subtasks.map((sub, i) => (
                    <li
                      key={i}
                      className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/50"
                    >
                      <div className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                      <span className="flex-1 truncate text-sm">{sub}</span>
                      <IconButton
                        label="Hapus subtask"
                        variant="danger-ghost"
                        size="icon-sm"
                        className="opacity-100 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        onClick={() => setSubtasks(subtasks.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (subtaskDraft.trim()) {
                    setSubtasks([...subtasks, subtaskDraft.trim()]);
                    setSubtaskDraft("");
                  }
                }}
                className="flex gap-2"
              >
                <Input
                  value={subtaskDraft}
                  onChange={(e) => setSubtaskDraft(e.target.value)}
                  placeholder="Tambah sub-tugas..."
                  className="h-8"
                />
                <IconButton type="submit" label="Tambah subtask" variant="secondary" size="icon-sm">
                  <Plus />
                </IconButton>
              </form>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tr("wsCancel")}
          </Button>
          <Button onClick={save}>{tr("wsSave")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

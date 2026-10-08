import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckSquare, Plus, StickyNote, Trash2 } from "lucide-react";
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
};

function TemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { newTask } = useTaskDialog();
  const notes = useNoteActions();
  const { t: tr } = usePreferences();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
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
    if (t.kind === "task")
      newTask({
        title: p.title ?? t.name,
        description: p.body ?? null,
        priority: p.priority ?? "medium",
        tags: p.tags ?? [],
        estimate_minutes: p.estimate ?? 25,
      });
    else {
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
                  <IconButton
                    variant="danger-ghost"
                    size="icon-sm"
                    onClick={() => remove(t.id)}
                    label={tr("wsTplDelete")}
                  >
                    <Trash2 />
                  </IconButton>
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
        onOpenChange={setOpen}
        onSave={async (kind, name, payload) => {
          await seed(kind, name, payload);
          setOpen(false);
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
}

function TemplateDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (kind: "task" | "note", name: string, p: Payload) => Promise<void>;
}) {
  const [kind, setKind] = useState<"task" | "note">("task");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("medium");
  const [tags, setTags] = useState("");
  const [estimate, setEstimate] = useState(25);
  const draftTemplate = useServerFn(draftTemplateFromText);
  const { t: tr } = usePreferences();
  async function save() {
    if (!name.trim()) {
      toast.error(tr("wsTplNameRequired"));
      return;
    }
    await onSave(kind, name.trim(), {
      title,
      body,
      tags: tags
        .split(/[,\s]+/)
        .map((x) => x.replace(/^#/, ""))
        .filter(Boolean),
      ...(kind === "task" ? { priority, estimate } : {}),
    });
    setName("");
    setTitle("");
    setBody("");
    setTags("");
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

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  Loader2,
  Archive,
  Check,
  FileText,
  Bug,
  ListTodo,
  NotebookPen,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { parseBrainDump, paraphrasePoint } from "@/lib/ai.functions";
import { captureInboxNote, captureInboxTask } from "@/lib/capture.functions";
import { QuickCapture } from "@/components/QuickCapture";
import { DemoExamples } from "@/components/demo/DemoExamples";
import { FIELD_LABEL, filledFieldsText, NOTE_FIELD_LABEL } from "@/lib/capture-fields";
import { scheduleSemanticSync } from "@/lib/semantic-sync";
import { isDemoGenericReply } from "@/lib/demo-examples";
import type { Tables } from "@/integrations/supabase/types";
import { LoadMore, usePaged } from "@/components/common/LoadMore";
import { VirtualList } from "@/components/common/VirtualList";
import { PageContainer } from "@/components/common/PageContainer";
import { withNoteIndex } from "@/lib/blocks";
import { qk, useAutomations, useProjects } from "@/lib/data";
import { useServerFn } from "@tanstack/react-start";
import { runAutomations } from "@/lib/automations.functions";
import { noteEventRelevant } from "@/lib/automation-types";
import { preloadQueries, projectsQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { toastError } from "@/lib/errors";
import { usePreferences, type MessageKey } from "@/lib/preferences";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: (ctx) => pageHead(ctx, { title: "metaInboxTitle", desc: "metaInboxDesc" }),
  loader: ({ context }) => preloadQueries(context.queryClient, projectsQuery),
  component: InboxPage,
  errorComponent: RouteError,
});

type InboxItem = Tables<"inbox_items">;

const SOURCE_LABEL: Record<string, MessageKey> = {
  manual: "wsInboxSourceManual",
  telegram: "wsInboxSourceTelegram",
  voice: "wsInboxSourceVoice",
  ocr: "wsInboxSourceOcr",
};

function InboxPage() {
  const qc = useQueryClient();
  const { t: tr, dateFns } = usePreferences();
  const [items, setItems] = useState<InboxItem[]>([]);
  // Shared cached list (excludes trashed projects) instead of a private `select *`.
  const { data: projects = [] } = useProjects();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [taskingId, setTaskingId] = useState<string | null>(null);
  const [notingId, setNotingId] = useState<string | null>(null);
  const { data: rules = [] } = useAutomations();
  const runRules = useServerFn(runAutomations);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("inbox_items")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setItems(data ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the Supabase request resolves.
    load();
  }, [load]);

  async function handleAiParse(item: InboxItem) {
    setProcessingId(item.id);
    try {
      const parsed = await parseBrainDump({ data: { dump: item.content } });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error(tr("wsInboxSessionEnded"));

      // Buat proyek baru bila AI menyarankan nama yang belum ada
      const projectMap = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));
      for (const t of parsed) {
        if (t.project && !projectMap.has(t.project.toLowerCase())) {
          const { data: np } = await supabase
            .from("projects")
            .insert({ user_id: user.id, name: t.project, para_type: "project" })
            .select()
            .single();
          if (np) projectMap.set(t.project.toLowerCase(), np.id);
        }
      }

      const taskRows = parsed
        .filter((t) => t.kind !== "note")
        .map((t) => ({
          user_id: user.id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          due_date: t.due_date ? new Date(t.due_date + "T17:00:00").toISOString() : null,
          tags: t.kind === "issue" ? [...new Set([...t.tags, "issue"])] : t.tags,
          project_id: t.project ? (projectMap.get(t.project.toLowerCase()) ?? null) : null,
        }));
      if (taskRows.length) {
        const { error } = await supabase.from("tasks").insert(taskRows);
        if (error) throw error;
      }

      const noteRows = parsed
        .filter((t) => t.kind === "note")
        .map((t) =>
          withNoteIndex({
            user_id: user.id,
            title: t.title,
            content: t.description ?? "",
            project_id: t.project ? (projectMap.get(t.project.toLowerCase()) ?? null) : null,
          }),
        );
      if (noteRows.length) {
        const { data: inserted, error } = await supabase
          .from("notes")
          .insert(noteRows)
          .select("id,tags");
        if (error) throw error;
        // Note rules (note_created / note_tagged), like useNoteActions.create. Best effort.
        for (const n of inserted ?? [])
          if (noteEventRelevant(rules, "created", n.tags.length))
            await runRules({ data: { entity: "note", event: "created", noteId: n.id } }).catch(
              (e) => console.error("note automation failed", e),
            );
      }

      await supabase.from("inbox_items").update({ status: "processed" }).eq("id", item.id);
      // Rows were inserted outside the data hooks; refresh the lists they belong to.
      for (const key of [qk.tasks, qk.notes, qk.projects, ["inbox-count"]])
        void qc.invalidateQueries({ queryKey: key });
      toast.success(tr("wsInboxProcessed", { tasks: taskRows.length, notes: noteRows.length }));
      load();
    } catch (err) {
      toastError(err, tr("wsInboxAiFailed"));
    } finally {
      setProcessingId(null);
    }
  }

  /** One item → one fully filled task (AI extraction, regex fallback), written server-side. */
  async function handleToTask(item: InboxItem) {
    setTaskingId(item.id);
    try {
      const r = await captureInboxTask({ data: { itemId: item.id, text: item.content } });
      for (const key of [qk.tasks, qk.deps, ["inbox-count"]])
        void qc.invalidateQueries({ queryKey: key });
      scheduleSemanticSync();
      const fields = filledFieldsText(tr, FIELD_LABEL, r.filled);
      toast.success(tr("wsInboxTaskCreated", { title: r.title }), {
        description: [
          `${r.via === "ai" ? tr("wsInboxFilledAi") : tr("wsInboxFilledLocal")}${fields ? `: ${fields}` : ""}`,
          r.dropped.length ? tr("wsInboxDropped", { items: r.dropped.join("; ") }) : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      load();
    } catch (err) {
      toastError(err, tr("wsInboxTaskFailed"));
    } finally {
      setTaskingId(null);
    }
  }

  /** One item → one structured note (AI extraction, local fallback), written server-side. */
  async function handleToNote(item: InboxItem) {
    setNotingId(item.id);
    try {
      const r = await captureInboxNote({ data: { itemId: item.id, text: item.content } });
      for (const key of [qk.notes, qk.noteBlocks, ["inbox-count"]])
        void qc.invalidateQueries({ queryKey: key });
      scheduleSemanticSync();
      const fields = filledFieldsText(tr, NOTE_FIELD_LABEL, r.filled);
      toast.success(tr("wsInboxNoteCreated", { title: r.title }), {
        description: [
          `${r.via === "ai" ? tr("wsInboxFilledAi") : tr("wsInboxFilledLocal")}${fields ? `: ${fields}` : ""}`,
          r.dropped.length ? tr("wsInboxDropped", { items: r.dropped.join("; ") }) : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      load();
    } catch (err) {
      toastError(err, tr("wsInboxNoteFailed"));
    } finally {
      setNotingId(null);
    }
  }

  async function handleParaphrase(item: InboxItem) {
    setExpandingId(item.id);
    try {
      const expanded = await paraphrasePoint({ data: { point: item.content } });
      // Demo: free text gets a "try an example" reply; show it instead of overwriting the item.
      if (isDemoGenericReply(expanded)) {
        toast.info(expanded);
        return;
      }
      await supabase
        .from("inbox_items")
        .update({ content: expanded, ai_summary: item.content })
        .eq("id", item.id);
      toast.success(tr("wsInboxParaphrased"));
      load();
    } catch (err) {
      toastError(err, tr("wsInboxParaphraseFailed"));
    } finally {
      setExpandingId(null);
    }
  }

  async function handleArchive(item: InboxItem) {
    await supabase.from("inbox_items").update({ status: "archived" }).eq("id", item.id);
    void qc.invalidateQueries({ queryKey: ["inbox-count"] });
    load();
  }

  const paged = usePaged(items, 15);
  return (
    <PageContainer contentWidth="readable">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{tr("inbox")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr("wsInboxSubtitle")}</p>
        <DemoExamples className="mt-2" />
      </header>

      <QuickCapture onCaptured={load} />

      <VirtualList
        className="mt-6"
        items={paged.visible}
        getKey={(item) => item.id}
        estimateSize={150}
        gap={12}
        renderItem={(item) => (
          <div className="rounded-2xl border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">
                {item.source in SOURCE_LABEL ? tr(SOURCE_LABEL[item.source]!) : item.source}
              </span>
              <span>
                {formatDistanceToNow(new Date(item.created_at), {
                  addSuffix: true,
                  locale: dateFns,
                })}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{item.content}</p>
            {item.ai_summary && (
              <p className="mt-1 text-xs text-muted-foreground">
                {tr("wsInboxOriginalPoint", { text: item.ai_summary })}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
              <button
                onClick={() => handleAiParse(item)}
                disabled={processingId === item.id}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {processingId === item.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {tr("wsInboxProcessAi")}
              </button>
              <button
                onClick={() => handleToTask(item)}
                disabled={taskingId === item.id}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                {taskingId === item.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ListTodo className="h-3.5 w-3.5" />
                )}
                {tr("wsInboxToTask")}
              </button>
              <button
                onClick={() => handleToNote(item)}
                disabled={notingId === item.id}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                {notingId === item.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <NotebookPen className="h-3.5 w-3.5" />
                )}
                {tr("wsInboxToNote")}
              </button>
              <button
                onClick={() => handleParaphrase(item)}
                disabled={expandingId === item.id}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                {expandingId === item.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {tr("wsInboxParaphrase")}
              </button>
              <button
                onClick={() => handleArchive(item)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                <Archive className="h-3.5 w-3.5" />
                {tr("wsInboxArchive")}
              </button>
            </div>
          </div>
        )}
      />
      <LoadMore shown={paged.visible.length} total={paged.total} onMore={paged.more} />

      {items.length === 0 && (
        <div className="mt-12 flex flex-col items-center gap-2 text-center">
          <Check className="h-8 w-8 text-success" />
          <p className="text-sm text-muted-foreground">{tr("wsInboxEmpty")}</p>
        </div>
      )}

      <div className="mt-8 rounded-xl border bg-secondary/50 p-4 text-xs text-muted-foreground">
        <p className="mb-1 flex items-center gap-1.5 font-medium text-secondary-foreground">
          <ListTodo className="h-3.5 w-3.5" /> {tr("wsInboxHowTitle")}
        </p>
        <p>
          {tr("wsInboxHow1")}
          <ListTodo className="inline h-3 w-3" />
          {tr("wsInboxHow2")}
          <Bug className="inline h-3 w-3" />
          {tr("wsInboxHow3")}
        </p>
      </div>
    </PageContainer>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, subDays } from "date-fns";
import { useEffect, useState } from "react";
import {
  Archive,
  CheckSquare,
  FolderKanban,
  Repeat,
  RotateCcw,
  StickyNote,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { LoadMore, usePaged } from "@/components/common/LoadMore";
import { VirtualList } from "@/components/common/VirtualList";
import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { toastError } from "@/lib/errors";
import { usePreferences } from "@/lib/preferences";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/_authenticated/archive")({
  head: (ctx) => pageHead(ctx, { title: "metaArchiveTitle", desc: "metaArchiveDesc" }),
  component: ArchivePage,
  errorComponent: RouteError,
});

type Kind = "tasks" | "notes" | "projects" | "habits";
type Item = { id: string; kind: Kind; title: string; at: string };
const ICON = { tasks: CheckSquare, notes: StickyNote, projects: FolderKanban, habits: Repeat };
const LABEL = { tasks: "tasks", notes: "notes", projects: "projects", habits: "habits" } as const;
const RETENTION_DAYS = 30;

function ArchivePage() {
  const { t: tt, dateFns } = usePreferences();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"archive" | "trash">("trash");
  const { data = [], isLoading } = useQuery({
    queryKey: ["bin", tab],
    queryFn: async (): Promise<Item[]> => {
      const col = tab === "trash" ? "deleted_at" : "archived_at";
      const [t, n, p, h] = await Promise.all([
        (tab === "archive"
          ? supabase
              .from("tasks")
              .select("id,title,deleted_at,archived_at")
              .not(col, "is", null)
              .is("deleted_at", null)
          : supabase.from("tasks").select("id,title,deleted_at,archived_at").not(col, "is", null)
        ).order(col, { ascending: false }),
        (tab === "archive"
          ? supabase
              .from("notes")
              .select("id,title,deleted_at,archived_at")
              .not(col, "is", null)
              .is("deleted_at", null)
          : supabase.from("notes").select("id,title,deleted_at,archived_at").not(col, "is", null)
        ).order(col, { ascending: false }),
        tab === "trash"
          ? supabase.from("projects").select("id,name,deleted_at").not("deleted_at", "is", null)
          : Promise.resolve({ data: [], error: null }),
        (tab === "archive"
          ? supabase
              .from("habits")
              .select("id,name,deleted_at,archived_at")
              .not(col, "is", null)
              .is("deleted_at", null)
          : supabase.from("habits").select("id,name,deleted_at,archived_at").not(col, "is", null)
        ).order(col, { ascending: false }),
      ]);
      const err = t.error ?? n.error ?? p.error ?? h.error;
      if (err) throw err;
      const pick = (r: { deleted_at: string | null; archived_at?: string | null }) =>
        (tab === "trash" ? r.deleted_at : r.archived_at) ?? "";
      return [
        ...(t.data ?? []).map((r) => ({
          id: r.id,
          kind: "tasks" as const,
          title: r.title,
          at: pick(r),
        })),
        ...(n.data ?? []).map((r) => ({
          id: r.id,
          kind: "notes" as const,
          title: r.title,
          at: pick(r),
        })),
        ...((p.data ?? []) as { id: string; name: string; deleted_at: string | null }[]).map(
          (r) => ({ id: r.id, kind: "projects" as const, title: r.name, at: r.deleted_at ?? "" }),
        ),
        ...(h.data ?? []).map((r) => ({
          id: r.id,
          kind: "habits" as const,
          title: r.name,
          at: pick(r),
        })),
      ].sort((a, b) => b.at.localeCompare(a.at));
    },
  });
  const paged = usePaged(data, 20, tab);

  // Purge trash older than the retention window.
  useEffect(() => {
    if (tab !== "trash") return;
    const cutoff = subDays(new Date(), RETENTION_DAYS).toISOString();
    void Promise.all([
      supabase.from("tasks").delete().lt("deleted_at", cutoff),
      supabase.from("notes").delete().lt("deleted_at", cutoff),
      supabase.from("projects").delete().lt("deleted_at", cutoff),
      supabase.from("habits").delete().lt("deleted_at", cutoff),
    ]);
  }, [tab]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["bin"] });
    [qk.tasks, qk.notes, qk.projects, qk.habits].forEach(
      (k) => void qc.invalidateQueries({ queryKey: k }),
    );
  };
  async function restore(it: Item) {
    const patch = tab === "trash" ? { deleted_at: null } : { archived_at: null };
    // Projects only appear in the trash tab, so they only ever restore `deleted_at`.
    const query =
      it.kind === "projects"
        ? supabase.from("projects").update({ deleted_at: null })
        : supabase.from(it.kind).update(patch);
    const { error } = await query.eq("id", it.id);
    if (!error && it.kind === "tasks" && tab === "trash")
      await supabase.from("tasks").update({ deleted_at: null }).eq("parent_id", it.id);
    if (error) toastError(error);
    else toast.success(tt("admRestored"));
    refresh();
  }
  async function purge(it: Item) {
    if (!confirm(tt("admPurgeConfirm", { title: it.title }))) return;
    const { error } = await supabase.from(it.kind).delete().eq("id", it.id);
    if (error) toastError(error);
    else toast.success(tt("admPurged"));
    refresh();
  }
  async function emptyTrash() {
    if (!confirm(tt("admEmptyConfirm"))) return;
    await Promise.all(data.map((it) => supabase.from(it.kind).delete().eq("id", it.id)));
    toast.success(tt("admEmptied"));
    refresh();
  }

  return (
    <PageContainer>
      <PageHeader
        title={tt("admArchiveTitle")}
        subtitle={
          tab === "trash"
            ? tt("admTrashSubtitle", { days: RETENTION_DAYS })
            : tt("admArchiveSubtitle")
        }
        actions={
          tab === "trash" && data.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={emptyTrash}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 /> {tt("admEmptyTrash")}
            </Button>
          ) : undefined
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "archive" | "trash")} className="mb-4">
        <TabsList>
          <TabsTrigger value="trash" className="gap-1.5">
            <Trash2 className="h-3.5 w-3.5" />
            {tt("admTrash")}
          </TabsTrigger>
          <TabsTrigger value="archive" className="gap-1.5">
            <Archive className="h-3.5 w-3.5" />
            {tt("admArchiveTab")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="overflow-hidden rounded-md border bg-card">
        {isLoading && <p className="p-6 text-sm text-muted-foreground">{tt("admLoading")}</p>}
        {!isLoading && data.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {tab === "trash" ? tt("admTrashEmpty") : tt("admArchiveEmpty")}
          </p>
        )}
        <VirtualList
          className="divide-y"
          items={paged.visible}
          getKey={(it) => `${it.kind}-${it.id}`}
          estimateSize={64}
          renderItem={(it) => {
            const Icon = ICON[it.kind];
            return (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium">{it.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {tt(LABEL[it.kind])} ·{" "}
                    {it.at &&
                      formatDistanceToNow(new Date(it.at), { addSuffix: true, locale: dateFns })}
                  </p>
                </div>
                <div className="ml-auto flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => restore(it)}>
                    <RotateCcw /> {tt("admRestore")}
                  </Button>
                  {tab === "trash" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => purge(it)}
                      aria-label={tt("admPurge")}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
            );
          }}
        />
      </div>
      <LoadMore shown={paged.visible.length} total={paged.total} onMore={paged.more} />
    </PageContainer>
  );
}

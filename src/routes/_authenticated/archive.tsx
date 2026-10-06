import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, subDays } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { useEffect, useState } from "react";
import { Archive, CheckSquare, FolderKanban, RotateCcw, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { LoadMore, usePaged } from "@/components/common/LoadMore";
import { VirtualList } from "@/components/common/VirtualList";
import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/archive")({
  head: () => ({
    meta: [
      { title: "Arsip & Tempat Sampah — Second Brain" },
      {
        name: "description",
        content: "Kembalikan tugas, catatan, dan proyek yang diarsipkan atau dihapus.",
      },
      { property: "og:title", content: "Arsip & Tempat Sampah — Second Brain" },
      {
        property: "og:description",
        content: "Kembalikan tugas, catatan, dan proyek yang diarsipkan atau dihapus.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ArchivePage,
});

type Kind = "tasks" | "notes" | "projects";
type Item = { id: string; kind: Kind; title: string; at: string };
const ICON = { tasks: CheckSquare, notes: StickyNote, projects: FolderKanban };
const LABEL = { tasks: "Tugas", notes: "Catatan", projects: "Proyek" };
const RETENTION_DAYS = 30;

function ArchivePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"archive" | "trash">("trash");
  const { data = [], isLoading } = useQuery({
    queryKey: ["bin", tab],
    queryFn: async (): Promise<Item[]> => {
      const col = tab === "trash" ? "deleted_at" : "archived_at";
      const [t, n, p] = await Promise.all([
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
      ]);
      const err = t.error ?? n.error ?? p.error;
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
    ]);
  }, [tab]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["bin"] });
    [qk.tasks, qk.notes, qk.projects].forEach((k) => void qc.invalidateQueries({ queryKey: k }));
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
    if (error) toast.error(error.message);
    else toast.success("Dikembalikan");
    refresh();
  }
  async function purge(it: Item) {
    if (!confirm(`Hapus permanen "${it.title}"? Ini tidak bisa dibatalkan.`)) return;
    const { error } = await supabase.from(it.kind).delete().eq("id", it.id);
    if (error) toast.error(error.message);
    else toast.success("Dihapus permanen");
    refresh();
  }
  async function emptyTrash() {
    if (!confirm("Kosongkan Tempat Sampah? Semua item dihapus permanen.")) return;
    await Promise.all(data.map((it) => supabase.from(it.kind).delete().eq("id", it.id)));
    toast.success("Tempat Sampah dikosongkan");
    refresh();
  }

  return (
    <PageContainer>
      <PageHeader
        title="Arsip & Tempat Sampah"
        subtitle={
          tab === "trash"
            ? `Item terhapus disimpan ${RETENTION_DAYS} hari sebelum dihapus permanen.`
            : "Item yang diarsipkan disembunyikan dari daftar, tapi tidak hilang."
        }
        actions={
          tab === "trash" && data.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={emptyTrash}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 /> Kosongkan
            </Button>
          ) : undefined
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "archive" | "trash")} className="mb-4">
        <TabsList>
          <TabsTrigger value="trash" className="gap-1.5">
            <Trash2 className="h-3.5 w-3.5" />
            Tempat Sampah
          </TabsTrigger>
          <TabsTrigger value="archive" className="gap-1.5">
            <Archive className="h-3.5 w-3.5" />
            Arsip
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="overflow-hidden rounded-md border bg-card">
        {isLoading && <p className="p-6 text-sm text-muted-foreground">Memuat…</p>}
        {!isLoading && data.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {tab === "trash" ? "Tempat Sampah kosong." : "Belum ada yang diarsipkan."}
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
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {LABEL[it.kind]} ·{" "}
                    {it.at &&
                      formatDistanceToNow(new Date(it.at), { addSuffix: true, locale: localeId })}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => restore(it)}>
                    <RotateCcw /> Kembalikan
                  </Button>
                  {tab === "trash" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => purge(it)}
                      aria-label="Hapus permanen"
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

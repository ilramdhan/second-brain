import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  Archive,
  ArrowLeft,
  History,
  Link2,
  Loader2,
  Network,
  Pin,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { BlockEditor, InlineText } from "@/components/notes/BlockEditor";
import { NoteLinksContext, useNoteLinksValue } from "@/components/notes/note-links";
import { TagInput } from "@/components/common/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { summarizeMeeting } from "@/lib/ai.functions";
import { indexBlocks, linksOf, loadBlocks, toMarkdown, type Block } from "@/lib/blocks";
import { NOTE_STATUS } from "@/lib/constants";
import {
  useBacklinks,
  useNote,
  useNoteActions,
  useNoteBlocks,
  useNotes,
  useProjects,
  type NoteDetail,
} from "@/lib/data";
import { useDebounced } from "@/hooks/use-debounced";
import type { Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useNoteCollaboration } from "@/hooks/use-note-collaboration";
import { PageContainer } from "@/components/common/PageContainer";
import { noteBlocksQuery, noteQuery, preloadQueries, projectsQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { toastError } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/notes/$noteId")({
  head: () => ({
    meta: [
      { title: "Catatan — Second Brain" },
      {
        name: "description",
        content: "Editor blok dengan tautan dua arah, referensi blok, properti, dan tabel dinamis.",
      },
      { property: "og:title", content: "Catatan — Second Brain" },
      { property: "og:description", content: "Tulis, tautkan, dan susun ulang ide Anda." },
    ],
  }),
  loader: ({ context, params }) =>
    preloadQueries(context.queryClient, noteQuery(params.noteId), noteBlocksQuery, projectsQuery),
  component: NotePage,
  errorComponent: RouteError,
});

const NONE = "none";
/** Autosave debounce (Phase 4.3: 1.5–2 s, and only the collaboration leader saves blocks). */
const SAVE_DEBOUNCE_MS = 1500;

function NotePage() {
  const { noteId } = Route.useParams();
  const { data: note, isLoading } = useNote(noteId);
  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (!note)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">Catatan tidak ditemukan.</p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/notes">Kembali ke catatan</Link>
        </Button>
      </div>
    );
  return <NoteEditor key={note.id} note={note} />;
}

function NoteEditor({ note }: { note: NoteDetail }) {
  // Every note's blocks, for block refs/embeds (shared with BlockEditor). Fetched on this route
  // and the graph only.
  const { data: notes = [] } = useNoteBlocks();
  const { data: noteList = [] } = useNotes();
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const actions = useNoteActions();
  const [title, setTitle] = useState(note.title);
  const [blocks, setBlocks] = useState<Block[]>(() => loadBlocks(note));
  const [props, setProps] = useState<[string, string][]>(() =>
    Object.entries((note.properties as Record<string, unknown>) ?? {}).map(([k, v]) => [
      k,
      String(v),
    ]),
  );
  const [saving, setSaving] = useState<"idle" | "dirty" | "saving">("idle");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title, blocks, props });
  // Synced after commit (not during render) so stable callbacks read the latest values.
  useLayoutEffect(() => {
    latest.current = { title, blocks, props };
  });

  async function flush() {
    const { title: t, blocks: b, props: p } = latest.current;
    setSaving("saving");
    const properties = Object.fromEntries(
      p
        .filter(([k]) => k.trim())
        .map(([k, v]) => [
          k.trim().toLowerCase().replace(/\s+/g, "_"),
          v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v,
        ]),
    );
    await actions.update(note.id, {
      title: t.trim() || "Tanpa judul",
      blocks: b as unknown as Json,
      content: toMarkdown(b),
      properties: properties as Json,
    });
    setSaving("idle");
  }
  function schedule() {
    setSaving("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        flush();
      }
    },
    [],
  );

  // Block edits reach every peer through the shared Y.Doc, so only the autosave leader writes them
  // to `notes.blocks` (one save per burst instead of one per peer). Title and properties are not
  // in the doc, so a peer always saves its own changes to those.
  const collaboration = useNoteCollaboration(
    note.id,
    blocks,
    (remote, isLeader) => {
      setBlocks(remote);
      if (isLeader) schedule();
    },
    (leader) => {
      // Took over from a leader that left: save whatever it may not have written yet.
      if (leader) schedule();
    },
  );
  const changeBlocks = (b: Block[]) => {
    setBlocks(b);
    collaboration.publishBlocks(b);
    if (collaboration.isLeader()) schedule();
  };

  // Backlinks: notes that link here by [[title]] or reference one of this note's blocks. Postgres
  // answers from the stored `links`/`refs` (migration 0018); the block ids are debounced so typing
  // does not issue a request per keystroke (they only change when blocks are added/removed).
  const blockIdKey = useDebounced(blocks.map((b) => b.id).join(","), 800);
  const backlinkTitle = note.title.trim().toLowerCase();
  const { data: backlinks } = useBacklinks(
    note.id,
    backlinkTitle,
    useMemo(() => (blockIdKey ? blockIdKey.split(",") : []), [blockIdKey]),
  );
  const { linked, unlinked } = useMemo(() => {
    const myBlocks = new Set(blockIdKey.split(","));
    const linked = (backlinks?.linked ?? []).map((n) => ({
      note: n,
      snippets: loadBlocks({ blocks: n.blocks ?? [], content: n.content ?? "" })
        .filter((b) => {
          const l = linksOf([b]);
          return l.titles.has(backlinkTitle) || [...l.refs].some((r) => myBlocks.has(r));
        })
        .map((b) => b.text),
    }));
    return { linked, unlinked: backlinks?.unlinked ?? [] };
  }, [backlinks, backlinkTitle, blockIdKey]);
  const index = useMemo(() => indexBlocks(notes), [notes]);
  const noteLinks = useNoteLinksValue();
  const outgoing = useMemo(() => {
    const { titles } = linksOf(blocks);
    return noteList.filter((n) => titles.has(n.title.trim().toLowerCase()));
  }, [blocks, noteList]);

  async function summarize() {
    const text = toMarkdown(blocks);
    if (!text.trim()) {
      toast.error("Isi catatan dulu");
      return;
    }
    setBusy(true);
    try {
      const out = await summarizeMeeting({ data: { notes: text } });
      changeBlocks(loadBlocks({ blocks: [], content: out }));
      toast.success("Notulen dibuat dari poin-poin Anda");
    } catch (e) {
      toastError(e, "Gagal meringkas");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm("Pindahkan catatan ini ke Tempat Sampah?")) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await actions.remove(note.id);
    navigate({ to: "/notes" });
  }

  return (
    <PageContainer className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <article className="min-w-0">
        <div className="mb-4 flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/notes">
              <ArrowLeft /> Catatan
            </Link>
          </Button>
          <div className="flex items-center gap-1">
            <span className="mr-2 text-[11px] text-muted-foreground">
              {saving === "idle" ? "Tersimpan" : saving === "saving" ? "Menyimpan…" : "Mengetik…"}
            </span>
            {collaboration.peers.length > 0 && (
              <span className="hidden items-center gap-1 text-xs text-success sm:flex">
                <Users className="h-3.5 w-3.5" /> {collaboration.peers.length + 1} aktif
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHistoryOpen(true)}
              aria-label="Riwayat versi"
            >
              <History />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => actions.update(note.id, { pinned: !note.pinned })}
              aria-label="Sematkan"
            >
              <Pin className={cn(note.pinned && "fill-current text-primary")} />
            </Button>
            <Button variant="ghost" size="sm" onClick={summarize} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              <span className="hidden sm:inline">Buat notulen</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                if (timer.current) clearTimeout(timer.current);
                timer.current = null;
                await actions.archive(note.id);
                navigate({ to: "/notes" });
              }}
              aria-label="Arsipkan catatan"
            >
              <Archive />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={remove}
              aria-label="Hapus catatan"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 />
            </Button>
          </div>
        </div>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            schedule();
          }}
          placeholder="Tanpa judul"
          className="mb-3 w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
          aria-label="Judul catatan"
        />
        <Properties
          props={props}
          onChange={(p) => {
            setProps(p);
            schedule();
          }}
        />
        <div
          className="relative mt-4"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            collaboration.publishCursor(event.clientX - rect.left, event.clientY - rect.top);
          }}
        >
          {collaboration.peers
            .filter((peer) => peer.x !== undefined && peer.y !== undefined)
            .map((peer) => (
              <div
                key={peer.id}
                className="pointer-events-none absolute z-40 flex items-center gap-1 text-[10px] text-primary"
                style={{ left: peer.x, top: peer.y }}
              >
                <span className="h-3 w-0.5 bg-primary" />
                {peer.label}
              </div>
            ))}
          <BlockEditor noteId={note.id} blocks={blocks} onChange={changeBlocks} />
        </div>

        <NoteLinksContext.Provider value={noteLinks}>
          <section className="mt-6 border-t pt-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Link2 className="h-4 w-4" /> Disebut di{" "}
              {linked.length > 0 && (
                <span className="font-normal text-muted-foreground">{linked.length}</span>
              )}
            </h2>
            {linked.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Belum ada catatan lain yang menautkan ke sini. Ketik <code>[[{note.title}]]</code>{" "}
                di catatan lain.
              </p>
            )}
            <ul className="space-y-3">
              {linked.map(({ note: n, snippets }) => (
                <li key={n.id} className="rounded-xl border bg-card p-3">
                  <Link
                    to="/notes/$noteId"
                    params={{ noteId: n.id }}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {n.title}
                  </Link>
                  {snippets.slice(0, 3).map((s, i) => (
                    <p key={i} className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      <InlineText text={s} index={index} />
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            {unlinked.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Disebut tanpa tautan ({unlinked.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {unlinked.map((n) => (
                    <li key={n.id}>
                      <Link
                        to="/notes/$noteId"
                        params={{ noteId: n.id }}
                        className="text-xs hover:underline"
                      >
                        {n.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </NoteLinksContext.Provider>
      </article>

      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Status</p>
            <Select
              value={note.status}
              onValueChange={(v) => actions.update(note.id, { status: v })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTE_STATUS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Proyek</p>
            <Select
              value={note.project_id ?? NONE}
              onValueChange={(v) => actions.update(note.id, { project_id: v === NONE ? null : v })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Tanpa proyek</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Tag</p>
            <TagInput value={note.tags} onChange={(tags) => actions.update(note.id, { tags })} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Diubah{" "}
            {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true, locale: localeId })}
          </p>
        </div>
        {outgoing.length > 0 && (
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Menautkan ke</p>
            <ul className="space-y-1">
              {outgoing.map((n) => (
                <li key={n.id}>
                  <Link
                    to="/notes/$noteId"
                    params={{ noteId: n.id }}
                    className="text-sm hover:text-primary"
                  >
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to="/graph" search={{ focus: note.id }}>
            <Network /> Lihat di peta
          </Link>
        </Button>
        <div className="rounded-xl border border-dashed p-4 text-[11px] leading-relaxed text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Pintasan</p>
          <p>
            <b>/</b> menu blok · <b>#</b> judul · <b>-</b> daftar · <b>[]</b> to-do · <b>&gt;</b>{" "}
            kutipan
          </p>
          <p>
            <b>[[</b> tautkan catatan · <b>((</b> referensi blok
          </p>
          <p>Tarik ⋮⋮ untuk memindah blok.</p>
          <p className="mt-1">
            Query: <code>TABLE rating FROM #buku WHERE rating &gt; 4</code>
          </p>
        </div>
      </aside>
      <VersionHistory
        note={note}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestore={(version) => {
          setTitle(version.title);
          setBlocks(version.blocks);
          // Replace the shared doc's content too, so connected peers see the restored version.
          collaboration.publishBlocks(version.blocks);
          latest.current = { title: version.title, blocks: version.blocks, props };
          void flush().then(() => {
            void qc.invalidateQueries({ queryKey: ["notes"] });
            toast.success("Versi dipulihkan");
          });
        }}
      />
    </PageContainer>
  );
}

function VersionHistory({
  note,
  open,
  onOpenChange,
  onRestore,
}: {
  note: NoteDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (version: { title: string; blocks: Block[] }) => void;
}) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["note-versions", note.id],
    enabled: open,
    // Snapshots are written by a DB trigger on save, so reload whenever the sheet opens.
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("note_versions")
        .select("*")
        .eq("note_id", note.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Riwayat versi</SheetTitle>
          <SheetDescription>
            Snapshot otomatis disimpan paling banyak setiap 10 menit.
          </SheetDescription>
        </SheetHeader>
        <ul className="mt-6 space-y-2">
          {isLoading && <li className="text-sm text-muted-foreground">Memuat…</li>}
          {data.map((version) => (
            <li key={version.id} className="rounded-md border p-3">
              <p className="text-sm font-medium">
                Versi {version.version_number} · {version.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(version.created_at).toLocaleString()}
              </p>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                {version.content}
              </p>
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={() => {
                  onRestore({
                    title: version.title,
                    blocks: loadBlocks({ blocks: version.blocks, content: version.content }),
                  });
                  onOpenChange(false);
                }}
              >
                Pulihkan
              </Button>
            </li>
          ))}
          {!isLoading && data.length === 0 && (
            <li className="text-sm text-muted-foreground">
              Belum ada snapshot. Riwayat pertama muncul setelah perubahan berikutnya.
            </li>
          )}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

function Properties({
  props,
  onChange,
}: {
  props: [string, string][];
  onChange: (p: [string, string][]) => void;
}) {
  return (
    <div className="space-y-1">
      {props.map(([k, v], i) => (
        <div key={i} className="group grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-2">
          <Input
            value={k}
            onChange={(e) => onChange(props.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))}
            placeholder="properti"
            className="h-8 border-transparent bg-transparent px-2 text-xs text-muted-foreground hover:border-input focus:border-input"
          />
          <Input
            value={v}
            onChange={(e) => onChange(props.map((p, j) => (j === i ? [p[0], e.target.value] : p)))}
            placeholder="nilai"
            className="h-8 border-transparent bg-transparent px-2 text-sm hover:border-input focus:border-input"
          />
          <button
            onClick={() => onChange(props.filter((_, j) => j !== i))}
            className="rounded p-1 text-muted-foreground opacity-60 hover:opacity-100"
            aria-label="Hapus properti"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...props, ["", ""]])}
        className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-3 w-3" /> Tambah properti{" "}
        <span className="text-muted-foreground/70">(mis. rating: 5, genre: fiksi)</span>
      </button>
    </div>
  );
}

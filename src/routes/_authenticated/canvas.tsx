import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Link2, Plus, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { getUid } from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/canvas")({
  head: () => ({
    meta: [
      { title: "Kanvas — Second Brain" },
      { name: "description", content: "Susun ide bebas dan hubungkan secara visual." },
      { property: "og:title", content: "Kanvas — Second Brain" },
      { property: "og:description", content: "Susun ide bebas dan hubungkan secara visual." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CanvasPage,
});

type Pos = { x: number; y: number };

function CanvasPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [local, setLocal] = useState<Record<string, Pos>>({});
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const { data: uid } = useQuery({ queryKey: ["uid"], queryFn: getUid });
  const { data: boards = [] } = useQuery({
    queryKey: ["canvas-boards", uid],
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvas_boards")
        .select("*")
        .eq("user_id", uid ?? "")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
  const board = boards[0];
  const { data: nodes = [] } = useQuery({
    queryKey: ["canvas-nodes", board?.id],
    enabled: Boolean(board),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvas_nodes")
        .select("*")
        .eq("board_id", board?.id ?? "");
      if (error) throw error;
      return data;
    },
  });
  const { data: edges = [] } = useQuery({
    queryKey: ["canvas-edges", board?.id],
    enabled: Boolean(board),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvas_edges")
        .select("*")
        .eq("board_id", board?.id ?? "");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setLocal({});
  }, [nodes]);
  const posOf = (n: { id: string; x: number; y: number }) => local[n.id] ?? { x: n.x, y: n.y };
  const own = (n: { user_id: string }) => n.user_id === uid;

  async function ensureBoard() {
    if (board) return board;
    const user_id = await getUid();
    const { data, error } = await supabase
      .from("canvas_boards")
      .insert({ user_id, title: "Kanvas utama" })
      .select()
      .single();
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["canvas-boards"] });
    return data;
  }
  async function addNode() {
    const current = await ensureBoard();
    const user_id = await getUid();
    const offset = (nodes.length % 10) * 24;
    const { error } = await supabase.from("canvas_nodes").insert({
      board_id: current.id,
      user_id,
      title: "Ide baru",
      content: "",
      x: 40 + offset,
      y: 40 + offset,
    });
    if (error) toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ["canvas-nodes"] });
  }
  async function updateNode(
    id: string,
    patch: { title?: string; content?: string; x?: number; y?: number },
  ) {
    const { error } = await supabase
      .from("canvas_nodes")
      .update(patch)
      .eq("id", id)
      .eq("user_id", uid ?? "");
    if (error) toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ["canvas-nodes"] });
  }
  async function connect() {
    const [sourceId, targetId] = selected;
    if (!board || !sourceId || !targetId) return;
    const user_id = await getUid();
    const { error } = await supabase
      .from("canvas_edges")
      .insert({ board_id: board.id, user_id, source_id: sourceId, target_id: targetId });
    if (error) toast.error(error.message);
    setSelected([]);
    await qc.invalidateQueries({ queryKey: ["canvas-edges"] });
  }
  async function removeNode(id: string) {
    await supabase
      .from("canvas_nodes")
      .delete()
      .eq("id", id)
      .eq("user_id", uid ?? "");
    setSelected((v) => v.filter((x) => x !== id));
    await qc.invalidateQueries({ queryKey: ["canvas-nodes"] });
    await qc.invalidateQueries({ queryKey: ["canvas-edges"] });
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    const el = area.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left + el.scrollLeft - d.dx);
    const y = Math.max(0, e.clientY - rect.top + el.scrollTop - d.dy);
    d.moved = true;
    setLocal((p) => ({ ...p, [d.id]: { x, y } }));
  }
  function onUp() {
    const d = drag.current;
    drag.current = null;
    const p = d ? local[d.id] : undefined;
    if (d?.moved && p) void updateNode(d.id, { x: Math.round(p.x), y: Math.round(p.y) });
  }

  const positions = useMemo(
    () =>
      new Map(
        nodes.map((n) => {
          const p = local[n.id] ?? { x: n.x, y: n.y };
          return [n.id, { x: p.x + n.width / 2, y: p.y + 60 }];
        }),
      ),
    [nodes, local],
  );

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Kanvas"
        subtitle="Seret kartu lewat pegangannya; pilih dua kartu untuk menghubungkan."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={connect} disabled={selected.length !== 2}>
              <Link2 /> Hubungkan
            </Button>
            <Button size="sm" onClick={addNode}>
              <Plus /> Kartu
            </Button>
          </div>
        }
      />
      <div
        ref={area}
        className="relative h-[70vh] min-h-[480px] touch-none overflow-auto rounded-md border bg-secondary/30"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="relative" style={{ width: 2400, height: 1600 }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {edges.map((edge) => {
              const a = positions.get(edge.source_id),
                b = positions.get(edge.target_id);
              return a && b ? (
                <line
                  key={edge.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className="stroke-primary/50"
                  strokeWidth="2"
                />
              ) : null;
            })}
          </svg>
          {nodes.map((node) => {
            const p = posOf(node);
            const mine = own(node);
            return (
              <article
                key={node.id}
                className={cn(
                  "absolute flex flex-col rounded-md border bg-card shadow-sm",
                  selected.includes(node.id) && "ring-2 ring-ring",
                )}
                style={{ left: p.x, top: p.y, width: node.width, minHeight: node.height }}
              >
                <div
                  className={cn(
                    "flex items-center gap-1 border-b px-2 py-1",
                    mine ? "cursor-grab active:cursor-grabbing" : "cursor-default",
                  )}
                  onPointerDown={(e) => {
                    if (!mine || (e.target as HTMLElement).closest("input,button")) return;
                    const el = area.current;
                    if (!el) return;
                    const rect = el.getBoundingClientRect();
                    drag.current = {
                      id: node.id,
                      dx: e.clientX - rect.left + el.scrollLeft - p.x,
                      dy: e.clientY - rect.top + el.scrollTop - p.y,
                      moved: false,
                    };
                    area.current?.setPointerCapture(e.pointerId);
                  }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("input,button")) return;
                    setSelected((v) =>
                      v.includes(node.id)
                        ? v.filter((x) => x !== node.id)
                        : [...v.slice(-1), node.id],
                    );
                  }}
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Input
                    defaultValue={node.title}
                    disabled={!mine}
                    onBlur={(e) =>
                      e.target.value !== node.title &&
                      updateNode(node.id, { title: e.target.value })
                    }
                    className="h-7 border-0 px-1 font-semibold shadow-none"
                  />
                  {mine && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeNode(node.id)}
                      aria-label="Hapus kartu"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <textarea
                  defaultValue={node.content}
                  disabled={!mine}
                  placeholder="Tulis ide…"
                  onBlur={(e) =>
                    e.target.value !== node.content &&
                    updateNode(node.id, { content: e.target.value })
                  }
                  className="min-h-24 flex-1 resize-none bg-transparent p-3 text-sm outline-none"
                />
              </article>
            );
          })}
        </div>
        {!nodes.length && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Unlink className="mb-2 h-7 w-7" />
            <p>Kanvas masih kosong.</p>
            <Button className="mt-3" size="sm" onClick={addNode}>
              <Plus /> Tambah ide pertama
            </Button>
          </div>
        )}
      </div>
    </PageContainer>
  );
}

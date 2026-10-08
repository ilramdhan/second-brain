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
import { RouteError } from "@/components/common/RouteError";
import { toastError } from "@/lib/errors";
import { usePreferences } from "@/lib/preferences";
import { pageHead } from "@/lib/page-head";
import {
  INTERACTIVE_SELECTOR,
  canConnect,
  exceedsDragThreshold,
  nextSelection,
  pairAction,
  removeEdge,
  selectionStatus,
} from "@/lib/canvas-selection";

export const Route = createFileRoute("/_authenticated/canvas")({
  head: (ctx) => pageHead(ctx, { title: "metaCanvasTitle", desc: "metaCanvasDesc" }),
  component: CanvasPage,
  errorComponent: RouteError,
});

type Pos = { x: number; y: number };
type CardDrag = {
  id: string;
  dx: number;
  dy: number;
  start: Pos;
  moved: boolean;
  canMove: boolean;
  additive: boolean;
};
type LinkDrag = { from: string; start: Pos; point: Pos; moved: boolean };

function CanvasPage() {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<LinkDrag | null>(null);
  const [local, setLocal] = useState<Record<string, Pos>>({});
  const drag = useRef<CardDrag | null>(null);
  // Set after a card/link drag ends so the click the browser fires next doesn't clear the selection.
  const suppressClick = useRef(false);
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
  const { data: nodesData } = useQuery({
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
  const nodes = nodesData ?? [];
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

  // Drop optimistic positions once fresh nodes arrive (adjusted during render, not in an effect).
  // Compare the raw query data: a `= []` default would be a new array on every render.
  const [localFor, setLocalFor] = useState(nodesData);
  if (localFor !== nodesData) {
    setLocalFor(nodesData);
    setLocal({});
  }
  const posOf = (n: { id: string; x: number; y: number }) => local[n.id] ?? { x: n.x, y: n.y };
  const own = (n: { user_id: string }) => n.user_id === uid;

  async function ensureBoard() {
    if (board) return board;
    const user_id = await getUid();
    const { data, error } = await supabase
      .from("canvas_boards")
      .insert({ user_id, title: t("noteCanvasDefaultBoard") })
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
      title: t("noteCanvasNewIdea"),
      content: "",
      x: 40 + offset,
      y: 40 + offset,
    });
    if (error) toastError(error);
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
    if (error) toastError(error);
    await qc.invalidateQueries({ queryKey: ["canvas-nodes"] });
  }
  /** Insert an edge unless it is a self-link or already exists (in either direction). */
  async function createEdge(sourceId: string | undefined, targetId: string | undefined) {
    const check = canConnect(edges, sourceId, targetId);
    if (!check.ok) {
      if (check.reason === "duplicate") toast(t("noteCanvasAlreadyLinked"));
      return false;
    }
    if (!board || !sourceId || !targetId) return false;
    const user_id = await getUid();
    const { error } = await supabase
      .from("canvas_edges")
      .insert({ board_id: board.id, user_id, source_id: sourceId, target_id: targetId });
    if (error) {
      toastError(error);
      return false;
    }
    setMessage(t("noteCanvasConnected"));
    await qc.invalidateQueries({ queryKey: ["canvas-edges"] });
    return true;
  }
  async function deleteEdge(id: string) {
    setSelectedEdge(null);
    qc.setQueryData<typeof edges>(["canvas-edges", board?.id], (old) =>
      old ? removeEdge(old, id) : old,
    );
    const { error } = await supabase.from("canvas_edges").delete().eq("id", id);
    if (error) toastError(error);
    else setMessage(t("noteCanvasEdgeRemoved"));
    await qc.invalidateQueries({ queryKey: ["canvas-edges"] });
  }
  /** Toolbar button: connect two unlinked cards, or unlink two already-linked cards. */
  async function connectOrUnlink() {
    const action = pairAction(edges, selected);
    if (action.kind === "connect") {
      if (await createEdge(action.source, action.target)) setSelected([]);
    } else if (action.kind === "unlink") {
      await deleteEdge(action.edgeId);
      setSelected([]);
    }
  }
  async function removeNode(id: string) {
    // Attached edges go with the card: canvas_edges.source_id/target_id are ON DELETE CASCADE.
    await supabase
      .from("canvas_nodes")
      .delete()
      .eq("id", id)
      .eq("user_id", uid ?? "");
    setSelected((v) => v.filter((x) => x !== id));
    await qc.invalidateQueries({ queryKey: ["canvas-nodes"] });
    await qc.invalidateQueries({ queryKey: ["canvas-edges"] });
  }

  function select(id: string, additive: boolean) {
    setSelectedEdge(null);
    setMessage("");
    setSelected((v) => nextSelection(v, id, { additive }));
  }
  function selectEdge(id: string | null) {
    setSelected([]);
    setMessage("");
    setSelectedEdge(id);
  }
  function clearAll() {
    drag.current = null;
    setLink(null);
    setSelected([]);
    setSelectedEdge(null);
    setMessage("");
  }

  /** Pointer position in board coordinates (accounts for the scroll offset). */
  function boardPoint(e: { clientX: number; clientY: number }): Pos | null {
    const el = area.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left + el.scrollLeft, y: e.clientY - rect.top + el.scrollTop };
  }

  function onCardPointerDown(e: React.PointerEvent, id: string, p: Pos, mine: boolean) {
    if (e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    const pt = boardPoint(e);
    if (!pt) return;
    drag.current = {
      id,
      dx: pt.x - p.x,
      dy: pt.y - p.y,
      start: { x: e.clientX, y: e.clientY },
      moved: false,
      canMove: mine,
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
    };
    area.current?.setPointerCapture(e.pointerId);
  }
  function onHandlePointerDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = boardPoint(e);
    if (!pt) return;
    setSelectedEdge(null);
    setLink({ from: id, start: { x: e.clientX, y: e.clientY }, point: pt, moved: false });
    area.current?.setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent) {
    if (link) {
      const pt = boardPoint(e);
      if (!pt) return;
      const moved = link.moved || exceedsDragThreshold(link.start, { x: e.clientX, y: e.clientY });
      setLink({ ...link, point: pt, moved });
      return;
    }
    const d = drag.current;
    if (!d || !d.canMove) return;
    // Small jitter while clicking stays a click; only real movement starts a drag.
    if (!d.moved && !exceedsDragThreshold(d.start, { x: e.clientX, y: e.clientY })) return;
    const pt = boardPoint(e);
    if (!pt) return;
    d.moved = true;
    setLocal((prev) => ({
      ...prev,
      [d.id]: { x: Math.max(0, pt.x - d.dx), y: Math.max(0, pt.y - d.dy) },
    }));
  }
  function onUp(e: React.PointerEvent) {
    suppressClick.current = Boolean(link || drag.current);
    if (link) {
      setLink(null);
      if (!link.moved) {
        // A tap on the handle adds the card to the selection (two taps → Connect/Unlink).
        select(link.from, true);
        return;
      }
      const hit = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-canvas-node]");
      const target = hit?.dataset["canvasNode"];
      if (target && target !== link.from) void createEdge(link.from, target);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const p = local[d.id];
    if (d.moved) {
      if (p) void updateNode(d.id, { x: Math.round(p.x), y: Math.round(p.y) });
    } else {
      select(d.id, d.additive);
    }
  }
  function onCancel() {
    drag.current = null;
    setLink(null);
  }

  // Escape clears the selection / cancels a link drag; Delete or Backspace removes the selected line.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input,textarea,select,[contenteditable='true'],[role='dialog']")) return;
      if (e.key === "Escape") {
        clearAll();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge) {
        e.preventDefault();
        void deleteEdge(selectedEdge);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? "";
  const action = pairAction(edges, selected);
  const selStatus = selectionStatus(selected.length);
  const status = selectedEdge
    ? t("noteCanvasEdgeSelected")
    : action.kind === "unlink"
      ? t("noteCanvasPairLinked")
      : selStatus === "needOne"
        ? t("noteCanvasPickOneMore")
        : selStatus === "count"
          ? t("noteCanvasSelectedCount", { count: selected.length })
          : message;
  const linkFrom = link?.moved ? positions.get(link.from) : undefined;

  return (
    <PageContainer size="wide">
      <PageHeader
        title={t("canvas")}
        subtitle={t("noteCanvasSubtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            {selectedEdge ? (
              <Button variant="outline" size="sm" onClick={() => deleteEdge(selectedEdge)}>
                <Unlink /> {t("noteCanvasUnlink")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={connectOrUnlink}
                disabled={action.kind === "none"}
              >
                {action.kind === "unlink" ? (
                  <>
                    <Unlink /> {t("noteCanvasUnlink")}
                  </>
                ) : (
                  <>
                    <Link2 /> {t("noteCanvasConnect")}
                  </>
                )}
              </Button>
            )}
            <Button size="sm" onClick={addNode}>
              <Plus /> {t("noteCanvasCard")}
            </Button>
          </div>
        }
      />
      <p role="status" aria-live="polite" className="mb-2 min-h-5 text-sm text-muted-foreground">
        {status}
      </p>
      <div
        ref={area}
        className="relative h-[70vh] min-h-[480px] touch-none overflow-auto rounded-md border bg-secondary/30"
        onPointerDownCapture={() => {
          suppressClick.current = false;
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if ((e.target as Element).closest("[data-canvas-node],[data-canvas-edge]")) return;
          setSelected([]);
          setSelectedEdge(null);
        }}
      >
        <div className="relative" style={{ width: 2400, height: 1600 }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {edges.map((edge) => {
              const a = positions.get(edge.source_id),
                b = positions.get(edge.target_id);
              if (!a || !b) return null;
              const active = selectedEdge === edge.id;
              const toggle = () => selectEdge(active ? null : edge.id);
              return (
                <g key={edge.id} data-canvas-edge={edge.id}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={active ? "stroke-primary" : "stroke-primary/50"}
                    strokeWidth={active ? 4 : 2}
                  />
                  {/* Wide transparent stroke: an easy click/tap target for a 2px line. */}
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="transparent"
                    strokeWidth={20}
                    className="cursor-pointer outline-none focus-visible:stroke-ring/40"
                    style={{ pointerEvents: "stroke" }}
                    tabIndex={0}
                    role="button"
                    aria-pressed={active}
                    aria-label={t("noteCanvasEdgeLabel", {
                      from: titleOf(edge.source_id),
                      to: titleOf(edge.target_id),
                    })}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                      }
                    }}
                  />
                </g>
              );
            })}
            {link && linkFrom && (
              <line
                x1={linkFrom.x}
                y1={linkFrom.y}
                x2={link.point.x}
                y2={link.point.y}
                className="stroke-primary"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            )}
          </svg>
          {nodes.map((node) => {
            const p = posOf(node);
            const mine = own(node);
            const isSelected = selected.includes(node.id);
            return (
              <article
                key={node.id}
                data-canvas-node={node.id}
                tabIndex={0}
                aria-label={t(isSelected ? "noteCanvasCardSelected" : "noteCanvasCardLabel", {
                  title: node.title,
                })}
                className={cn(
                  "absolute flex flex-col rounded-md border bg-card shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  mine ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                  isSelected && "ring-2 ring-ring focus-visible:ring-ring",
                  link?.moved && link.from !== node.id && "hover:ring-2 hover:ring-primary/60",
                )}
                style={{ left: p.x, top: p.y, width: node.width, minHeight: node.height }}
                onPointerDown={(e) => onCardPointerDown(e, node.id, p, mine)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    select(node.id, e.shiftKey || e.metaKey || e.ctrlKey);
                  }
                }}
              >
                <div className="flex items-center gap-1 border-b px-2 py-1">
                  <GripVertical
                    aria-hidden
                    className={cn(
                      "h-4 w-4 shrink-0",
                      mine ? "text-muted-foreground" : "text-muted-foreground/40",
                    )}
                  />
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
                      className="tap-target h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeNode(node.id)}
                      aria-label={t("noteCanvasDeleteCard")}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <textarea
                  defaultValue={node.content}
                  disabled={!mine}
                  placeholder={t("noteCanvasIdeaPlaceholder")}
                  onBlur={(e) =>
                    e.target.value !== node.content &&
                    updateNode(node.id, { content: e.target.value })
                  }
                  className="min-h-24 flex-1 resize-none bg-transparent p-3 text-sm outline-none"
                />
                {/* Connect handle: drag onto another card to link it; tap or Enter adds the card to the selection. */}
                <button
                  type="button"
                  className="tap-target absolute top-1/2 -right-3 flex h-6 w-6 -translate-y-1/2 cursor-crosshair touch-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("noteCanvasConnectHandle", { title: node.title })}
                  onPointerDown={(e) => onHandlePointerDown(e, node.id)}
                  onClick={(e) => {
                    // Pointer presses are handled in onUp; detail === 0 means keyboard activation.
                    if (e.detail === 0) select(node.id, true);
                  }}
                >
                  <span className="h-3 w-3 rounded-full border-2 border-primary bg-card" />
                </button>
              </article>
            );
          })}
        </div>
        {!nodes.length && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Unlink className="mb-2 h-7 w-7" />
            <p>{t("noteCanvasEmpty")}</p>
            <Button className="mt-3" size="sm" onClick={addNode}>
              <Plus /> {t("noteCanvasFirstIdea")}
            </Button>
          </div>
        )}
      </div>
    </PageContainer>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Minus, Plus, RotateCcw } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { noteGraph } from "@/lib/blocks";
import { useNoteBlocks, useProjects } from "@/lib/data";
import { color } from "@/lib/constants";
import { PageContainer } from "@/components/common/PageContainer";

export const Route = createFileRoute("/_authenticated/graph")({
  validateSearch: (s: Record<string, unknown>) => ({
    focus: typeof s["focus"] === "string" ? (s["focus"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Peta Pengetahuan — Second Brain" },
      {
        name: "description",
        content: "Graf interaktif hubungan antar catatan dari tautan dua arah dan referensi blok.",
      },
      { property: "og:title", content: "Peta Pengetahuan — Second Brain" },
      { property: "og:description", content: "Temukan koneksi tersembunyi antar ide Anda." },
    ],
  }),
  component: GraphPage,
});

type N = SimulationNodeDatum & {
  id: string;
  title: string;
  degree: number;
  tags: string[];
  project: string | null;
};
type L = SimulationLinkDatum<N>;

const W = 1000,
  H = 700;
const MIN_Z = 0.3,
  MAX_Z = 4;

function GraphPage() {
  const { focus } = Route.useSearch();
  const navigate = useNavigate();
  // Edges come from [[links]]/((refs)) inside blocks, so this route loads note bodies.
  const { data: notes = [] } = useNoteBlocks();
  const { data: projects = [] } = useProjects();
  const [tag, setTag] = useState("all");
  const [q, setQ] = useState("");
  const [orphans, setOrphans] = useState(true);
  const [hover, setHover] = useState<string | null>(focus ?? null);
  const [, tick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<N>> | null>(null);
  const nodesRef = useRef<N[]>([]);
  const linksRef = useRef<L[]>([]);

  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);
  const graph = useMemo(() => {
    const edges = noteGraph(notes);
    const scoped = notes.filter((n) => tag === "all" || n.tags.includes(tag));
    const ids = new Set(scoped.map((n) => n.id));
    const es = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const deg = new Map<string, number>();
    es.forEach((e) => {
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
      deg.set(e.source, (deg.get(e.source) ?? 0) + 0.5);
    });
    const nodes = scoped
      .filter((n) => orphans || deg.has(n.id))
      .map((n) => ({
        id: n.id,
        title: n.title,
        degree: deg.get(n.id) ?? 0,
        tags: n.tags,
        project: n.project_id,
      }));
    return {
      nodes,
      edges: es.filter(
        (e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target),
      ),
    };
  }, [notes, tag, orphans]);

  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: N[] = graph.nodes.map((n) => ({
      ...n,
      x: prev.get(n.id)?.x ?? W / 2 + (Math.random() - 0.5) * 200,
      y: prev.get(n.id)?.y ?? H / 2 + (Math.random() - 0.5) * 200,
    }));
    const links: L[] = graph.edges.map((e) => ({ source: e.source, target: e.target }));
    nodesRef.current = nodes;
    linksRef.current = links;
    simRef.current?.stop();
    const sim = forceSimulation<N>(nodes)
      .force(
        "link",
        forceLink<N, L>(links)
          .id((d) => d.id)
          .distance(90)
          .strength(0.6),
      )
      .force("charge", forceManyBody().strength(-180))
      .force("center", forceCenter(W / 2, H / 2))
      .force(
        "collide",
        forceCollide<N>().radius((d) => radius(d) + 6),
      )
      .on("tick", () => tick((t) => t + 1));
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [graph]);

  // Non-passive wheel zoom anchored at cursor.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const k = Math.min(MAX_Z, Math.max(MIN_Z, v.k * Math.exp(-dy * 0.0015)));
      const r = el.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W,
        py = ((e.clientY - r.top) / r.height) * H;
      const f = k / v.k;
      setView({ k, x: px - (px - v.x) * f, y: py - (py - v.y) * f });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{
    kind: "pan" | "node";
    id?: string | undefined;
    sx: number;
    sy: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);
  const toSvg = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (((cx - r.left) / r.width) * W - v.x) / v.k,
      y: (((cy - r.top) / r.height) * H - v.y) / v.k,
    };
  };
  function onDown(e: React.PointerEvent, id?: string) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      kind: id ? "node" : "pan",
      id,
      sx: e.clientX,
      sy: e.clientY,
      vx: view.x,
      vy: view.y,
      moved: false,
    };
    if (id) simRef.current?.alphaTarget(0.3).restart();
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    if (d.kind === "pan") {
      const r = svgRef.current!.getBoundingClientRect();
      setView((v) => ({
        ...v,
        x: d.vx + ((e.clientX - d.sx) / r.width) * W,
        y: d.vy + ((e.clientY - d.sy) / r.height) * H,
      }));
    } else {
      const n = nodesRef.current.find((x) => x.id === d.id);
      if (n) {
        const p = toSvg(e.clientX, e.clientY);
        n.fx = p.x;
        n.fy = p.y;
      }
    }
  }
  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "node") {
      simRef.current?.alphaTarget(0);
      const n = nodesRef.current.find((x) => x.id === d.id);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
      if (!d.moved && d.id) navigate({ to: "/notes/$noteId", params: { noteId: d.id } });
    }
  }
  const zoomBy = (f: number) =>
    setView((v) => {
      const k = Math.min(MAX_Z, Math.max(MIN_Z, v.k * f));
      const g = k / v.k;
      return { k, x: W / 2 - (W / 2 - v.x) * g, y: H / 2 - (H / 2 - v.y) * g };
    });

  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (!hover) return s;
    graph.edges.forEach((e) => {
      if (e.source === hover) s.add(e.target);
      if (e.target === hover) s.add(e.source);
    });
    return s;
  }, [hover, graph.edges]);
  const match = q.trim().toLowerCase();

  return (
    <PageContainer>
      <PageHeader
        title="Peta Pengetahuan"
        subtitle="Setiap titik adalah catatan; garis adalah tautan [[…]] atau referensi blok. Semakin besar, semakin sering dirujuk."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sorot catatan…"
          className="h-9 w-full sm:w-56"
        />
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="h-9 w-auto min-w-[9rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua tag</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t} value={t}>
                #{t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={orphans} onCheckedChange={setOrphans} /> Tampilkan yang tanpa tautan
        </label>
        <div className="ml-auto flex gap-1">
          <Button variant="outline" size="icon" onClick={() => zoomBy(1.25)} aria-label="Perbesar">
            <Plus />
          </Button>
          <Button variant="outline" size="icon" onClick={() => zoomBy(0.8)} aria-label="Perkecil">
            <Minus />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setView({ x: 0, y: 0, k: 1 })}
            aria-label="Reset"
          >
            <RotateCcw />
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-[65vh] w-full cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={(e) => onDown(e)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        >
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {linksRef.current.map((l, i) => {
              const s = l.source as N,
                t = l.target as N;
              if (typeof s !== "object" || typeof t !== "object") return null;
              const lit = hover && (s.id === hover || t.id === hover);
              return (
                <line
                  key={i}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  className={lit ? "stroke-primary" : "stroke-border"}
                  strokeWidth={lit ? 1.8 : 1}
                />
              );
            })}
            {nodesRef.current.map((n) => {
              const dim =
                (hover && n.id !== hover && !neighbors.has(n.id)) ||
                (match && !n.title.toLowerCase().includes(match));
              const proj = projects.find((p) => p.id === n.project);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                  className="cursor-pointer"
                  opacity={dim ? 0.2 : 1}
                  onPointerDown={(e) => onDown(e, n.id)}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(focus ?? null)}
                >
                  <circle
                    r={radius(n)}
                    className={
                      proj
                        ? color(proj.color).dot.replace("bg-", "fill-")
                        : n.id === focus
                          ? "fill-primary"
                          : "fill-muted-foreground/70"
                    }
                  />
                  {(n.degree > 0 || view.k > 1.3 || n.id === hover) && (
                    <text
                      y={radius(n) + 12}
                      textAnchor="middle"
                      className="fill-foreground text-[11px]"
                      style={{ pointerEvents: "none" }}
                    >
                      {n.title.length > 28 ? n.title.slice(0, 27) + "…" : n.title}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {graph.nodes.length} catatan · {graph.edges.length} tautan · gulir untuk zoom, tarik latar
        untuk geser, klik titik untuk membuka.
      </p>
    </PageContainer>
  );
}

function radius(n: { degree: number }) {
  return 5 + Math.min(16, Math.sqrt(n.degree) * 4);
}

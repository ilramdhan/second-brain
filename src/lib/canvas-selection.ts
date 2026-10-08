/**
 * Pure selection and edge logic for the canvas page (`/canvas`).
 *
 * Canvas edges are stored as `source_id → target_id`, but they are drawn as plain lines with no
 * arrow, so the UI treats them as undirected: A–B and B–A are the same link.
 */

export type CanvasEdgeLike = { id: string; source_id: string; target_id: string };

/** Pointer travel (px) after which a press counts as a drag, not a click. */
export const DRAG_THRESHOLD = 4;

/** Selector for elements inside a card that keep their own click behaviour. */
export const INTERACTIVE_SELECTOR = "input,textarea,button,a,select,[contenteditable='true']";

/** True when the pointer moved far enough from where it went down to count as a drag. */
export function exceedsDragThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = DRAG_THRESHOLD,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold;
}

/**
 * Next selection after clicking (or pressing Space/Enter on) a card.
 * - `additive` (Shift/Cmd/Ctrl): toggle the card in the selection.
 * - plain: select only this card; clicking the sole selected card clears it.
 * - `dragged`: the click ended a drag, so the selection stays unchanged.
 */
export function nextSelection(
  current: readonly string[],
  id: string,
  opts: { additive?: boolean; dragged?: boolean } = {},
): string[] {
  if (opts.dragged) return [...current];
  if (opts.additive) {
    return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  }
  return current.length === 1 && current[0] === id ? [] : [id];
}

/** Undirected key for a pair of node ids. */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** True when an edge between `a` and `b` (in either direction) already exists. */
export function hasEdge(edges: readonly CanvasEdgeLike[], a: string, b: string): boolean {
  const key = edgeKey(a, b);
  return edges.some((e) => edgeKey(e.source_id, e.target_id) === key);
}

export type ConnectCheck = { ok: true } | { ok: false; reason: "self" | "duplicate" | "missing" };

/** Validate a new link: rejects self-links, duplicates (both directions) and missing ids. */
export function canConnect(
  edges: readonly CanvasEdgeLike[],
  source: string | undefined,
  target: string | undefined,
): ConnectCheck {
  if (!source || !target) return { ok: false, reason: "missing" };
  if (source === target) return { ok: false, reason: "self" };
  if (hasEdge(edges, source, target)) return { ok: false, reason: "duplicate" };
  return { ok: true };
}

/** The edge between `a` and `b` (either direction), if any. */
export function findEdge<E extends CanvasEdgeLike>(
  edges: readonly E[],
  a: string | undefined,
  b: string | undefined,
): E | undefined {
  if (!a || !b || a === b) return undefined;
  const key = edgeKey(a, b);
  return edges.find((e) => edgeKey(e.source_id, e.target_id) === key);
}

export type PairAction =
  | { kind: "none" }
  | { kind: "connect"; source: string; target: string }
  | { kind: "unlink"; edgeId: string };

/**
 * What the Connect/Unlink toolbar button does for the current selection: exactly two cards that
 * are not linked → connect; two cards already linked → unlink that edge; anything else → nothing.
 */
export function pairAction(
  edges: readonly CanvasEdgeLike[],
  selected: readonly string[],
): PairAction {
  if (selected.length !== 2) return { kind: "none" };
  const [a, b] = selected as [string, string];
  if (a === b) return { kind: "none" };
  const existing = findEdge(edges, a, b);
  return existing
    ? { kind: "unlink", edgeId: existing.id }
    : { kind: "connect", source: a, target: b };
}

/** Edges without the one with `id` (local/optimistic removal). */
export function removeEdge<E extends CanvasEdgeLike>(edges: readonly E[], id: string): E[] {
  return edges.filter((e) => e.id !== id);
}

/** Selection status shown above the board: nothing, "pick one more", or "N selected". */
export function selectionStatus(count: number): "none" | "needOne" | "count" {
  if (count <= 0) return "none";
  if (count === 1) return "needOne";
  return "count";
}

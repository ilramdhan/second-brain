import * as Y from "yjs";
import type { Block, BlockType } from "@/lib/blocks";

/**
 * Granular Yjs model of a note's blocks (Phase 4.3).
 *
 * The document holds one `Y.Array` named `blocks`; every element is a `Y.Map` with `id`, `type`,
 * `checked` and `text` (a `Y.Text`). A keystroke therefore produces an update that only touches
 * one block's `Y.Text` (a few bytes) instead of re-sending the whole note as JSON, and concurrent
 * edits to different blocks (or different parts of one block) merge instead of overwriting each
 * other. `notes.blocks` stays the durable state; this doc only lives while peers are connected.
 */

export const BLOCKS_KEY = "blocks";
type YBlock = Y.Map<unknown>;

export const blocksArray = (doc: Y.Doc) => doc.getArray<YBlock>(BLOCKS_KEY);

function toYBlock(block: Block): YBlock {
  const map = new Y.Map<unknown>();
  map.set("id", block.id);
  map.set("type", block.type);
  if (block.checked !== undefined) map.set("checked", block.checked);
  map.set("text", new Y.Text(block.text));
  return map;
}

function fromYBlock(map: YBlock): Block {
  const text = map.get("text");
  const block: Block = {
    id: String(map.get("id") ?? ""),
    type: (map.get("type") as BlockType) ?? "p",
    text: text instanceof Y.Text ? text.toString() : typeof text === "string" ? text : "",
  };
  const checked = map.get("checked");
  if (typeof checked === "boolean") block.checked = checked;
  return block;
}

/** Current blocks of the doc as plain objects. */
export function docToBlocks(doc: Y.Doc): Block[] {
  return blocksArray(doc)
    .toArray()
    .map(fromYBlock)
    .filter((b) => b.id);
}

/** Apply a text change to a `Y.Text` as one delete + insert around the common prefix/suffix. */
function patchText(text: Y.Text, next: string) {
  const prev = text.toString();
  if (prev === next) return;
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < max - start &&
    prev.charCodeAt(prev.length - 1 - end) === next.charCodeAt(next.length - 1 - end)
  )
    end++;
  const removed = prev.length - start - end;
  if (removed > 0) text.delete(start, removed);
  const inserted = next.slice(start, next.length - end);
  if (inserted) text.insert(start, inserted);
}

function patchBlock(map: YBlock, block: Block) {
  if (map.get("type") !== block.type) map.set("type", block.type);
  const checked = map.get("checked");
  if (block.checked === undefined) {
    if (checked !== undefined) map.delete("checked");
  } else if (checked !== block.checked) map.set("checked", block.checked);
  const text = map.get("text");
  if (text instanceof Y.Text) patchText(text, block.text);
  else map.set("text", new Y.Text(block.text));
}

/** Indices (into `seq`) of one longest strictly increasing subsequence. */
function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < seq[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) keep.add(i);
  return keep;
}

/**
 * Make the doc's blocks equal to `blocks` with the smallest practical set of operations: removed
 * blocks are deleted, blocks that keep their relative order are patched in place (text as a
 * delta), and only moved or new blocks are (re)inserted. Runs in one transaction with `origin`.
 */
export function applyBlocksToDoc(doc: Y.Doc, blocks: Block[], origin: unknown = null) {
  const arr = blocksArray(doc);
  doc.transact(() => {
    const target = new Map<string, number>();
    blocks.forEach((b, i) => {
      if (!target.has(b.id)) target.set(b.id, i);
    });
    // 1. Delete blocks that are gone (and duplicate ids), from the end so indices stay valid.
    const seen = new Set<string>();
    const current = arr.toArray().map((m) => String(m.get("id") ?? ""));
    const drop: number[] = [];
    current.forEach((id, i) => {
      if (!target.has(id) || seen.has(id)) drop.push(i);
      else seen.add(id);
    });
    for (let k = drop.length - 1; k >= 0; k--) arr.delete(drop[k]!, 1);
    // 2. Keep the longest run that is already in the right order; everything else moves.
    const kept = arr.toArray().map((m) => String(m.get("id")));
    const keep = longestIncreasing(kept.map((id) => target.get(id)!));
    for (let i = kept.length - 1; i >= 0; i--) if (!keep.has(i)) arr.delete(i, 1);
    // 3. Walk the target order: patch kept blocks, insert new/moved ones.
    const unique = blocks.filter((b, i) => target.get(b.id) === i);
    unique.forEach((block, i) => {
      const existing = i < arr.length ? arr.get(i) : undefined;
      if (existing && existing.get("id") === block.id) patchBlock(existing, block);
      else arr.insert(i, [toYBlock(block)]);
    });
  }, origin);
}

/**
 * Remove later copies of a block id. Two peers that seeded the doc from different saved versions
 * (rare: simultaneous join with a stale cache) would otherwise show every block twice. Item order
 * converges across peers, so every peer deletes the same copies and the result is consistent.
 */
export function dedupeBlocks(doc: Y.Doc, origin: unknown = null): boolean {
  const arr = blocksArray(doc);
  const seen = new Set<string>();
  const drop: number[] = [];
  arr.toArray().forEach((m, i) => {
    const id = String(m.get("id") ?? "");
    if (seen.has(id)) drop.push(i);
    else seen.add(id);
  });
  if (!drop.length) return false;
  doc.transact(() => {
    for (let k = drop.length - 1; k >= 0; k--) arr.delete(drop[k]!, 1);
  }, origin);
  return true;
}

/** FNV-1a, 32-bit. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Initial state of the doc as a Yjs update, written with a client id derived from the note and its
 * content. Peers that load the same saved blocks produce byte-identical seeds, so two peers that
 * join at the same moment (and both seed) merge without duplicating the note.
 */
export function seedUpdate(noteId: string, blocks: Block[]): Uint8Array {
  const seed = new Y.Doc();
  seed.clientID = hash(`${noteId}:${JSON.stringify(blocks)}`) || 1;
  applyBlocksToDoc(seed, blocks);
  const update = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  return update;
}

/** Reuse block objects whose content did not change, so memoized block rows skip re-rendering. */
export function reuseUnchanged(prev: Block[], next: Block[]): Block[] {
  const byId = new Map(prev.map((b) => [b.id, b]));
  return next.map((b) => {
    const old = byId.get(b.id);
    return old && old.type === b.type && old.text === b.text && old.checked === b.checked ? old : b;
  });
}

/**
 * Deterministic autosave leader: the lowest presence key among the peers running this protocol
 * version, self included. Alone (or before presence has synced) a peer is always its own leader;
 * when the leader leaves, the next-lowest peer takes over on the next presence sync.
 */
export function electLeader(selfId: string, peerIds: Iterable<string>): string {
  let leader = selfId;
  for (const id of peerIds) if (id && id < leader) leader = id;
  return leader;
}

/** Base64 for Uint8Array without spreading large arrays onto the call stack. */
export function encodeUpdate(value: Uint8Array): string {
  let out = "";
  for (let i = 0; i < value.length; i += 0x8000)
    out += String.fromCharCode(...value.subarray(i, i + 0x8000));
  return btoa(out);
}

export const decodeUpdate = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Block } from "@/lib/blocks";
import {
  applyBlocksToDoc,
  decodeUpdate,
  dedupeBlocks,
  docToBlocks,
  electLeader,
  encodeUpdate,
  reuseUnchanged,
  seedUpdate,
} from "./note-ydoc";

const b = (id: string, text: string, extra: Partial<Block> = {}): Block => ({
  id,
  type: "p",
  text,
  ...extra,
});

/** Two docs wired together like two peers on the channel; `deliver` flushes queued updates. */
function pair() {
  const a = new Y.Doc();
  const c = new Y.Doc();
  const sent: { a: Uint8Array[]; c: Uint8Array[] } = { a: [], c: [] };
  a.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "remote") sent.a.push(u);
  });
  c.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "remote") sent.c.push(u);
  });
  const deliver = () => {
    for (const u of sent.a.splice(0)) Y.applyUpdate(c, u, "remote");
    for (const u of sent.c.splice(0)) Y.applyUpdate(a, u, "remote");
  };
  return { a, c, sent, deliver };
}

const [B1, B2, B3] = [
  b("1", "Halo dunia"),
  b("2", "Kedua", { type: "todo", checked: false }),
  b("3", ""),
] as const;
const initial: Block[] = [B1, B2, B3];

describe("note-ydoc", () => {
  it("round-trips blocks", () => {
    const doc = new Y.Doc();
    applyBlocksToDoc(doc, initial);
    expect(docToBlocks(doc)).toEqual(initial);
  });

  it("sends only a small delta for a keystroke in one block", () => {
    const { a, c, sent, deliver } = pair();
    const long = [...initial, b("4", "x".repeat(5000))];
    applyBlocksToDoc(a, long);
    deliver();
    expect(Y.encodeStateAsUpdate(a).length).toBeGreaterThan(5000);
    applyBlocksToDoc(
      a,
      long.map((x) => (x.id === "1" ? { ...x, text: "Halo dunia!" } : x)),
    );
    expect(sent.a).toHaveLength(1);
    expect(sent.a[0]?.length).toBeLessThan(40);
    deliver();
    expect(docToBlocks(c)[0]?.text).toBe("Halo dunia!");
  });

  it("does nothing when the blocks did not change", () => {
    const { a, sent, deliver } = pair();
    applyBlocksToDoc(a, initial);
    deliver();
    applyBlocksToDoc(
      a,
      initial.map((x) => ({ ...x })),
    );
    expect(sent.a).toHaveLength(0);
  });

  it("syncs insert, delete, reorder and prop changes", () => {
    const { a, c, deliver } = pair();
    applyBlocksToDoc(a, initial);
    deliver();
    const next = [
      b("3", "", { type: "h1" }),
      b("1", "Halo dunia"),
      b("9", "baru"),
      b("2", "Kedua", { type: "todo", checked: true }),
    ];
    applyBlocksToDoc(c, next);
    deliver();
    expect(docToBlocks(a)).toEqual(next);
    applyBlocksToDoc(a, [b("9", "baru")]);
    deliver();
    expect(docToBlocks(c)).toEqual([b("9", "baru")]);
  });

  it("converges on concurrent edits to the same and different blocks", () => {
    const { a, c, deliver } = pair();
    applyBlocksToDoc(a, initial);
    deliver();
    applyBlocksToDoc(a, [b("1", "Halo dunia A"), B2, b("3", "dari A")]);
    applyBlocksToDoc(c, [b("1", "C Halo dunia"), B2, B3, b("5", "blok C")]);
    deliver();
    const merged = docToBlocks(a);
    expect(merged).toEqual(docToBlocks(c));
    expect(merged[0]?.text).toBe("C Halo dunia A");
    expect(merged.find((x) => x.id === "3")?.text).toBe("dari A");
    expect(merged.some((x) => x.id === "5")).toBe(true);
  });

  it("converges when one peer deletes a block the other edits", () => {
    const { a, c, deliver } = pair();
    applyBlocksToDoc(a, initial);
    deliver();
    applyBlocksToDoc(a, [B1, B3]);
    applyBlocksToDoc(c, [B1, { ...B2, text: "Kedua!" }, B3]);
    deliver();
    expect(docToBlocks(a)).toEqual(docToBlocks(c));
  });

  it("replaces the whole content (version restore)", () => {
    const { a, c, deliver } = pair();
    applyBlocksToDoc(a, initial);
    deliver();
    const restored = [b("v1", "versi lama"), b("1", "Halo")];
    applyBlocksToDoc(c, restored);
    deliver();
    expect(docToBlocks(a)).toEqual(restored);
  });

  it("produces identical seeds so simultaneous joins do not duplicate", () => {
    const a = new Y.Doc();
    const c = new Y.Doc();
    Y.applyUpdate(a, seedUpdate("n1", initial));
    Y.applyUpdate(c, seedUpdate("n1", initial));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(c));
    expect(docToBlocks(a)).toEqual(initial);
  });

  it("dedupes block ids from divergent seeds consistently", () => {
    const a = new Y.Doc();
    const c = new Y.Doc();
    Y.applyUpdate(a, seedUpdate("n1", initial));
    Y.applyUpdate(c, seedUpdate("n1", [b("1", "beda")]));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(c));
    Y.applyUpdate(c, Y.encodeStateAsUpdate(a));
    dedupeBlocks(a);
    dedupeBlocks(c);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(c));
    Y.applyUpdate(c, Y.encodeStateAsUpdate(a));
    const ids = docToBlocks(a).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(docToBlocks(a)).toEqual(docToBlocks(c));
  });

  it("reuses unchanged block objects", () => {
    const next = reuseUnchanged(initial, [b("1", "Halo dunia"), b("2", "ubah")]);
    expect(next[0]).toBe(B1);
    expect(next[1]).not.toBe(B2);
  });

  it("encodes large updates without overflowing the stack", () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 256);
    expect(decodeUpdate(encodeUpdate(big))).toEqual(big);
  });
});

describe("electLeader", () => {
  it("is self when alone", () => {
    expect(electLeader("m", [])).toBe("m");
  });

  it("picks the same lowest id on every peer", () => {
    const ids = ["k", "c", "x"];
    for (const self of ids)
      expect(
        electLeader(
          self,
          ids.filter((id) => id !== self),
        ),
      ).toBe("c");
  });

  it("re-elects when the leader leaves", () => {
    expect(electLeader("k", ["c", "x"])).toBe("c");
    expect(electLeader("k", ["x"])).toBe("k");
  });
});

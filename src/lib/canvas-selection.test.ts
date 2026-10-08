import { describe, expect, it } from "vitest";

import {
  canConnect,
  edgeKey,
  exceedsDragThreshold,
  findEdge,
  hasEdge,
  nextSelection,
  pairAction,
  removeEdge,
  selectionStatus,
} from "./canvas-selection";

const edges = [
  { id: "e1", source_id: "a", target_id: "b" },
  { id: "e2", source_id: "b", target_id: "c" },
];

describe("nextSelection", () => {
  it("plain click selects only that card", () => {
    expect(nextSelection(["a", "b"], "c")).toEqual(["c"]);
    expect(nextSelection([], "a")).toEqual(["a"]);
  });

  it("plain click on the sole selected card clears it", () => {
    expect(nextSelection(["a"], "a")).toEqual([]);
  });

  it("plain click on one of several selected cards keeps just that one", () => {
    expect(nextSelection(["a", "b"], "a")).toEqual(["a"]);
  });

  it("additive click toggles", () => {
    expect(nextSelection(["a"], "b", { additive: true })).toEqual(["a", "b"]);
    expect(nextSelection(["a", "b"], "a", { additive: true })).toEqual(["b"]);
  });

  it("ignores the click that ends a drag", () => {
    expect(nextSelection(["a"], "b", { dragged: true })).toEqual(["a"]);
    expect(nextSelection(["a"], "a", { dragged: true, additive: true })).toEqual(["a"]);
  });
});

describe("exceedsDragThreshold", () => {
  it("treats small jitter as a click", () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 12, y: 13 })).toBe(false);
  });
  it("treats real movement as a drag", () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 20, y: 10 })).toBe(true);
  });
});

describe("edges", () => {
  it("edgeKey is direction-independent", () => {
    expect(edgeKey("a", "b")).toBe(edgeKey("b", "a"));
  });

  it("hasEdge matches both directions", () => {
    expect(hasEdge(edges, "b", "a")).toBe(true);
    expect(hasEdge(edges, "a", "c")).toBe(false);
  });

  it("canConnect rejects self-links, duplicates and missing ids", () => {
    expect(canConnect(edges, "a", "a")).toEqual({ ok: false, reason: "self" });
    expect(canConnect(edges, "a", "b")).toEqual({ ok: false, reason: "duplicate" });
    expect(canConnect(edges, "c", "b")).toEqual({ ok: false, reason: "duplicate" });
    expect(canConnect(edges, "a", undefined)).toEqual({ ok: false, reason: "missing" });
    expect(canConnect(edges, "a", "c")).toEqual({ ok: true });
  });

  it("removeEdge drops only the given edge", () => {
    expect(removeEdge(edges, "e1").map((e) => e.id)).toEqual(["e2"]);
    expect(removeEdge(edges, "nope")).toHaveLength(2);
  });
});

describe("findEdge / pairAction (link ↔ unlink toggle)", () => {
  it("finds an edge in either direction", () => {
    expect(findEdge(edges, "b", "a")?.id).toBe("e1");
    expect(findEdge(edges, "a", "c")).toBeUndefined();
    expect(findEdge(edges, "a", "a")).toBeUndefined();
  });

  it("offers connect for two unlinked cards", () => {
    expect(pairAction(edges, ["a", "c"])).toEqual({ kind: "connect", source: "a", target: "c" });
  });

  it("offers unlink for two linked cards, whatever the selection order", () => {
    expect(pairAction(edges, ["a", "b"])).toEqual({ kind: "unlink", edgeId: "e1" });
    expect(pairAction(edges, ["c", "b"])).toEqual({ kind: "unlink", edgeId: "e2" });
  });

  it("offers nothing unless exactly two distinct cards are selected", () => {
    expect(pairAction(edges, [])).toEqual({ kind: "none" });
    expect(pairAction(edges, ["a"])).toEqual({ kind: "none" });
    expect(pairAction(edges, ["a", "b", "c"])).toEqual({ kind: "none" });
  });

  it("connect then unlink round-trips", () => {
    const linked = [...edges, { id: "e3", source_id: "a", target_id: "c" }];
    const action = pairAction(linked, ["c", "a"]);
    expect(action).toEqual({ kind: "unlink", edgeId: "e3" });
    const after = removeEdge(linked, "e3");
    expect(pairAction(after, ["c", "a"]).kind).toBe("connect");
  });
});

describe("selectionStatus", () => {
  it("maps counts to status", () => {
    expect(selectionStatus(0)).toBe("none");
    expect(selectionStatus(1)).toBe("needOne");
    expect(selectionStatus(2)).toBe("count");
    expect(selectionStatus(3)).toBe("count");
  });
});

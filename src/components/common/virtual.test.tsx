import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VirtualList } from "@/components/common/VirtualList";
import {
  chunk,
  shouldVirtualize,
  VIRTUALIZE_THRESHOLD,
  withPinnedIndex,
} from "@/components/common/virtual";

describe("shouldVirtualize", () => {
  it("only windows lists longer than the threshold", () => {
    expect(VIRTUALIZE_THRESHOLD).toBe(200);
    expect(shouldVirtualize(0)).toBe(false);
    expect(shouldVirtualize(200)).toBe(false);
    expect(shouldVirtualize(201)).toBe(true);
    expect(shouldVirtualize(5, 4)).toBe(true);
  });
});

describe("chunk", () => {
  it("splits items into rows of the column count", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("withPinnedIndex", () => {
  it("keeps the focused row mounted and in list order", () => {
    expect(withPinnedIndex([5, 6, 7], 2, 10)).toEqual([2, 5, 6, 7]);
    expect(withPinnedIndex([5, 6, 7], 6, 10)).toEqual([5, 6, 7]);
    expect(withPinnedIndex([5, 6, 7], null, 10)).toEqual([5, 6, 7]);
    expect(withPinnedIndex([5, 6, 7], 12, 10)).toEqual([5, 6, 7]);
  });
});

describe("VirtualList", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => `item ${i}`);

  it("renders every row below the threshold", () => {
    render(
      <VirtualList items={items(50)} getKey={(s) => s} estimateSize={40} renderItem={(s) => s} />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(50);
  });

  it("mounts only a window of rows above the threshold", () => {
    render(
      <VirtualList items={items(1000)} getKey={(s) => s} estimateSize={40} renderItem={(s) => s} />,
    );
    const rendered = screen.queryAllByRole("listitem").length;
    expect(rendered).toBeLessThan(1000);
  });
});

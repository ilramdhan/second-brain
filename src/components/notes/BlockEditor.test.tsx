import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The editor module pulls in the data layer (Supabase client); these tests only
// exercise pure rendering, so stub it out.
vi.mock("@/lib/data", () => ({
  useNoteBlocks: () => ({ data: [] }),
  useNotes: () => ({ data: [] }),
  useProjects: () => ({ data: [] }),
  useTasks: () => ({ data: [] }),
  useNoteActions: () => ({ create: vi.fn() }),
}));

import { AutoTextarea, InlineText } from "./BlockEditor";
import { NoteLinksContext, noteTitleKey } from "./note-links";

describe("InlineText", () => {
  const index = new Map();

  it("marks wiki links by the shared title map and opens them on click", () => {
    const openTitle = vi.fn();
    const titles = new Map([[noteTitleKey("  Buku Favorit "), "n1"]]);
    render(
      <NoteLinksContext.Provider value={{ titles, openTitle }}>
        <InlineText text="lihat [[buku favorit|buku]] dan [[Belum Ada]]" index={index} />
      </NoteLinksContext.Provider>,
    );

    const existing = screen.getByRole("button", { name: "buku" });
    const missing = screen.getByRole("button", { name: "Belum Ada" });
    expect(existing).toHaveClass("text-primary");
    expect(missing).toHaveClass("decoration-dashed");

    fireEvent.click(missing);
    expect(openTitle).toHaveBeenCalledWith("Belum Ada");
  });

  it("still renders bold, code, urls and tags", () => {
    const { container } = render(
      <InlineText text="**tebal** `kode` https://example.com #tag" index={index} />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("tebal");
    expect(container.querySelector("code")).toHaveTextContent("kode");
    expect(container.querySelector("a")).toHaveAttribute("href", "https://example.com");
    expect(screen.getByText("#tag")).toBeInTheDocument();
  });
});

describe("AutoTextarea", () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, "scrollHeight", original);
  });

  it("resizes only the textarea whose value changed", () => {
    const reads: string[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        reads.push(this.getAttribute("name") ?? "");
        return 40;
      },
    });
    const noop = () => {};
    const view = (a: string, b: string) => (
      <>
        <AutoTextarea name="a" value={a} onChange={noop} />
        <AutoTextarea name="b" value={b} onChange={noop} />
      </>
    );

    const { rerender } = render(view("x", "y"));
    expect(reads.sort()).toEqual(["a", "b"]);
    expect(screen.getAllByRole("textbox")[0]).toHaveStyle({ height: "40px" });

    reads.length = 0;
    rerender(view("x", "y2"));
    expect(reads).toEqual(["b"]);

    reads.length = 0;
    rerender(view("x", "y2"));
    expect(reads).toEqual([]);
  });
});

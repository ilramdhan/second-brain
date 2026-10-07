import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getActiveSelection, navAttrs, useKeyboardNav } from "./use-keyboard-nav";

function List({
  ids,
  onOpen = () => {},
  onToggle = () => {},
}: {
  ids: string[];
  onOpen?: (id: string) => void;
  onToggle?: (id: string) => void;
}) {
  const { containerProps, nav } = useKeyboardNav({
    columns: [ids],
    kind: "task",
    onOpen,
    onToggle,
  });
  return (
    <>
      <input aria-label="search" />
      <div {...containerProps}>
        {ids.map((id) => (
          <div
            key={id}
            {...navAttrs(id, nav.selectedId === id, nav.tabStopId === id)}
            data-testid={id}
          >
            {id}
          </div>
        ))}
      </div>
    </>
  );
}

const press = (key: string, target: Element | Window = window) =>
  fireEvent.keyDown(target, { key });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useKeyboardNav", () => {
  it("moves a focused, selected item with j/k and a roving tabindex", () => {
    render(<List ids={["a", "b", "c"]} />);
    expect(screen.getByTestId("a")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("b")).toHaveAttribute("tabindex", "-1");
    press("j");
    expect(screen.getByTestId("a")).toHaveAttribute("aria-current", "true");
    expect(document.activeElement).toBe(screen.getByTestId("a"));
    press("j");
    expect(screen.getByTestId("b")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("b")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("a")).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(screen.getByTestId("b"));
    // arrows work while focus is in the list
    press("ArrowUp", screen.getByTestId("b"));
    expect(document.activeElement).toBe(screen.getByTestId("a"));
    expect(getActiveSelection()).toEqual({ kind: "task", id: "a" });
  });

  it("opens and toggles the selection", () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(<List ids={["a", "b"]} onOpen={onOpen} onToggle={onToggle} />);
    press("x");
    expect(onToggle).not.toHaveBeenCalled(); // nothing selected yet
    press("j");
    press("j");
    press("x");
    expect(onToggle).toHaveBeenCalledWith("b");
    press("Enter", screen.getByTestId("b"));
    press("o");
    press("e");
    expect(onOpen.mock.calls).toEqual([["b"], ["b"], ["b"]]);
  });

  it("ignores keys while typing, in dialogs, and arrows outside the list", () => {
    const onOpen = vi.fn();
    render(<List ids={["a", "b"]} onOpen={onOpen} />);
    press("j", screen.getByRole("textbox", { name: "search" }));
    expect(screen.getByTestId("a")).not.toHaveAttribute("data-selected");
    press("ArrowDown");
    expect(screen.getByTestId("a")).not.toHaveAttribute("data-selected");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    press("j");
    expect(screen.getByTestId("a")).not.toHaveAttribute("data-selected");
    dialog.remove();
    press("j");
    expect(screen.getByTestId("a")).toHaveAttribute("data-selected", "true");
  });

  it("selects the neighbour when the selected item disappears", () => {
    const { rerender } = render(<List ids={["a", "b", "c"]} />);
    press("j");
    press("j");
    rerender(<List ids={["a", "c"]} />);
    expect(screen.getByTestId("c")).toHaveAttribute("data-selected", "true");
  });

  it("selects an item that receives focus by click or Tab", () => {
    render(<List ids={["a", "b"]} />);
    fireEvent.focus(screen.getByTestId("b"));
    expect(screen.getByTestId("b")).toHaveAttribute("data-selected", "true");
    press("Escape");
    expect(screen.getByTestId("b")).not.toHaveAttribute("data-selected");
  });
});

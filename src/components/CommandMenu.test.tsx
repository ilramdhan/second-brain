import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/lib/preferences";

const state = vi.hoisted(() => ({
  status: { available: false, demo: false, model: null as string | null },
  semantic: { data: undefined as unknown, isError: false, isFetching: false },
  keywordEnabled: [] as boolean[],
  semanticEnabled: [] as boolean[],
}));

vi.mock("@/lib/data", () => ({
  useSemanticStatus: () => ({ data: state.status }),
  useSemanticSearch: (_term: string, enabled: boolean) => {
    state.semanticEnabled.push(enabled);
    return state.semantic;
  },
  useSearch: (_term: string, enabled: boolean) => {
    state.keywordEnabled.push(enabled);
    return {
      data: { tasks: [{ id: "t1", title: "Keyword task" }], projects: [], notes: [] },
      isFetching: false,
    };
  },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
const openTask = vi.fn();
vi.mock("@/components/tasks/TaskDialogProvider", () => ({
  useTaskDialog: () => ({ openTask, newTask: vi.fn() }),
}));

import CommandMenu from "./CommandMenu";

// cmdk measures its list; jsdom has no ResizeObserver or scrollIntoView.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

const renderMenu = () =>
  render(
    <PreferencesProvider>
      <CommandMenu open onOpenChange={() => {}} />
    </PreferencesProvider>,
  );

afterEach(() => {
  state.status = { available: false, demo: false, model: null };
  state.semantic = { data: undefined, isError: false, isFetching: false };
  state.keywordEnabled = [];
  state.semanticEnabled = [];
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

describe("CommandMenu search modes", () => {
  it("disables meaning search and uses keywords when AI is not configured", () => {
    renderMenu();
    const semantic = screen.getByRole("button", { name: /Makna/ });
    expect(semantic).toBeDisabled();
    expect(screen.getByRole("button", { name: "Kata kunci" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Keyword task")).toBeInTheDocument();
    expect(state.semanticEnabled.every((e) => !e)).toBe(true);
  });

  it("shows semantic hits with their similarity when switched on", () => {
    state.status = { available: true, demo: true, model: "demo-hash-v1" };
    state.semantic = {
      data: {
        hits: [
          {
            type: "note",
            id: "n1",
            title: "Rapat klien",
            snippet: "agenda",
            projectId: null,
            similarity: 0.82,
          },
        ],
        model: "demo-hash-v1",
      },
      isError: false,
      isFetching: false,
    };
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /Makna/ }));
    expect(screen.getByRole("button", { name: /Makna/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Rapat klien")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.queryByText("Keyword task")).not.toBeInTheDocument();
  });

  it("falls back to keyword results when semantic search fails", () => {
    state.status = { available: true, demo: false, model: "m" };
    state.semantic = { data: undefined, isError: true, isFetching: false };
    localStorage.setItem("second-brain-search-mode", "semantic");
    renderMenu();
    expect(screen.getByRole("status")).toHaveTextContent(/gagal/);
    expect(screen.getByText("Keyword task")).toBeInTheDocument();
  });
});

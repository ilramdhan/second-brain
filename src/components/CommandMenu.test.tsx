import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sun } from "lucide-react";

import { PreferencesProvider } from "@/lib/preferences";

const state = vi.hoisted(() => ({
  status: { available: false, demo: false, model: null as string | null },
  semantic: { data: undefined as unknown, isError: false, isFetching: false },
  keywordEnabled: [] as boolean[],
  semanticEnabled: [] as boolean[],
}));

const setStatus = vi.fn();
vi.mock("@/lib/data", () => ({
  useTaskActions: () => ({ setStatus }),
  useNoteActions: () => ({ create: vi.fn() }),
  useTasks: () => ({ data: [{ id: "t9", title: "Selected task", status: "todo" }] }),
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
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
const selection = vi.hoisted(() => ({ current: null as { kind: string; id: string } | null }));
vi.mock("@/hooks/use-keyboard-nav", () => ({ getActiveSelection: () => selection.current }));
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

const onShortcuts = vi.fn();
const renderMenu = () =>
  render(
    <PreferencesProvider>
      <CommandMenu
        open
        onOpenChange={() => {}}
        pages={[{ to: "/reports", key: "reports", icon: Sun }]}
        onQuickCapture={() => {}}
        onQuickTask={() => {}}
        onShortcuts={onShortcuts}
      />
    </PreferencesProvider>,
  );

afterEach(() => {
  state.status = { available: false, demo: false, model: null };
  state.semantic = { data: undefined, isError: false, isFetching: false };
  state.keywordEnabled = [];
  state.semanticEnabled = [];
  selection.current = null;
  vi.clearAllMocks();
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

describe("CommandMenu commands", () => {
  it("lists actions and pages, filtered by every typed word", () => {
    renderMenu();
    expect(screen.getByText("Catatan baru")).toBeInTheDocument();
    expect(screen.getByText("Buka Laporan")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "buka lap" } });
    expect(screen.getByText("Buka Laporan")).toBeInTheDocument();
    expect(screen.queryByText("Catatan baru")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Buka Laporan"));
    expect(navigate).toHaveBeenCalledWith({ to: "/reports" });
  });

  it("opens the shortcut sheet", () => {
    renderMenu();
    fireEvent.click(screen.getByText("Pintasan keyboard"));
    expect(onShortcuts).toHaveBeenCalled();
  });

  it("offers actions for the task selected on the page", () => {
    selection.current = { kind: "task", id: "t9" };
    renderMenu();
    fireEvent.click(screen.getByText("Tandai selesai: Selected task"));
    expect(setStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "t9" }), "done");
    fireEvent.click(screen.getByText("Buka tugas terpilih: Selected task"));
    expect(openTask).toHaveBeenCalledWith("t9");
  });
});

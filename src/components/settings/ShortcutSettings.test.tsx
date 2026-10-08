import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PreferencesProvider } from "@/lib/preferences";
import {
  matchShortcut,
  reloadShortcutOverrides,
  resetAllShortcuts,
  SHORTCUT_OVERRIDES_STORAGE_KEY,
} from "@/lib/shortcuts";

import { ShortcutSettings } from "./ShortcutSettings";

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(window, { key, ...init });
  });

const q = { key: "q", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

function renderSettings() {
  return render(
    <PreferencesProvider initialLocale="en">
      <ShortcutSettings />
    </PreferencesProvider>,
  );
}

function row(name: string) {
  return screen.getByRole("button", { name: `Change the key for ${name}` }).closest("li")!;
}

const RECORDING = /Press one letter/;

afterEach(() => {
  resetAllShortcuts();
  localStorage.clear();
  reloadShortcutOverrides();
});

describe("ShortcutSettings", () => {
  it("records a new key, then resets it", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Change the key for Quick task" }));
    expect(screen.getByText(RECORDING)).toBeInTheDocument();
    press("n");
    expect(screen.getByRole("status")).toHaveTextContent("Quick task is now N");
    expect(within(row("Quick task")).getByText("N")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SHORTCUT_OVERRIDES_STORAGE_KEY)!)).toEqual({
      quickTask: "n",
    });
    expect(matchShortcut(q, "global")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restore the default key for Quick task" }));
    expect(within(row("Quick task")).getByText("Q")).toBeInTheDocument();
    expect(matchShortcut(q, "global")?.id).toBe("quickTask");
    expect(localStorage.getItem(SHORTCUT_OVERRIDES_STORAGE_KEY)).toBeNull();
  });

  it("rejects a key already used and a forbidden key, keeps recording, Esc cancels", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Change the key for Quick task" }));
    press("t");
    expect(screen.getByRole("alert")).toHaveTextContent("Already used for Jump to today");
    press("F5");
    expect(screen.getByRole("alert")).toHaveTextContent("This key can't be used");
    press("Enter");
    expect(screen.getByRole("alert")).toHaveTextContent("This key can't be used");
    press("p", { ctrlKey: true });
    expect(screen.getByRole("alert")).toHaveTextContent("This key can't be used");
    expect(screen.getByText(RECORDING)).toBeInTheDocument();
    press("Escape");
    expect(screen.queryByText(RECORDING)).not.toBeInTheDocument();
    expect(within(row("Quick task")).getByText("Q")).toBeInTheDocument();
    expect(localStorage.getItem(SHORTCUT_OVERRIDES_STORAGE_KEY)).toBeNull();
  });

  it("resets every key and shows fixed bindings read-only", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Change the key for Quick task" }));
    press("n");
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(within(row("Quick task")).getByText("Q")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset all" })).toBeDisabled();
    expect(screen.getAllByText("Fixed").length).toBeGreaterThan(0);
  });

  it("leaves record mode on Tab without storing it (no keyboard trap)", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Change the key for Quick task" }));
    press("Tab");
    expect(screen.queryByText(RECORDING)).not.toBeInTheDocument();
    expect(localStorage.getItem(SHORTCUT_OVERRIDES_STORAGE_KEY)).toBeNull();
  });
});

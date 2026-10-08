import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PreferencesProvider, usePreferences } from "./preferences";
import { matchShortcut, setSingleKeyShortcutsEnabled, SINGLE_KEY_STORAGE_KEY } from "./shortcuts";

function Probe() {
  const { singleKeyShortcuts, setSingleKeyShortcuts } = usePreferences();
  return (
    <button onClick={() => setSingleKeyShortcuts(!singleKeyShortcuts)}>
      {singleKeyShortcuts ? "on" : "off"}
    </button>
  );
}

const q = { key: "q", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

afterEach(() => {
  setSingleKeyShortcutsEnabled(true);
  localStorage.clear();
});

describe("single-key shortcuts preference", () => {
  it("defaults to on and switches the matcher off and back on", () => {
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("on");
    expect(matchShortcut(q, "global")?.id).toBe("quickTask");

    act(() => fireEvent.click(button));
    expect(button).toHaveTextContent("off");
    expect(localStorage.getItem(SINGLE_KEY_STORAGE_KEY)).toBe("off");
    expect(matchShortcut(q, "global")).toBeNull();

    act(() => fireEvent.click(button));
    expect(button).toHaveTextContent("on");
    expect(matchShortcut(q, "global")?.id).toBe("quickTask");
  });

  it("restores the stored choice after mount", () => {
    setSingleKeyShortcutsEnabled(false);
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("off");
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreferencesProvider } from "@/lib/preferences";

import { ConfirmProvider } from "./ConfirmDialog";
import { useConfirm, type ConfirmFn, type ConfirmOptions } from "./confirm-context";

/** Renders the provider and hands the test the `confirm` function a component would get. */
function setup(locale: "id" | "en" = "id") {
  const ref: { confirm: ConfirmFn | null } = { confirm: null };
  function Grab() {
    ref.confirm = useConfirm();
    return null;
  }
  const view = render(
    <PreferencesProvider initialLocale={locale}>
      <ConfirmProvider>
        <Grab />
      </ConfirmProvider>
    </PreferencesProvider>,
  );
  const ask = (options: ConfirmOptions) => {
    let result!: Promise<boolean>;
    act(() => {
      result = ref.confirm!(options);
    });
    return result;
  };
  return { ...view, ask };
}

describe("ConfirmDialog / useConfirm", () => {
  it("resolves true when the confirm button is pressed", async () => {
    const { ask } = setup();
    const result = ask({ title: "Hapus aturan ini?", destructive: true });
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus aturan ini?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus" }));
    await expect(result).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("resolves false on cancel", async () => {
    const { ask } = setup();
    const result = ask({ title: "Lanjutkan?" });
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    await expect(result).resolves.toBe(false);
  });

  it("resolves false on Escape", async () => {
    const { ask } = setup();
    const result = ask({ title: "Lanjutkan?" });
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expect(result).resolves.toBe(false);
  });

  it("focuses the cancel button first", async () => {
    const { ask } = setup();
    void ask({ title: "Hapus permanen?", destructive: true });
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Batal" })).toHaveFocus(),
    );
  });

  it("uses the destructive variant, custom labels and the description", async () => {
    const { ask } = setup();
    void ask({
      title: "Cabut tautan?",
      description: "Tautan berhenti berfungsi.",
      confirmLabel: "Cabut",
      cancelLabel: "Jangan",
      destructive: true,
    });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleDescription("Tautan berhenti berfungsi.");
    expect(within(dialog).getByRole("button", { name: "Cabut" })).toHaveClass("bg-destructive");
    expect(within(dialog).getByRole("button", { name: "Jangan" })).toBeVisible();
  });

  it("uses a neutral confirm button and English labels when not destructive", async () => {
    const { ask } = setup("en");
    void ask({ title: "Continue?" });
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Confirm" })).not.toHaveClass(
      "bg-destructive",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("cancels the previous prompt when a new one opens, and on unmount", async () => {
    const { ask, unmount } = setup();
    const first = ask({ title: "Satu?" });
    const second = ask({ title: "Dua?" });
    await expect(first).resolves.toBe(false);
    expect(await screen.findByRole("alertdialog", { name: "Dua?" })).toBeVisible();
    unmount();
    await expect(second).resolves.toBe(false);
  });

  it("throws outside the provider", () => {
    function Lonely() {
      useConfirm();
      return null;
    }
    expect(() => render(<Lonely />)).toThrow(/ConfirmProvider/);
  });
});

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
    const result = ask({
      title: "Hapus aturan?",
      description: "Aturan dihapus permanen.",
      destructive: true,
    });
    const dialog = await screen.findByRole("alertdialog", { name: "Hapus aturan?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus" }));
    await expect(result).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("resolves false on cancel", async () => {
    const { ask } = setup();
    const result = ask({ title: "Lanjutkan?", description: "Isi diganti." });
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    await expect(result).resolves.toBe(false);
  });

  it("resolves false on Escape", async () => {
    const { ask } = setup();
    const result = ask({ title: "Lanjutkan?", description: "Isi diganti." });
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expect(result).resolves.toBe(false);
  });

  it("focuses the cancel button first", async () => {
    const { ask } = setup();
    void ask({
      title: "Hapus permanen?",
      description: "Tidak bisa dibatalkan.",
      destructive: true,
    });
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
    void ask({ title: "Continue?", description: "The content is replaced." });
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Confirm" })).not.toHaveClass(
      "bg-destructive",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("shows the description as the accessible description, a tone icon and no corner close button", async () => {
    const { ask } = setup();
    void ask({
      title: "Pindahkan tugas ke Sampah?",
      description: "“Rapat” dan 3 subtugasnya dipindah ke Sampah.",
      destructive: true,
    });
    const dialog = await screen.findByRole("alertdialog", { name: "Pindahkan tugas ke Sampah?" });
    expect(dialog).toHaveAccessibleDescription("“Rapat” dan 3 subtugasnya dipindah ke Sampah.");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("3 subtugasnya");
    const icon = dialog.querySelector("[data-slot=confirm-icon]")!;
    expect(icon).toHaveClass("text-destructive", "rounded-full");
    expect(icon.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // Only Cancel and the action: no "Tutup"/X button.
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Batal", "Hapus"]);
    expect(within(dialog).queryByRole("button", { name: "Tutup" })).toBeNull();
  });

  it("uses the warning and info tones", async () => {
    const { ask } = setup();
    void ask({ title: "Buat tautan baru?", description: "Tautan lama berhenti.", tone: "warning" });
    let dialog = await screen.findByRole("alertdialog", { name: "Buat tautan baru?" });
    expect(dialog.querySelector("[data-slot=confirm-icon]")).toHaveClass("text-warning");
    void ask({ title: "Lanjutkan?", description: "Isi diganti." });
    dialog = await screen.findByRole("alertdialog", { name: "Lanjutkan?" });
    expect(dialog.querySelector("[data-slot=confirm-icon]")).toHaveClass("text-primary");
  });

  it("cancels the previous prompt when a new one opens, and on unmount", async () => {
    const { ask, unmount } = setup();
    const first = ask({ title: "Satu?", description: "a" });
    const second = ask({ title: "Dua?", description: "b" });
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

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

function Form() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tugas baru</DialogTitle>
          <DialogDescription>Isi detail</DialogDescription>
        </DialogHeader>
        <Input aria-label="Judul" />
        <DialogFooter>
          <Button variant="outline">Batal</Button>
          <Button>Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog (mobile-first shell)", () => {
  it("is a named, rounded, height-capped scroll container", () => {
    render(<Form />);
    const dialog = screen.getByRole("dialog", { name: "Tugas baru" });
    expect(dialog).toHaveAccessibleDescription("Isi detail");
    expect(dialog).toHaveClass("rounded-2xl", "overflow-y-auto");
    expect(dialog.className).toMatch(/max-h-\[calc\(100dvh/);
    expect(dialog.className).toContain("env(safe-area-inset-bottom)");
  });

  it("keeps the header and the footer sticky inside the scroll body", () => {
    render(<Form />);
    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector("[data-slot=dialog-header]");
    const footer = dialog.querySelector("[data-slot=dialog-footer]");
    expect(header).toHaveClass("sticky", "top-0");
    expect(footer).toHaveClass("sticky", "bottom-0");
    // Phones: stacked full-width buttons, primary (last in the DOM) on top.
    expect(footer).toHaveClass("flex-col-reverse", "gap-2", "sm:flex-row");
    expect(within(footer as HTMLElement).getAllByRole("button")).toHaveLength(2);
  });

  it("starts focus in the form, not on the close button, and labels the close button", () => {
    render(<Form />);
    expect(screen.getByLabelText("Judul")).toHaveFocus();
    const close = screen.getByRole("button", { name: "Tutup" });
    expect(close).toHaveClass("h-11", "w-11");
  });

  it("gives fields touch-friendly heights on phones", () => {
    render(<Form />);
    expect(screen.getByLabelText("Judul")).toHaveAttribute("data-slot", "input");
    expect(screen.getByRole("dialog").className).toContain("max-sm:[&_[data-slot=input]]:h-11");
  });
});

describe("Sheet", () => {
  it("rounds the bottom sheet, respects the safe area and has a 44px close button", () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" closeLabel="Close">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );
    const sheet = screen.getByRole("dialog", { name: "Menu" });
    expect(sheet).toHaveClass("rounded-t-2xl", "overflow-y-auto");
    expect(sheet.className).toContain("env(safe-area-inset-bottom)");
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("h-11", "w-11");
  });
});

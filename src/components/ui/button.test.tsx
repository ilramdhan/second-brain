import { render, screen } from "@testing-library/react";
import { Plus } from "lucide-react";
import { describe, expect, it } from "vitest";

import { Button, ButtonGroup, IconButton, ResponsiveButton, buttonVariants } from "./button";

describe("buttonVariants", () => {
  it.each([
    ["default", "primary"],
    ["outline", "secondary"],
    ["ghost", "tertiary"],
    ["destructive", "danger"],
  ] as const)("alias %s renders exactly like %s", (alias, semantic) => {
    expect(buttonVariants({ variant: alias })).toBe(buttonVariants({ variant: semantic }));
  });

  it("defaults to primary + md", () => {
    expect(buttonVariants()).toBe(buttonVariants({ variant: "primary", size: "md" }));
    expect(buttonVariants()).toContain("bg-primary");
    expect(buttonVariants()).toContain("h-9");
  });

  it("keeps rounded-md for every variant", () => {
    for (const variant of [
      "primary",
      "secondary",
      "tertiary",
      "danger",
      "danger-ghost",
      "link",
    ] as const) {
      expect(buttonVariants({ variant })).toContain("rounded-md");
    }
  });

  it("danger-ghost is a red text button without a solid fill", () => {
    const cls = buttonVariants({ variant: "danger-ghost" });
    expect(cls).toContain("text-destructive");
    expect(cls).toContain("hover:bg-destructive/10");
    expect(cls).not.toContain("bg-destructive ");
  });

  it("grows to 44px on coarse pointers", () => {
    expect(buttonVariants({ size: "md" })).toContain("coarse:min-h-11");
    expect(buttonVariants({ size: "lg" })).toContain("coarse:min-h-11");
    expect(buttonVariants({ size: "icon" })).toContain("coarse:size-11");
    // Small sizes keep their look but get the invisible 44px hit area.
    expect(buttonVariants({ size: "sm" })).toContain("tap-area");
    expect(buttonVariants({ size: "icon-sm" })).toContain("tap-area");
  });

  it("link buttons drop side padding but keep their height", () => {
    const cls = buttonVariants({ variant: "link", size: "sm" });
    expect(cls).toContain("px-0");
    expect(cls).toContain("h-8");
    expect(cls).toContain("tap-area");
  });

  it("icon-xs is a tiny round button that keeps a 44px hit area", () => {
    const cls = buttonVariants({ size: "icon-xs" });
    expect(cls).toContain("size-4");
    expect(cls).toContain("rounded-full");
    expect(cls).toContain("tap-area");
  });

  it("fluid makes a button full width on phones only", () => {
    expect(buttonVariants({ fluid: true })).toContain("w-full sm:w-auto");
  });
});

describe("Button", () => {
  it("lets className override the size (tailwind-merge)", () => {
    render(<Button className="h-12">Simpan</Button>);
    const button = screen.getByRole("button", { name: "Simpan" });
    expect(button).toHaveClass("h-12");
    expect(button).not.toHaveClass("h-9");
  });
});

describe("IconButton", () => {
  it("uses the label as accessible name and tooltip", () => {
    render(
      <IconButton label="Tambah tugas">
        <Plus />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Tambah tugas" });
    expect(button).toHaveAttribute("aria-label", "Tambah tugas");
    expect(button).toHaveAttribute("title", "Tambah tugas");
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toBe(buttonVariants({ variant: "tertiary", size: "icon" }));
  });

  it("requires a label at the type level", () => {
    // @ts-expect-error label is required
    render(<IconButton>x</IconButton>);
  });
});

describe("ResponsiveButton", () => {
  it("hides the text below sm but keeps it as the accessible name", () => {
    render(<ResponsiveButton icon={<Plus aria-hidden />} label="Tugas baru" />);
    const button = screen.getByRole("button", { name: "Tugas baru" });
    const text = screen.getByText("Tugas baru");
    expect(text).toHaveClass("sr-only", "sm:not-sr-only");
    expect(button).toHaveClass("max-sm:size-9", "max-sm:coarse:size-11");
    expect(button).toHaveAttribute("title", "Tugas baru");
  });
});

describe("ButtonGroup", () => {
  it("wraps on small screens", () => {
    render(
      <ButtonGroup aria-label="Aksi">
        <Button>A</Button>
      </ButtonGroup>,
    );
    expect(screen.getByRole("group", { name: "Aksi" })).toHaveClass("flex-wrap", "gap-2");
  });
});

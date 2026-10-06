import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackToTop, resolveScroller } from "@/components/common/BackToTop";
import { PreferencesProvider } from "@/lib/preferences";

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { value, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

function renderWithMain(mainStyle?: Partial<CSSStyleDeclaration>) {
  const utils = render(
    <PreferencesProvider>
      <main id="main" tabIndex={-1} data-testid="main" />
      <BackToTop />
    </PreferencesProvider>,
  );
  const main = screen.getByTestId("main");
  if (mainStyle) Object.assign(main.style, mainStyle);
  return { ...utils, main };
}

afterEach(() => {
  setScrollY(0);
  vi.unstubAllGlobals();
});

describe("BackToTop", () => {
  it("stays hidden and out of the tab order until one viewport is scrolled", () => {
    renderWithMain();
    const button = screen.getByRole("button", { name: "Kembali ke atas" });
    expect(button).toHaveAttribute("data-visible", "false");
    expect(button).toHaveAttribute("tabindex", "-1");
    expect(button).toHaveClass("invisible");

    setScrollY(window.innerHeight + 1);
    expect(button).toHaveAttribute("data-visible", "true");
    expect(button).toHaveAttribute("tabindex", "0");
  });

  it("scrolls the window smoothly and moves focus to <main>", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const { main } = renderWithMain();
    setScrollY(window.innerHeight * 2);
    fireEvent.click(screen.getByRole("button", { name: "Kembali ke atas" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(document.activeElement).toBe(main);
  });

  it("jumps instantly when reduced motion is requested", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...original(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    })) as typeof window.matchMedia;
    try {
      renderWithMain();
      setScrollY(window.innerHeight * 2);
      fireEvent.click(screen.getByRole("button", { name: "Kembali ke atas" }));
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    } finally {
      window.matchMedia = original;
    }
  });

  it("uses an English label when the locale is English", () => {
    localStorage.setItem("second-brain-locale", "en");
    try {
      renderWithMain();
      expect(screen.getByRole("button", { name: "Back to top" })).toBeInTheDocument();
    } finally {
      localStorage.removeItem("second-brain-locale");
    }
  });
});

describe("resolveScroller", () => {
  it("falls back to the window when the container does not scroll", () => {
    const el = document.createElement("div");
    expect(resolveScroller(el)).toBeNull();
    expect(resolveScroller(null)).toBeNull();
  });

  it("returns an overflowing auto/scroll container", () => {
    const el = document.createElement("div");
    el.style.overflowY = "auto";
    Object.defineProperty(el, "scrollHeight", { value: 2000 });
    Object.defineProperty(el, "clientHeight", { value: 500 });
    document.body.appendChild(el);
    try {
      expect(resolveScroller(el)).toBe(el);
    } finally {
      el.remove();
    }
  });
});

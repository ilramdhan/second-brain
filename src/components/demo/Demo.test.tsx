import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoBanner } from "@/components/demo/DemoBanner";
import { DemoDisabled } from "@/components/demo/DemoDisabled";
import { PreferencesProvider } from "@/lib/preferences";

const wrap = (ui: React.ReactElement) => render(<PreferencesProvider>{ui}</PreferencesProvider>);

afterEach(() => vi.unstubAllEnvs());

describe("DemoDisabled", () => {
  it("renders the control unchanged outside the demo", async () => {
    const onClick = vi.fn();
    wrap(
      <DemoDisabled active={false}>
        <button onClick={onClick}>Hubungkan</button>
      </DemoDisabled>,
    );
    const button = screen.getByRole("button", { name: "Hubungkan" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });

  it("disables the control and exposes a focusable reason in the demo", async () => {
    const onClick = vi.fn();
    wrap(
      <DemoDisabled active>
        <button onClick={onClick}>Hubungkan</button>
      </DemoDisabled>,
    );
    const button = screen.getByRole("button", { name: "Hubungkan" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("tabindex", "-1");

    const wrapper = button.parentElement!;
    expect(wrapper).toHaveAttribute("tabindex", "0");
    expect(wrapper).toHaveAttribute("title", "Tidak tersedia di demo");
    expect(wrapper).toHaveAccessibleDescription("Tidak tersedia di demo");

    wrapper.focus();
    expect(wrapper).toHaveFocus();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("follows VITE_APP_MODE by default and accepts a custom reason", () => {
    vi.stubEnv("VITE_APP_MODE", "demo");
    wrap(
      <DemoDisabled reason="Undangan dimatikan">
        <button>Undang</button>
      </DemoDisabled>,
    );
    expect(screen.getByRole("button", { name: "Undang" })).toBeDisabled();
    expect(screen.getByText("Undangan dimatikan")).toHaveClass("sr-only");
  });
});

describe("DemoBanner", () => {
  it("renders nothing outside the demo", () => {
    const { container } = wrap(<DemoBanner active={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains the daily reset and links to production and GitHub", () => {
    vi.stubEnv("VITE_PROD_URL", "https://prod.example.com");
    wrap(<DemoBanner active />);
    expect(screen.getByRole("complementary", { name: "Pemberitahuan mode demo" })).toBeVisible();
    expect(screen.getByText(/data direset setiap hari pukul 00\.00 WIB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pakai versi asli/ })).toHaveAttribute(
      "href",
      "https://prod.example.com",
    );
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/ilramdhan/second-brain",
    );
  });
});

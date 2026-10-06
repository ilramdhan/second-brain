import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_NOTICE_KEY,
  DemoBanner,
  DemoNotice,
  SELF_HOST_URL,
} from "@/components/demo/DemoBanner";
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

describe("DemoNotice", () => {
  afterEach(() => sessionStorage.clear());

  it("renders nothing outside the demo", () => {
    const { container } = wrap(<DemoBanner active={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains the daily reset and links to self-hosting and production", () => {
    vi.stubEnv("VITE_PROD_URL", "https://prod.example.com");
    wrap(<DemoNotice active />);
    expect(screen.getByRole("complementary", { name: "Pemberitahuan mode demo" })).toBeVisible();
    expect(screen.getByText("Ini versi demo")).toBeInTheDocument();
    expect(screen.getByText(/direset setiap hari pukul 00\.00 WIB/)).toBeInTheDocument();
    expect(screen.getByText(/fitur .* dimatikan/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pakai versi asli/ })).toHaveAttribute(
      "href",
      "https://prod.example.com",
    );
    expect(screen.getByRole("link", { name: /Cara self-host/ })).toHaveAttribute(
      "href",
      SELF_HOST_URL,
    );
    expect(SELF_HOST_URL).toBe("https://github.com/ilramdhan/second-brain#deployment-to-vercel");
  });

  it("can be dismissed for the session only", () => {
    const { unmount } = wrap(<DemoNotice active />);
    fireEvent.click(screen.getByRole("button", { name: "Tutup pemberitahuan demo" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(DEMO_NOTICE_KEY)).toBe("1");
    unmount();

    // Same session: stays hidden.
    const second = wrap(<DemoNotice active />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    second.unmount();

    // Next visit (new session storage): back again.
    sessionStorage.clear();
    wrap(<DemoNotice active />);
    expect(screen.getByRole("complementary", { name: "Pemberitahuan mode demo" })).toBeVisible();
  });

  it("is translated to English", () => {
    localStorage.setItem("second-brain-locale", "en");
    try {
      wrap(<DemoNotice active />);
      expect(screen.getByText("This is the demo")).toBeInTheDocument();
      expect(screen.getByText(/resets every day at 00:00 WIB/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /How to self-host/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dismiss demo notice" })).toBeInTheDocument();
    } finally {
      localStorage.removeItem("second-brain-locale");
    }
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  redirect: vi.fn(),
}));

import { Landing } from "@/components/landing/Landing";
import { GITHUB_URL, LICENSE_URL, SECURITY_URL } from "@/lib/landing";
import { PreferencesProvider } from "@/lib/preferences";

function renderLanding() {
  return render(
    <PreferencesProvider>
      <Landing />
    </PreferencesProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.lang = "id";
});

describe("Landing", () => {
  it("renders the hero, both CTAs and every feature card in Indonesian", () => {
    renderLanding();

    expect(
      screen.getByRole("heading", { level: 1, name: /Otak kedua untuk tugas dan catatan/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const link of screen.getAllByRole("link", { name: /^Masuk/ })) {
      expect(link).toHaveAttribute("href", "/login");
    }
    expect(screen.getByRole("link", { name: /Lihat di GitHub/ })).toHaveAttribute(
      "href",
      GITHUB_URL,
    );
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Inbox & AI capture",
        "Tugas di empat tampilan",
        "Catatan berblok + graph",
        "Kolaborasi real-time",
        "Automations",
        "Telegram & Google Calendar",
      ]),
    );
  });

  it("has landmarks, a skip link to main and the footer links", () => {
    renderLanding();

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("contentinfo")).toHaveTextContent(`© ${new Date().getFullYear()}`);
    expect(screen.getByRole("link", { name: "Langsung ke konten" })).toHaveAttribute(
      "href",
      "#main",
    );
    expect(screen.getByRole("link", { name: /Lisensi MIT/ })).toHaveAttribute("href", LICENSE_URL);
    expect(screen.getByRole("link", { name: /Keamanan & privasi/ })).toHaveAttribute(
      "href",
      SECURITY_URL,
    );
  });

  it("hides the demo button when VITE_DEMO_URL is not set", () => {
    vi.stubEnv("VITE_DEMO_URL", "");
    renderLanding();

    expect(screen.queryByRole("link", { name: /Coba Demo/ })).not.toBeInTheDocument();
  });

  it("shows the demo button when VITE_DEMO_URL is set", () => {
    vi.stubEnv("VITE_DEMO_URL", "https://2ndbrain-demo.ilramdhan.dev");
    renderLanding();

    expect(screen.getByRole("link", { name: /Coba Demo/ })).toHaveAttribute(
      "href",
      "https://2ndbrain-demo.ilramdhan.dev/",
    );
  });

  it("toggles theme and language through the shared preference store", () => {
    renderLanding();

    const themeButton = screen.getByRole("button", { name: /Ganti tema: Ikuti perangkat/ });
    fireEvent.click(themeButton);
    expect(localStorage.getItem("second-brain-theme")).toBe("light");
    fireEvent.click(themeButton);
    expect(localStorage.getItem("second-brain-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");

    fireEvent.click(screen.getByRole("button", { name: /Ganti bahasa ke English/ }));
    expect(localStorage.getItem("second-brain-locale")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "A second brain for your tasks and notes",
    );
  });
});

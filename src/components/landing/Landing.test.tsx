import { fireEvent, render, screen, within } from "@testing-library/react";
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
import { prefersReducedMotion, SECTIONS } from "@/components/landing/SiteChrome";
import { APP_VERSION, GIT_SHA as BUILD_SHA, releaseTagUrl, REPO_URL } from "@/lib/app-version";
import { GITHUB_URL, LICENSE_URL, SECURITY_URL, SELF_HOST_DOCS_URL } from "@/lib/landing";
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
    vi.stubEnv("VITE_DEMO_URL", "https://demo-2ndbrain.ilramdhan.dev");
    renderLanding();

    // Header (desktop) and hero both link to the demo, in a new tab.
    const links = screen.getAllByRole("link", { name: /Coba Demo/ });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "https://demo-2ndbrain.ilramdhan.dev/");
      expect(link).toHaveAttribute("target", "_blank");
    }
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
  it("has a sticky header menu linking to every landing section", () => {
    renderLanding();

    const header = screen.getByRole("banner");
    expect(header.className).toContain("sticky");
    const nav = within(header).getByRole("navigation", { name: "Menu utama" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(SECTIONS.map((s) => `#${s.id}`));
    for (const { id } of SECTIONS) {
      expect(document.getElementById(id)).toBeInstanceOf(HTMLElement);
    }
    for (const name of ["Cara kerja", "Integrasi", "Self-host dalam tiga langkah"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText("Apakah Second Brain gratis?")).toBeInTheDocument();
  });

  it("scrolls smoothly to a section, instantly with reduced motion", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderLanding();
    const nav = screen.getByRole("navigation", { name: "Menu utama" });

    fireEvent.click(within(nav).getByRole("link", { name: "FAQ" }));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
    expect(window.location.hash).toBe("#faq");
    expect(document.activeElement).toBe(document.getElementById("faq"));

    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...original(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    })) as typeof window.matchMedia;
    try {
      expect(prefersReducedMotion()).toBe(true);
      fireEvent.click(within(nav).getByRole("link", { name: "Cara kerja" }));
      expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
    } finally {
      window.matchMedia = original;
      window.history.replaceState(null, "", "/");
    }
  });

  it("has a column footer with docs, legal pages and the release version", () => {
    renderLanding();
    const footer = screen.getByRole("contentinfo");

    for (const name of ["Halaman", "Dokumentasi", "Legal"]) {
      expect(within(footer).getByRole("navigation", { name })).toBeInTheDocument();
    }
    expect(within(footer).getByRole("link", { name: "Privasi" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(within(footer).getByRole("link", { name: "Ketentuan" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(within(footer).getByRole("link", { name: /Panduan self-host/ })).toHaveAttribute(
      "href",
      SELF_HOST_DOCS_URL,
    );
    expect(within(footer).getByRole("link", { name: /Bot Telegram & n8n/ })).toHaveAttribute(
      "href",
      `${REPO_URL}/blob/main/integrations/n8n/README.md`,
    );
    expect(within(footer).getByRole("link", { name: /Environment variable/ })).toHaveAttribute(
      "href",
      `${REPO_URL}/blob/main/.env.example`,
    );
    const version = within(footer).getByRole("link", { name: /catatan rilis/ });
    expect(version).toHaveAttribute("href", releaseTagUrl());
    expect(version).toHaveTextContent(`v${APP_VERSION} · ${BUILD_SHA}`);
    expect(footer).toHaveTextContent("Dibuat dengan ♥ di Indonesia");
  });

  it("opens the mobile menu sheet with the section links and sign in", () => {
    renderLanding();

    fireEvent.click(screen.getByRole("button", { name: "Buka menu" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(expect.arrayContaining([...SECTIONS.map((s) => `#${s.id}`), "/login", GITHUB_URL]));
  });
});

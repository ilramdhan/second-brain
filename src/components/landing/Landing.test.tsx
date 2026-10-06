import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { Landing } from "@/components/landing/Landing";
import { GITHUB_URL } from "@/lib/landing";
import { PreferencesProvider } from "@/lib/preferences";

describe("Landing", () => {
  it("renders the hero, both CTAs and every feature card in Indonesian", () => {
    render(
      <PreferencesProvider>
        <Landing />
      </PreferencesProvider>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: /Otak kedua untuk tugas dan catatan/ }),
    ).toBeInTheDocument();
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
});

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicSharePage, PublicShareUnavailable } from "@/components/share/PublicSharePage";
import { PreferencesProvider } from "@/lib/preferences";
import type { PublicShare } from "@/lib/share";

const wrap = (ui: React.ReactNode, locale: "id" | "en" = "id") =>
  render(<PreferencesProvider initialLocale={locale}>{ui}</PreferencesProvider>);

const note: PublicShare = {
  kind: "note",
  title: "Rencana rilis",
  updatedAt: "2026-10-01T08:00:00Z",
  allowIndexing: false,
  summary: "",
  blocks: [
    { type: "h1", inline: [{ kind: "text", text: "Ringkasan" }] },
    {
      type: "p",
      inline: [
        { kind: "text", text: "Lihat " },
        { kind: "wiki", text: "Catatan Lain" },
        { kind: "text", text: " " },
        { kind: "ref", text: null },
        { kind: "text", text: " " },
        { kind: "url", text: "https://example.test/x" },
      ],
    },
    { type: "bullet", inline: [{ kind: "text", text: "satu" }] },
    { type: "bullet", inline: [{ kind: "text", text: "dua" }] },
    { type: "todo", checked: true, inline: [{ kind: "text", text: "selesai" }] },
  ],
};

describe("PublicSharePage", () => {
  it("renders a note read-only, with no links into the app", () => {
    const { container } = wrap(<PublicSharePage share={note} />);
    expect(screen.getByRole("heading", { level: 1, name: "Rencana rilis" })).toBeInTheDocument();
    expect(screen.getByText("Baca-saja")).toBeInTheDocument();
    // [[links]] are plain text, unshared refs show a placeholder.
    expect(screen.getByText("Catatan Lain").closest("a")).toBeNull();
    expect(screen.getByText("konten tidak dibagikan")).toBeInTheDocument();
    // Consecutive bullets form one list.
    expect(container.querySelectorAll("ul.list-disc > li")).toHaveLength(2);
    // Only links: the external URL (no referrer, nofollow) and the footer to the landing page.
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://example.test/x", "/"]);
    const external = screen.getByRole("link", { name: "https://example.test/x" });
    expect(external).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    expect(screen.getByRole("link", { name: /Dibuat dengan Second Brain/ })).toHaveAttribute(
      "href",
      "/",
    );
    expect(container.querySelector("input,textarea,button,[contenteditable]")).toBeNull();
  });

  it("renders a project board grouped by status, in English", () => {
    wrap(
      <PublicSharePage
        share={{
          kind: "project",
          title: "Peluncuran",
          description: "Deskripsi",
          status: "active",
          startDate: "2026-10-01",
          dueDate: null,
          updatedAt: "2026-10-02T00:00:00Z",
          allowIndexing: false,
          summary: "",
          tasks: [
            { title: "Desain", status: "done", priority: "high", dueDate: "2026-10-10" },
            { title: "Uji", status: "todo", priority: "low", dueDate: null },
          ],
          milestones: [{ title: "Beta", dueDate: "2026-11-01", done: false }],
        }}
      />,
      "en",
    );
    expect(screen.getByRole("heading", { level: 2, name: /Tasks/ })).toBeInTheDocument();
    const done = screen.getByRole("region", { name: /Selesai/ });
    expect(within(done).getByText("Desain")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: /To do/ })).getByText("Uji"),
    ).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Made with Second Brain")).toBeInTheDocument();
  });

  it("shows one message for every unavailable link", () => {
    wrap(<PublicShareUnavailable />);
    expect(screen.getByRole("heading", { name: "Tautan tidak tersedia" })).toBeInTheDocument();
  });
});

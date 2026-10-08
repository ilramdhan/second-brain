import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ShareRow } from "@/lib/share";

// The dialog only talks to the data layer through these hooks; stub them so the test checks
// what the toggle sends without a Supabase client.
const state = vi.hoisted(() => ({
  share: null as ShareRow | null,
  create: vi.fn(),
  setIndexing: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/lib/data", () => ({
  useShareFor: () => ({ share: state.share, isLoading: false }),
  useCanShare: () => ({ data: true }),
  useShareActions: () => ({
    create: state.create,
    setIndexing: state.setIndexing,
    regenerate: vi.fn(),
    revoke: state.revoke,
    setExpiry: vi.fn(),
  }),
}));

import { ConfirmProvider } from "@/components/common/ConfirmDialog";
import { PreferencesProvider } from "@/lib/preferences";

import { ShareDialog } from "./ShareDialog";

const ID = "aaaaaaaa-0000-4000-8000-000000000001";

const row = (over: Partial<ShareRow> = {}): ShareRow => ({
  id: "cccccccc-0000-4000-8000-000000000001",
  resource_type: "note",
  resource_id: ID,
  created_at: "2026-10-01T08:00:00Z",
  expires_at: null,
  revoked_at: null,
  view_count: 0,
  last_viewed_at: null,
  allow_indexing: false,
  ...over,
});

const open = () =>
  render(
    <PreferencesProvider initialLocale="id">
      <ConfirmProvider>
        <ShareDialog open onOpenChange={() => {}} resourceType="note" resourceId={ID} />
      </ConfirmProvider>
    </PreferencesProvider>,
  );

describe("ShareDialog search-engine indexing", () => {
  beforeEach(() => {
    state.share = null;
    state.create.mockReset().mockResolvedValue({ token: "t", share: row() });
    state.setIndexing.mockReset().mockResolvedValue(row({ allow_indexing: true }));
    state.revoke.mockReset().mockResolvedValue(undefined);
  });

  it("is off by default and creates the link without indexing", async () => {
    open();
    const toggle = screen.getByRole("switch", { name: "Izinkan mesin pencari" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: /Buat tautan/ }));
    await vi.waitFor(() => expect(state.create).toHaveBeenCalledWith("note", ID, "never", false));
  });

  it("passes the opt-in to create when switched on first", async () => {
    open();
    fireEvent.click(screen.getByRole("switch", { name: "Izinkan mesin pencari" }));
    fireEvent.click(screen.getByRole("button", { name: /Buat tautan/ }));
    await vi.waitFor(() => expect(state.create).toHaveBeenCalledWith("note", ID, "never", true));
  });

  it("updates an existing link through setIndexing", async () => {
    state.share = row();
    open();
    fireEvent.click(screen.getByRole("switch", { name: "Izinkan mesin pencari" }));
    await vi.waitFor(() => expect(state.setIndexing).toHaveBeenCalledWith(state.share!.id, true));
  });

  it("revokes only after the in-app confirmation (not window.confirm)", async () => {
    state.share = row();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cabut" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Cabut tautan publik?");
    expect(dialog).toHaveAccessibleDescription(/tidak bisa membuka halamannya lagi/);
    // Cancel first: nothing happens.
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(state.revoke).not.toHaveBeenCalled();
    // Then confirm.
    fireEvent.click(screen.getByRole("button", { name: "Cabut" }));
    const again = await screen.findByRole("alertdialog");
    fireEvent.click(within(again).getByRole("button", { name: "Cabut" }));
    await waitFor(() => expect(state.revoke).toHaveBeenCalledWith(state.share!.id));
  });
});

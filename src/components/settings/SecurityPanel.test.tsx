import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(),
  enroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
  unenroll: vi.fn(),
  refreshSession: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const recovery = vi.hoisted(() => ({
  generateRecoveryCodes: vi.fn(),
  recoveryCodesStatus: vi.fn(),
  redeemRecoveryCode: vi.fn(),
}));

vi.mock("@/lib/mfa.functions", () => recovery);

vi.mock("sonner", () => ({ toast }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      refreshSession: mfa.refreshSession,
      mfa: {
        listFactors: mfa.listFactors,
        enroll: mfa.enroll,
        challenge: mfa.challenge,
        verify: mfa.verify,
        unenroll: mfa.unenroll,
      },
    },
  },
}));

import { SecurityPanel } from "@/components/settings/SecurityPanel";
import { PreferencesProvider } from "@/lib/preferences";

const verified = {
  id: "f1",
  friendly_name: "Authenticator 1",
  factor_type: "totp",
  status: "verified",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
const factors = (list: unknown[]) =>
  mfa.listFactors.mockResolvedValue({ data: { all: list, totp: list }, error: null });

function renderPanel() {
  return render(<SecurityPanel />, { wrapper: PreferencesProvider });
}

beforeEach(() => {
  for (const fn of Object.values(mfa)) fn.mockReset();
  mfa.challenge.mockResolvedValue({ data: { id: "c1" }, error: null });
  mfa.verify.mockResolvedValue({ data: {}, error: null });
  mfa.unenroll.mockResolvedValue({ data: {}, error: null });
  mfa.refreshSession.mockResolvedValue({ data: {}, error: null });
  for (const fn of Object.values(recovery)) fn.mockReset();
  recovery.recoveryCodesStatus.mockResolvedValue({ remaining: 0 });
  recovery.generateRecoveryCodes.mockResolvedValue({
    codes: Array.from({ length: 10 }, (_, i) => `AAAA-000${i}`),
  });
});

describe("Recovery codes", () => {
  it("shows the remaining count and creates a batch shown once", async () => {
    factors([verified]);
    recovery.recoveryCodesStatus.mockResolvedValue({ remaining: 0 });
    renderPanel();
    expect(await screen.findByText("Kode tersisa: 0")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Buat kode pemulihan" }));
    expect(await screen.findByText("AAAA-0003")).toBeVisible();
    expect(screen.getByRole("button", { name: "Unduh .txt" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sudah saya simpan" }));
    expect(screen.queryByText("AAAA-0003")).toBeNull();
    expect(screen.getByText("Kode tersisa: 10")).toBeVisible();
  });

  it("creates the first batch right after 2FA is turned on", async () => {
    factors([]);
    mfa.enroll.mockResolvedValue({
      data: { id: "new", type: "totp", totp: { qr_code: "data:x", secret: "S", uri: "u" } },
      error: null,
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Aktifkan verifikasi dua langkah" }));
    fireEvent.change(await screen.findByLabelText("Kode autentikasi"), {
      target: { value: "123456" },
    });
    factors([verified]);
    fireEvent.click(screen.getByRole("button", { name: "Aktifkan" }));
    expect(await screen.findByText("AAAA-0009")).toBeVisible();
    expect(recovery.generateRecoveryCodes).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("SecurityPanel (Settings → Keamanan)", () => {
  it("shows the off state with an enable button", async () => {
    factors([]);
    renderPanel();
    expect(await screen.findByText("Verifikasi dua langkah belum aktif")).toBeVisible();
    expect(screen.getByRole("button", { name: "Aktifkan verifikasi dua langkah" })).toBeVisible();
  });

  it("enrolls: QR code, manual secret, then verifies a code", async () => {
    factors([]);
    mfa.enroll.mockResolvedValue({
      data: {
        id: "new",
        type: "totp",
        totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DP", uri: "otpauth://" },
      },
      error: null,
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Aktifkan verifikasi dua langkah" }));

    const img = await screen.findByRole("img", { name: "Kode QR untuk aplikasi autentikator" });
    expect(img).toHaveAttribute("src", "data:image/svg+xml;utf-8,<svg/>");
    expect(screen.getByText("JBSWY3DP")).toBeVisible();
    expect(mfa.enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Authenticator 1",
    });

    const code = screen.getByLabelText("Kode autentikasi");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    fireEvent.change(code, { target: { value: "654321" } });
    factors([verified]);
    fireEvent.click(screen.getByRole("button", { name: "Aktifkan" }));

    await waitFor(() =>
      expect(mfa.verify).toHaveBeenCalledWith({
        factorId: "new",
        challengeId: "c1",
        code: "654321",
      }),
    );
    expect(await screen.findByText("Verifikasi dua langkah aktif")).toBeVisible();
    expect(toast.success).toHaveBeenCalled();
  });

  it("shows a wrong enrollment code inline and stays in the enrollment step", async () => {
    factors([]);
    mfa.enroll.mockResolvedValue({
      data: { id: "new", type: "totp", totp: { qr_code: "data:x", secret: "S", uri: "u" } },
      error: null,
    });
    mfa.verify.mockResolvedValue({
      data: null,
      error: { status: 422, code: "mfa_verification_failed" },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Aktifkan verifikasi dua langkah" }));
    fireEvent.change(await screen.findByLabelText("Kode autentikasi"), {
      target: { value: "111111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aktifkan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kode salah atau kedaluwarsa");
    expect(screen.getByRole("img", { name: "Kode QR untuk aplikasi autentikator" })).toBeVisible();
  });

  it("cancelling an enrollment removes the unverified factor", async () => {
    factors([]);
    mfa.enroll.mockResolvedValue({
      data: { id: "new", type: "totp", totp: { qr_code: "data:x", secret: "S", uri: "u" } },
      error: null,
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Aktifkan verifikasi dua langkah" }));
    fireEvent.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "new" }));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("lists factors and removes one only after re-verifying a code", async () => {
    factors([verified]);
    renderPanel();
    const list = await screen.findByRole("list", { name: "Autentikator terdaftar" });
    expect(within(list).getByText("Authenticator 1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hapus: Authenticator 1" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Kode autentikasi"), {
      target: { value: "222333" },
    });
    factors([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus autentikator" }));

    await waitFor(() => expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "f1" }));
    expect(mfa.verify).toHaveBeenCalledWith({ factorId: "f1", challengeId: "c1", code: "222333" });
    expect(mfa.verify.mock.invocationCallOrder[0]).toBeLessThan(
      mfa.unenroll.mock.invocationCallOrder[0]!,
    );
    expect(await screen.findByText("Verifikasi dua langkah belum aktif")).toBeVisible();
  });

  it("does not remove a factor when the code is wrong", async () => {
    factors([verified]);
    mfa.verify.mockResolvedValue({
      data: null,
      error: { status: 422, code: "mfa_verification_failed" },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Hapus: Authenticator 1" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Kode autentikasi"), {
      target: { value: "999999" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus autentikator" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Kode salah");
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it("cleans up abandoned unverified enrollments on load", async () => {
    const stale = { ...verified, id: "stale", status: "unverified" };
    mfa.listFactors.mockResolvedValue({ data: { all: [stale], totp: [] }, error: null });
    renderPanel();
    await screen.findByText("Verifikasi dua langkah belum aktif");
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "stale" });
  });

  it("shows a load error", async () => {
    mfa.listFactors.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("Gagal memuat faktor autentikasi.");
  });

  it("is not available in the demo (shared account)", () => {
    vi.stubEnv("VITE_APP_MODE", "demo");
    renderPanel();
    expect(screen.getByText(/tidak tersedia di demo/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Aktifkan verifikasi dua langkah" })).toBeNull();
    expect(mfa.listFactors).not.toHaveBeenCalled();
  });
});

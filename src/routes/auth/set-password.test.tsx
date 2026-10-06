import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  rpc: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      exchangeCodeForSession: auth.exchangeCodeForSession,
      updateUser: auth.updateUser,
      resetPasswordForEmail: auth.resetPasswordForEmail,
    },
    rpc: auth.rpc,
  },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (options: Record<string, unknown>) => ({ ...options, options }),
    useNavigate: () => router.navigate,
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

import { PreferencesProvider } from "@/lib/preferences";
import { Route } from "@/routes/auth/set-password";

type PageRoute = {
  component: () => React.ReactElement;
  head: () => { meta: { name?: string; content?: string }[] };
};
const route = Route as unknown as PageRoute;
const Page = route.component;

const USER = "5b1f6a2e-3c4d-4e8f-9a0b-1c2d3e4f5a6b";
const PROJECT = "7c2a1b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const session = {
  user: { id: USER, email: "new@example.test", user_metadata: { invited_project_id: PROJECT } },
};
/** Unsigned JWT whose payload carries `sub` (the page only reads it to match the session). */
const token = (sub: string) => `x.${btoa(JSON.stringify({ sub }))}.y`;

function visit(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Page />, { wrapper: PreferencesProvider });
}

beforeEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset();
  router.navigate.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  auth.rpc.mockResolvedValue({ data: 1, error: null });
  auth.updateUser.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("/auth/set-password", () => {
  it("is never indexed", () => {
    const robots = route.head().meta.find((m) => m.name === "robots");
    expect(robots?.content).toBe("noindex, nofollow");
  });

  it("invite link: sets the password, accepts invites and opens the project", async () => {
    visit(`/auth/set-password#access_token=${token(USER)}&type=invite`);
    expect(await screen.findByRole("heading", { name: "Buat kata sandi" })).toBeInTheDocument();
    expect(screen.getByText("new@example.test")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "Simpan kata sandi" });
    fireEvent.change(screen.getByLabelText("Kata sandi baru"), { target: { value: "Abcdef12!" } });
    fireEvent.change(screen.getByLabelText("Ulangi kata sandi"), {
      target: { value: "Abcdef12?" },
    });
    expect(screen.getByText("Kata sandi tidak sama.")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Ulangi kata sandi"), {
      target: { value: "Abcdef12!" },
    });
    expect(screen.getByText("Kekuatan: Kuat")).toBeInTheDocument();
    fireEvent.click(save);

    await waitFor(() => expect(router.navigate).toHaveBeenCalled());
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "Abcdef12!" });
    expect(auth.rpc).toHaveBeenCalledWith("accept_project_invites");
    expect(router.navigate).toHaveBeenCalledWith({ href: `/projects/${PROJECT}`, replace: true });
  });

  it("recovery link with a PKCE code: exchanges it and lands on /today", async () => {
    auth.getSession
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValue({ data: { session }, error: null });
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
    auth.rpc.mockResolvedValue({ data: 0, error: null });
    visit("/auth/set-password?code=abc&type=recovery");
    expect(
      await screen.findByRole("heading", { name: "Atur ulang kata sandi" }),
    ).toBeInTheDocument();
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(window.location.search).toBe("");

    fireEvent.change(screen.getByLabelText("Kata sandi baru"), {
      target: { value: "longpassword" },
    });
    fireEvent.change(screen.getByLabelText("Ulangi kata sandi"), {
      target: { value: "longpassword" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Simpan kata sandi" }));
    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({ href: "/today", replace: true }),
    );
  });

  it("keeps the form open on a too-short password", async () => {
    visit(`/auth/set-password#access_token=${token(USER)}&type=recovery`);
    const input = await screen.findByLabelText("Kata sandi baru");
    fireEvent.change(input, { target: { value: "short" } });
    fireEvent.blur(input);
    expect(screen.getByText("Kata sandi minimal 8 karakter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan kata sandi" })).toBeDisabled();
  });

  it("expired link: explains it and offers a new link", async () => {
    visit("/auth/set-password#error=access_denied&error_code=otp_expired&error_description=x");
    expect(
      await screen.findByRole("heading", { name: "Tautan tidak valid atau kedaluwarsa" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Minta tautan baru");
    expect(screen.getByRole("button", { name: "Minta tautan baru" })).toBeInTheDocument();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses without a link, even with a stored session", async () => {
    visit("/auth/set-password");
    expect(
      await screen.findByRole("heading", { name: "Tautan tidak valid atau kedaluwarsa" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Kata sandi baru")).toBeNull();
  });

  it("refuses when the stored session belongs to someone else than the link", async () => {
    visit(`/auth/set-password#access_token=${token("someone-else")}&type=recovery`);
    expect(
      await screen.findByRole("heading", { name: "Tautan tidak valid atau kedaluwarsa" }),
    ).toBeInTheDocument();
  });

  it("is disabled in the demo (shared account)", async () => {
    vi.stubEnv("VITE_APP_MODE", "demo");
    visit(`/auth/set-password#access_token=${token(USER)}&type=recovery`);
    expect(await screen.findByRole("status")).toHaveTextContent("tidak tersedia di demo");
    expect(screen.queryByLabelText("Kata sandi baru")).toBeNull();
    expect(auth.getSession).not.toHaveBeenCalled();
  });
});

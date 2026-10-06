import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  aal: vi.fn(),
  listFactors: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn(), search: {} as { redirect?: string } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      signUp: auth.signUp,
      signInWithPassword: auth.signInWithPassword,
      resetPasswordForEmail: auth.resetPasswordForEmail,
      signInWithOtp: auth.signInWithOtp,
      signInWithOAuth: auth.signInWithOAuth,
      signOut: auth.signOut,
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      mfa: {
        getAuthenticatorAssuranceLevel: auth.aal,
        listFactors: auth.listFactors,
        challenge: auth.challenge,
        verify: auth.verify,
      },
    },
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    // Expose the route options (component, beforeLoad) without a router instance.
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      options,
      useSearch: () => router.search,
    }),
    useNavigate: () => router.navigate,
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

import { isRedirect } from "@tanstack/react-router";

import { PreferencesProvider } from "@/lib/preferences";
import { Route } from "@/routes/login";

type LoginRoute = {
  component: () => React.ReactElement;
  beforeLoad: (ctx: { search: { redirect?: string } }) => Promise<void>;
};
const route = Route as unknown as LoginRoute;
const LoginPage = route.component;

const levels = (currentLevel: string, nextLevel: string) =>
  auth.aal.mockResolvedValue({ data: { currentLevel, nextLevel }, error: null });

beforeEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  levels("aal1", "aal1");
  router.navigate.mockReset();
  router.search = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/login", () => {
  it("has one back button outside the card (first link) and a logo linking home", () => {
    render(<LoginPage />, { wrapper: PreferencesProvider });

    const back = screen.getByRole("link", { name: "Kembali ke beranda" });
    expect(back).toHaveAttribute("href", "/");
    expect(back).toHaveTextContent("Beranda");
    // Focus order: the back button comes before the logo and the form.
    expect(screen.getAllByRole("link")[0]).toBe(back);
    expect(back.closest("form")).toBeNull();
    expect(screen.getByRole("link", { name: "Second Brain — beranda" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("hides sign-up unless VITE_ALLOW_SIGNUP=true", () => {
    vi.stubEnv("VITE_ALLOW_SIGNUP", "");
    const { unmount } = render(<LoginPage />, { wrapper: PreferencesProvider });
    expect(screen.queryByRole("button", { name: /Daftar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Pendaftaran ditutup/)).toBeInTheDocument();
    unmount();

    vi.stubEnv("VITE_ALLOW_SIGNUP", "true");
    render(<LoginPage />, { wrapper: PreferencesProvider });
    expect(screen.getByRole("button", { name: "Belum punya akun? Daftar" })).toBeInTheDocument();
    expect(screen.queryByText(/Pendaftaran ditutup/)).not.toBeInTheDocument();
  });

  it("shows the demo account, fills it in and never offers sign-up in demo mode", async () => {
    vi.stubEnv("VITE_APP_MODE", "demo");
    vi.stubEnv("VITE_ALLOW_SIGNUP", "true");
    render(<LoginPage />, { wrapper: PreferencesProvider });

    expect(screen.getByText("demo@ilramdhan.dev / demo2ndbrain")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Daftar/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Pendaftaran ditutup/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Isi otomatis" }));
    expect(screen.getByLabelText("Email")).toHaveValue("demo@ilramdhan.dev");
    expect(screen.getByLabelText("Kata sandi")).toHaveValue("demo2ndbrain");
  });

  it("signs in as the demo account in one click", async () => {
    vi.stubEnv("VITE_APP_MODE", "demo");
    vi.stubEnv("VITE_DEMO_EMAIL", "guest@demo.test");
    vi.stubEnv("VITE_DEMO_PASSWORD", "guestpass");
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "demo" } }, error: null });
    render(<LoginPage />, { wrapper: PreferencesProvider });

    fireEvent.click(screen.getByRole("button", { name: "Masuk sebagai demo" }));

    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: "guest@demo.test",
        password: "guestpass",
      }),
    );
    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({ to: "/today", replace: true }),
    );
  });

  it("hides the demo controls outside demo mode", () => {
    vi.stubEnv("VITE_APP_MODE", "");
    render(<LoginPage />, { wrapper: PreferencesProvider });
    expect(screen.queryByRole("button", { name: "Masuk sebagai demo" })).not.toBeInTheDocument();
  });

  it("lets guests stay on the form", async () => {
    await expect(route.beforeLoad({ search: {} })).resolves.toBeUndefined();
    render(<LoginPage />, { wrapper: PreferencesProvider });
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("redirects a signed-in visitor to /today in beforeLoad", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    const thrown = await route.beforeLoad({ search: {} }).catch((e: unknown) => e);

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe("/today");
  });

  it("honours the validated redirect target for a signed-in visitor", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    const thrown = await route
      .beforeLoad({ search: { redirect: "/notes/abc" } })
      .catch((e: unknown) => e);

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { href: string } }).options.href).toBe("/notes/abc");
  });

  it("forwards a signed-in visitor after hydration (SSR first load)", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    render(<LoginPage />, { wrapper: PreferencesProvider });

    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({ to: "/today", replace: true }),
    );
  });

  describe("forgot password", () => {
    const GENERIC = /Jika email tersebut terdaftar/;

    async function requestReset(email: string) {
      render(<LoginPage />, { wrapper: PreferencesProvider });
      fireEvent.click(screen.getByRole("button", { name: "Lupa kata sandi?" }));
      expect(screen.getByRole("heading", { name: "Atur ulang kata sandi" })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
      fireEvent.click(screen.getByRole("button", { name: "Kirim tautan" }));
    }

    it("emails a link to /auth/set-password and shows a generic message", async () => {
      auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
      await requestReset(" User@Example.test ");
      expect(await screen.findByRole("status")).toHaveTextContent(GENERIC);
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("user@example.test", {
        redirectTo: `${window.location.origin}/auth/set-password`,
      });
    });

    it("shows the same message when the email is unknown (no enumeration)", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      auth.resetPasswordForEmail.mockResolvedValue({
        data: null,
        error: { status: 400, code: "user_not_found", message: "User not found" },
      });
      await requestReset("nobody@example.test");
      expect(await screen.findByRole("status")).toHaveTextContent(GENERIC);
    });

    it("rejects an invalid email without calling Supabase", async () => {
      await requestReset("not-an-email");
      expect(await screen.findByText("Email tidak valid.")).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("is not offered in the demo (shared account)", () => {
      vi.stubEnv("VITE_APP_MODE", "demo");
      render(<LoginPage />, { wrapper: PreferencesProvider });
      expect(screen.queryByRole("button", { name: "Lupa kata sandi?" })).toBeNull();
    });
  });

  describe("passwordless and two-factor", () => {
    it("shows the magic link by default and hides Google unless VITE_AUTH_GOOGLE=true", () => {
      const { unmount } = render(<LoginPage />, { wrapper: PreferencesProvider });
      expect(screen.getByRole("button", { name: "Kirim tautan masuk ke email" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Masuk dengan Google" })).toBeNull();
      unmount();

      vi.stubEnv("VITE_AUTH_GOOGLE", "true");
      vi.stubEnv("VITE_AUTH_MAGIC_LINK", "false");
      render(<LoginPage />, { wrapper: PreferencesProvider });
      expect(screen.getByRole("button", { name: "Masuk dengan Google" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Kirim tautan masuk ke email" })).toBeNull();
    });

    it("hides Google and the magic link in the demo", () => {
      vi.stubEnv("VITE_APP_MODE", "demo");
      vi.stubEnv("VITE_AUTH_GOOGLE", "true");
      render(<LoginPage />, { wrapper: PreferencesProvider });
      expect(screen.queryByRole("button", { name: "Masuk dengan Google" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Kirim tautan masuk ke email" })).toBeNull();
    });

    it("switches between password and magic link modes", () => {
      render(<LoginPage />, { wrapper: PreferencesProvider });
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.test" } });
      fireEvent.click(screen.getByRole("button", { name: "Kirim tautan masuk ke email" }));
      expect(screen.getByRole("heading", { name: "Masuk tanpa kata sandi" })).toBeVisible();
      expect(screen.queryByLabelText("Kata sandi")).toBeNull();
      // The typed email is carried over.
      expect(screen.getByLabelText("Email")).toHaveValue("me@example.test");
      fireEvent.click(screen.getByRole("button", { name: "Masuk dengan kata sandi" }));
      expect(screen.getByLabelText("Kata sandi")).toBeVisible();
    });

    it("requests a magic link that never creates users and answers generically", async () => {
      router.search = { redirect: "/notes/abc" };
      auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
      render(<LoginPage />, { wrapper: PreferencesProvider });
      fireEvent.click(screen.getByRole("button", { name: "Kirim tautan masuk ke email" }));
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: " Me@Example.test " },
      });
      fireEvent.click(screen.getByRole("button", { name: "Kirim tautan masuk" }));
      expect(await screen.findByRole("status")).toHaveTextContent(/Jika email tersebut terdaftar/);
      expect(auth.signInWithOtp).toHaveBeenCalledWith({
        email: "me@example.test",
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      expect(localStorage.getItem("second-brain-auth-redirect")).toBe("/notes/abc");
      localStorage.clear();
    });

    it("gives the same answer for an unknown address (sign-up closed, no enumeration)", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      auth.signInWithOtp.mockResolvedValue({
        data: null,
        error: { status: 422, code: "otp_disabled", message: "Signups not allowed for otp" },
      });
      render(<LoginPage />, { wrapper: PreferencesProvider });
      fireEvent.click(screen.getByRole("button", { name: "Kirim tautan masuk ke email" }));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "x@example.test" } });
      fireEvent.click(screen.getByRole("button", { name: "Kirim tautan masuk" }));
      expect(await screen.findByRole("status")).toHaveTextContent(/Jika email tersebut terdaftar/);
    });

    it("starts Google sign-in through Supabase with the callback URL", async () => {
      vi.stubEnv("VITE_AUTH_GOOGLE", "true");
      auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
      render(<LoginPage />, { wrapper: PreferencesProvider });
      fireEvent.click(screen.getByRole("button", { name: "Masuk dengan Google" }));
      await waitFor(() =>
        expect(auth.signInWithOAuth).toHaveBeenCalledWith({
          provider: "google",
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        }),
      );
    });

    it("asks for the TOTP code after the password when the user has 2FA", async () => {
      auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
      levels("aal1", "aal2");
      auth.listFactors.mockResolvedValue({
        data: { all: [], totp: [{ id: "f1", status: "verified", friendly_name: "Phone" }] },
        error: null,
      });
      auth.challenge.mockResolvedValue({ data: { id: "c1" }, error: null });
      auth.verify.mockResolvedValue({ data: {}, error: null });
      render(<LoginPage />, { wrapper: PreferencesProvider });
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.test" } });
      fireEvent.change(screen.getByLabelText("Kata sandi"), { target: { value: "secret12" } });
      fireEvent.click(screen.getByRole("button", { name: "Masuk" }));

      const code = await screen.findByLabelText("Kode autentikasi");
      expect(router.navigate).not.toHaveBeenCalled();
      expect(code).toHaveAttribute("autocomplete", "one-time-code");
      expect(code).toHaveAttribute("inputmode", "numeric");

      auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      fireEvent.change(code, { target: { value: "123 456" } });
      await waitFor(() => expect(screen.getByRole("button", { name: "Verifikasi" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Verifikasi" }));
      await waitFor(() =>
        expect(auth.verify).toHaveBeenCalledWith({
          factorId: "f1",
          challengeId: "c1",
          code: "123456",
        }),
      );
      await waitFor(() =>
        expect(router.navigate).toHaveBeenCalledWith({ to: "/today", replace: true }),
      );
    });

    it("shows the TOTP step on load for a half-signed-in session and maps a wrong code", async () => {
      auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      levels("aal1", "aal2");
      auth.listFactors.mockResolvedValue({
        data: { all: [], totp: [{ id: "f1", status: "verified" }] },
        error: null,
      });
      auth.challenge.mockResolvedValue({ data: { id: "c1" }, error: null });
      auth.verify.mockResolvedValue({
        data: null,
        error: { status: 422, code: "mfa_verification_failed" },
      });
      render(<LoginPage />, { wrapper: PreferencesProvider });
      const code = await screen.findByLabelText("Kode autentikasi");
      fireEvent.change(code, { target: { value: "000000" } });
      await waitFor(() => expect(screen.getByRole("button", { name: "Verifikasi" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Verifikasi" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Kode salah atau kedaluwarsa");
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it("rejects a malformed code without calling Supabase", async () => {
      auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      levels("aal1", "aal2");
      auth.listFactors.mockResolvedValue({
        data: { all: [], totp: [{ id: "f1", status: "verified" }] },
        error: null,
      });
      render(<LoginPage />, { wrapper: PreferencesProvider });
      const code = await screen.findByLabelText("Kode autentikasi");
      fireEvent.change(code, { target: { value: "12ab" } });
      await waitFor(() => expect(screen.getByRole("button", { name: "Verifikasi" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Verifikasi" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Masukkan 6 digit angka.");
      expect(auth.challenge).not.toHaveBeenCalled();
    });
  });
});

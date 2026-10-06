import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn(), search: {} as { redirect?: string } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      signUp: auth.signUp,
      signInWithPassword: auth.signInWithPassword,
      onAuthStateChange: vi.fn(),
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

import { Route } from "@/routes/login";

type LoginRoute = {
  component: () => React.ReactElement;
  beforeLoad: (ctx: { search: { redirect?: string } }) => Promise<void>;
};
const route = Route as unknown as LoginRoute;
const LoginPage = route.component;

beforeEach(() => {
  auth.getSession.mockReset();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  router.navigate.mockReset();
  router.search = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/login", () => {
  it("links the logo and a text link back to the landing page", () => {
    render(<LoginPage />);

    expect(screen.getByRole("link", { name: /Kembali ke beranda/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /Second Brain — beranda/ })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("hides sign-up unless VITE_ALLOW_SIGNUP=true", () => {
    vi.stubEnv("VITE_ALLOW_SIGNUP", "");
    const { unmount } = render(<LoginPage />);
    expect(screen.queryByRole("button", { name: /Daftar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Pendaftaran ditutup/)).toBeInTheDocument();
    unmount();

    vi.stubEnv("VITE_ALLOW_SIGNUP", "true");
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: "Belum punya akun? Daftar" })).toBeInTheDocument();
    expect(screen.queryByText(/Pendaftaran ditutup/)).not.toBeInTheDocument();
  });

  it("shows the demo account, fills it in and never offers sign-up in demo mode", async () => {
    vi.stubEnv("VITE_APP_MODE", "demo");
    vi.stubEnv("VITE_ALLOW_SIGNUP", "true");
    render(<LoginPage />);

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
    render(<LoginPage />);

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
    render(<LoginPage />);
    expect(screen.queryByRole("button", { name: "Masuk sebagai demo" })).not.toBeInTheDocument();
  });

  it("lets guests stay on the form", async () => {
    await expect(route.beforeLoad({ search: {} })).resolves.toBeUndefined();
    render(<LoginPage />);
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

    render(<LoginPage />);

    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({ to: "/today", replace: true }),
    );
  });
});

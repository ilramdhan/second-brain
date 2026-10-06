import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  aal: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      exchangeCodeForSession: auth.exchangeCodeForSession,
      mfa: { getAuthenticatorAssuranceLevel: auth.aal },
    },
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
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
import { Route, resolveCallback } from "@/routes/auth/callback";

type PageRoute = {
  component: () => React.ReactElement;
  head: () => { meta: { name?: string; content?: string }[] };
};
const route = Route as unknown as PageRoute;
const Page = route.component;
const session = { user: { id: "u1" } };
const ORIGIN = "http://localhost:3000";

function visit(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Page />, { wrapper: PreferencesProvider });
}

beforeEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset();
  router.navigate.mockReset();
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.aal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
});
afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("/auth/callback", () => {
  it("is never indexed", () => {
    expect(route.head().meta.find((m) => m.name === "robots")?.content).toBe("noindex, nofollow");
  });

  it("exchanges a PKCE code and lands on the remembered target", async () => {
    localStorage.setItem("second-brain-auth-redirect", "/notes/abc");
    auth.exchangeCodeForSession.mockImplementation(async () => {
      auth.getSession.mockResolvedValue({ data: { session }, error: null });
      return { data: { session }, error: null };
    });
    visit("/auth/callback?code=abc123");
    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({ href: "/notes/abc", replace: true }),
    );
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    // The code is removed from the address bar.
    expect(window.location.search).toBe("");
  });

  it("does not exchange twice when supabase-js already stored the session", async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    await expect(resolveCallback(`${ORIGIN}/auth/callback?code=abc`)).resolves.toEqual({
      kind: "signed-in",
      target: "/today",
      mfa: false,
    });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("ignores an unsafe remembered target", async () => {
    localStorage.setItem("second-brain-auth-redirect", "//evil.test");
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    const result = await resolveCallback(`${ORIGIN}/auth/callback?code=abc`);
    expect(result).toMatchObject({ kind: "signed-in", target: "/today" });
  });

  it("explains a Google account without an app account (sign-up closed)", async () => {
    visit(
      "/auth/callback?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Akun belum terdaftar. Minta undangan dari pemilik proyek.",
    );
    expect(screen.getByRole("link", { name: "Ke halaman masuk" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("maps an expired magic link in the hash", async () => {
    visit("/auth/callback#error=access_denied&error_code=otp_expired&error_description=expired");
    expect(await screen.findByRole("alert")).toHaveTextContent(/kedaluwarsa/);
  });

  it("maps a failed code exchange", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { code: "flow_state_expired", message: "invalid flow state" },
    });
    await expect(resolveCallback(`${ORIGIN}/auth/callback?code=old`)).resolves.toEqual({
      kind: "error",
      key: "authCallbackExpired",
    });
  });

  it("treats a visit without code or session as an invalid link", async () => {
    await expect(resolveCallback(`${ORIGIN}/auth/callback`)).resolves.toEqual({
      kind: "error",
      key: "authCallbackExpired",
    });
  });

  it("hands a 2FA user to the TOTP step on /login, keeping the target", async () => {
    localStorage.setItem("second-brain-auth-redirect", "/projects/p1");
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    auth.aal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    visit("/auth/callback?code=abc");
    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({
        to: "/login",
        search: { redirect: "/projects/p1" },
        replace: true,
      }),
    );
  });
});

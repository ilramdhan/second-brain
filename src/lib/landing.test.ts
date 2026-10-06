import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: auth.getSession, onAuthStateChange: vi.fn() } },
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

import { APP_HOME } from "@/lib/auth";
import { APP_HOME_PATH, isSignedIn, redirectSignedInVisitor } from "@/lib/landing";

beforeEach(() => {
  auth.getSession.mockReset();
});

describe("landing redirect", () => {
  it("keeps the landing copy of the app home in sync with auth", () => {
    expect(APP_HOME_PATH).toBe(APP_HOME);
    expect(APP_HOME).toBe("/today");
  });

  it("lets guests see the landing page (no redirect, never to /login)", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });

    await expect(redirectSignedInVisitor()).resolves.toBeUndefined();
    expect(await isSignedIn()).toBe(false);
  });

  it("sends a signed-in visitor to /today", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    const thrown = await redirectSignedInVisitor().catch((e: unknown) => e);

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe("/today");
  });

  it("treats a failing session check (missing Supabase env) as a guest", async () => {
    // The lazy client proxy throws synchronously when the env vars are missing.
    auth.getSession.mockImplementation(() => {
      throw new Error("Missing Supabase environment variable(s)");
    });

    await expect(redirectSignedInVisitor()).resolves.toBeUndefined();
  });
});

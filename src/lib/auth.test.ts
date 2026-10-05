import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: auth.getSession, onAuthStateChange: auth.onAuthStateChange },
    rpc: auth.rpc,
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

import {
  handleAuthEvent,
  LOGIN_PATH,
  requireSession,
  resetAuthStateForTests,
  safeRedirect,
} from "@/lib/auth";

const session = (id: string) => ({ user: { id } }) as Session;

beforeEach(() => {
  vi.useFakeTimers();
  resetAuthStateForTests();
  auth.getSession.mockReset();
  auth.onAuthStateChange.mockReset();
  auth.rpc.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.useRealTimers());

describe("safeRedirect", () => {
  it("keeps same-origin paths only", () => {
    expect(safeRedirect("/tasks?view=kanban")).toBe("/tasks?view=kanban");
    expect(safeRedirect("//evil.com")).toBeUndefined();
    expect(safeRedirect("/\\evil.com")).toBeUndefined();
    expect(safeRedirect("https://evil.com")).toBeUndefined();
    expect(safeRedirect(LOGIN_PATH)).toBeUndefined();
    expect(safeRedirect(42)).toBeUndefined();
  });
});

describe("requireSession", () => {
  it("throws a router redirect to /login (not an error) without a session", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const thrown = await requireSession(new QueryClient(), "/calendar").catch((e: unknown) => e);
    expect(isRedirect(thrown)).toBe(true);
    const opts = (thrown as { options: { to: string; search: { redirect?: string } } }).options;
    expect(opts.to).toBe(LOGIN_PATH);
    expect(opts.search.redirect).toBe("/calendar");
  });

  it("returns the session and registers the auth listener once", async () => {
    auth.getSession.mockResolvedValue({ data: { session: session("u1") } });
    const qc = new QueryClient();
    await expect(requireSession(qc, "/")).resolves.toMatchObject({ user: { id: "u1" } });
    await requireSession(qc, "/tasks");
    expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1);
  });
});

describe("handleAuthEvent", () => {
  it("accepts project invites once per user, not on every session event", () => {
    const qc = new QueryClient();
    handleAuthEvent(qc, "INITIAL_SESSION", session("u1"));
    handleAuthEvent(qc, "SIGNED_IN", session("u1")); // tab became visible again
    handleAuthEvent(qc, "TOKEN_REFRESHED", session("u1"));
    handleAuthEvent(qc, "USER_UPDATED", session("u1"));
    vi.runAllTimers();
    expect(auth.rpc).toHaveBeenCalledTimes(1);
    expect(auth.rpc).toHaveBeenCalledWith("accept_project_invites");
  });

  it("clears the cache on sign-out and runs again for the next sign-in", () => {
    const qc = new QueryClient();
    qc.setQueryData(["tasks"], [{ id: "t1" }]);
    handleAuthEvent(qc, "SIGNED_IN", session("u1"));
    handleAuthEvent(qc, "SIGNED_OUT", null);
    expect(qc.getQueryData(["tasks"])).toBeUndefined();
    handleAuthEvent(qc, "SIGNED_IN", session("u1"));
    vi.runAllTimers();
    expect(auth.rpc).toHaveBeenCalledTimes(2);
  });

  it("ignores an initial event without a session", () => {
    handleAuthEvent(new QueryClient(), "INITIAL_SESSION", null);
    vi.runAllTimers();
    expect(auth.rpc).not.toHaveBeenCalled();
  });
});

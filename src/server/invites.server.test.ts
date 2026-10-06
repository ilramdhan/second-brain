import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inviteMemberInput } from "@/lib/invites.functions";
import { DemoDisabledError } from "@/server/demo/mode.server";
import {
  inviteMember,
  listInvites,
  OWNER_ONLY_MESSAGE,
  PROJECT_NOT_FOUND_MESSAGE,
  setPasswordRedirect,
} from "@/server/invites.server";
import { RateLimitError } from "@/server/rateLimit.server";

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const MEMBER = "00000000-0000-0000-0000-0000000000b2";
const PROJECT = "5b1f6a2e-3c4d-4e8f-9a0b-1c2d3e4f5a6b";

type Fake = {
  project: { id: string; user_id: string; name: string } | null;
  people: { email: string }[];
  rateLimit: boolean;
  upsert: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

/** Minimal RLS client: the project lookup, list_project_people, consume_rate_limit, the upsert. */
function fakeDb(f: Partial<Fake> = {}) {
  const state: Fake = {
    project: { id: PROJECT, user_id: OWNER, name: "Launch" },
    people: [{ email: "owner@example.test" }],
    rateLimit: true,
    upsert: vi.fn(async () => ({ error: null })),
    rpc: vi.fn(),
    ...f,
  };
  state.rpc.mockImplementation(async (fn: string) =>
    fn === "consume_rate_limit"
      ? { data: state.rateLimit, error: null }
      : { data: state.people, error: null },
  );
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    maybeSingle: async () => ({ data: state.project, error: null }),
  };
  const db = {
    rpc: state.rpc,
    from: (table: string) =>
      table === "projects" ? query : { upsert: state.upsert, select: () => query },
  };
  return { db: db as never, state };
}

const admin = () => ({ inviteUserByEmail: vi.fn(async () => ({ data: {}, error: null })) });

const call = (
  over: Partial<Parameters<typeof inviteMember>[0]> & { fake?: Partial<Fake> } = {},
) => {
  const { db, state } = fakeDb(over.fake);
  const a = (over.admin as unknown as ReturnType<typeof admin> | undefined) ?? admin();
  const run = inviteMember({
    db,
    admin: a as never,
    userId: OWNER,
    projectId: PROJECT,
    email: "new@example.test",
    redirectTo: "https://app.test/auth/set-password",
    env: {},
    ...over,
  });
  return { run, state, admin: a };
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("inviteMember", () => {
  it("saves the invite and asks Supabase to email a set-password link", async () => {
    const { run, state, admin: a } = call();
    await expect(run).resolves.toEqual({ status: "invited" });
    expect(state.upsert).toHaveBeenCalledWith(
      { project_id: PROJECT, email: "new@example.test", invited_by: OWNER },
      { onConflict: "project_id,email", ignoreDuplicates: true },
    );
    expect(a.inviteUserByEmail).toHaveBeenCalledWith("new@example.test", {
      redirectTo: "https://app.test/auth/set-password",
      data: { invited_project_id: PROJECT, invited_project_name: "Launch" },
    });
  });

  it("rejects a member who is not the project owner, before any write or email", async () => {
    const { run, state, admin: a } = call({ userId: MEMBER });
    await expect(run).rejects.toThrow(OWNER_ONLY_MESSAGE);
    expect(state.upsert).not.toHaveBeenCalled();
    expect(a.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("rejects an outsider who cannot see the project (RLS)", async () => {
    const { run, admin: a } = call({ fake: { project: null } });
    await expect(run).rejects.toThrow(PROJECT_NOT_FOUND_MESSAGE);
    expect(a.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("is refused in the demo before the rate limiter or the database", async () => {
    const { run, state, admin: a } = call({ env: { APP_MODE: "demo", VITE_APP_MODE: "demo" } });
    await expect(run).rejects.toBeInstanceOf(DemoDisabledError);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(a.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    const { run, state } = call({ fake: { rateLimit: false } });
    await expect(run).rejects.toBeInstanceOf(RateLimitError);
    await expect(run).rejects.toThrow(/undangan anggota/);
    expect(state.upsert).not.toHaveBeenCalled();
  });

  it("answers the same for an existing account (no email enumeration)", async () => {
    const a = {
      inviteUserByEmail: vi.fn(async () => ({
        data: null,
        error: { code: "email_exists", status: 422, message: "already been registered" },
      })),
    };
    const { run, state } = call({ admin: a as never });
    await expect(run).resolves.toEqual({ status: "invited" });
    expect(state.upsert).toHaveBeenCalled();
  });

  it("reports an email that could not be sent while keeping the invite", async () => {
    const limited = {
      inviteUserByEmail: vi.fn(async () => ({
        data: null,
        error: { code: "over_email_send_rate_limit", status: 429, message: "limit" },
      })),
    };
    await expect(call({ admin: limited as never }).run).resolves.toEqual({
      status: "invited",
      emailError: "rate_limited",
    });
    const broken = {
      inviteUserByEmail: vi.fn(async () => ({
        data: null,
        error: { code: "unexpected_failure", status: 500, message: "smtp" },
      })),
    };
    await expect(call({ admin: broken as never }).run).resolves.toEqual({
      status: "invited",
      emailError: "failed",
    });
  });

  it("does nothing for someone who is already in the project", async () => {
    const { run, state, admin: a } = call({ email: "owner@example.test" });
    await expect(run).resolves.toEqual({ status: "member" });
    expect(state.upsert).not.toHaveBeenCalled();
    expect(a.inviteUserByEmail).not.toHaveBeenCalled();
  });
});

describe("listInvites", () => {
  it("refuses a project the caller cannot see, before the service-role query", async () => {
    const { db } = fakeDb({ project: null });
    const from = vi.fn();
    await expect(listInvites({ db, admin: { from } as never, projectId: PROJECT })).rejects.toThrow(
      PROJECT_NOT_FOUND_MESSAGE,
    );
    expect(from).not.toHaveBeenCalled();
  });
});

describe("input and redirect", () => {
  it("normalizes and bounds the email", () => {
    expect(inviteMemberInput.parse({ projectId: PROJECT, email: "  A@Example.TEST " })).toEqual({
      projectId: PROJECT,
      email: "a@example.test",
    });
    expect(() => inviteMemberInput.parse({ projectId: PROJECT, email: "nope" })).toThrow();
    expect(() =>
      inviteMemberInput.parse({ projectId: PROJECT, email: `${"a".repeat(320)}@x.io` }),
    ).toThrow();
    expect(() => inviteMemberInput.parse({ projectId: "x", email: "a@b.co" })).toThrow();
  });

  it("builds the set-password URL from APP_URL, else the request origin", () => {
    expect(setPasswordRedirect({ APP_URL: "https://app.test/" })).toBe(
      "https://app.test/auth/set-password",
    );
    expect(setPasswordRedirect({}, "https://req.test")).toBe("https://req.test/auth/set-password");
    expect(setPasswordRedirect({})).toBeUndefined();
    expect(setPasswordRedirect({ APP_URL: "javascript:alert(1)" })).toBeUndefined();
  });
});

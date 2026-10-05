import { describe, expect, it, vi } from "vitest";

import {
  authorizeCronRequest,
  bearerToken,
  cronSecretsFromEnv,
  matchesAnySecret,
} from "./cronAuth.server";

const req = (auth?: string) =>
  new Request("https://app.example.com/api/public/hooks/reminders", {
    headers: auth ? { authorization: auth } : {},
  });

describe("bearerToken", () => {
  it("parses a single bearer token", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
  });
  it("rejects malformed headers", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken("Bearer a,b")).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
  });
});

describe("cronSecretsFromEnv / matchesAnySecret", () => {
  it("collects only non-empty secrets", () => {
    expect(
      cronSecretsFromEnv({
        LOVABLE_CRON_SECRET: "a",
        LOVABLE_CRON_SECRET_PREVIOUS: "",
        CRON_SECRET: " c ",
      }),
    ).toEqual(["a", "c"]);
    expect(cronSecretsFromEnv({})).toEqual([]);
  });
  it("matches any configured secret and never an empty list", () => {
    expect(matchesAnySecret("b", ["a", "b"])).toBe(true);
    expect(matchesAnySecret("x", ["a", "b"])).toBe(false);
    expect(matchesAnySecret("a", [])).toBe(false);
    expect(matchesAnySecret(null, ["a"])).toBe(false);
  });
});

describe("authorizeCronRequest", () => {
  const env = {
    LOVABLE_CRON_SECRET: "current",
    LOVABLE_CRON_SECRET_PREVIOUS: "previous",
    CRON_SECRET: "vercel",
  };

  it("accepts current, previous and generic secrets", async () => {
    for (const s of ["current", "previous", "vercel"])
      expect(await authorizeCronRequest(req(`Bearer ${s}`), { env })).toBe("ok");
  });

  it("rejects missing or wrong tokens without touching the legacy store when absent", async () => {
    const loadLegacyToken = vi.fn(async () => "legacy");
    expect(await authorizeCronRequest(req(), { env, loadLegacyToken })).toBe("unauthorized");
    expect(loadLegacyToken).not.toHaveBeenCalled();
    expect(await authorizeCronRequest(req("Bearer nope"), { env, loadLegacyToken })).toBe(
      "unauthorized",
    );
  });

  it("falls back to the legacy app_config token", async () => {
    const loadLegacyToken = vi.fn(async () => "legacy");
    expect(await authorizeCronRequest(req("Bearer legacy"), { env: {}, loadLegacyToken })).toBe(
      "ok",
    );
    expect(await authorizeCronRequest(req("Bearer current"), { env, loadLegacyToken })).toBe("ok");
    expect(loadLegacyToken).toHaveBeenCalledTimes(1);
  });

  it("fails closed when nothing is configured", async () => {
    expect(await authorizeCronRequest(req("Bearer x"), { env: {} })).toBe("unauthorized");
    expect(
      await authorizeCronRequest(req("Bearer x"), { env: {}, loadLegacyToken: async () => "" }),
    ).toBe("unauthorized");
  });
});

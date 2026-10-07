import { describe, expect, it, vi } from "vitest";

import {
  accessTokenFresh,
  buildAuthorizationUrl,
  createOAuthState,
  exchangeAuthorizationCode,
  GOOGLE_CALENDAR_SCOPE,
  googleOAuthConfig,
  parseStoredTokens,
  pkceChallenge,
  refreshAccessToken,
  verifyOAuthState,
} from "./googleOAuth.server";
import { decryptToken, encryptToken, tokenKeyBytes } from "./tokenCrypto.server";

const key = new Uint8Array(32).fill(7);
const otherKey = new Uint8Array(32).fill(9);
const config = { clientId: "cid", clientSecret: "secret", redirectUri: "https://app.test/cb" };

describe("tokenCrypto", () => {
  it("round-trips and uses a fresh IV", async () => {
    const a = await encryptToken("hello", key);
    const b = await encryptToken("hello", key);
    expect(a).not.toBe(b);
    expect(await decryptToken(a, key)).toBe("hello");
  });

  it("rejects a wrong key or tampered ciphertext", async () => {
    const value = await encryptToken("hello", key);
    await expect(decryptToken(value, otherKey)).rejects.toThrow(/tidak valid/);
    const tampered = (value[0] === "A" ? "B" : "A") + value.slice(1);
    await expect(decryptToken(tampered, key)).rejects.toThrow();
  });

  it("validates TOKEN_ENCRYPTION_KEY", () => {
    expect(() => tokenKeyBytes({})).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => tokenKeyBytes({ TOKEN_ENCRYPTION_KEY: btoa("short") })).toThrow(/32 byte/);
    expect(tokenKeyBytes({ TOKEN_ENCRYPTION_KEY: btoa("x".repeat(32)) })).toHaveLength(32);
  });
});

describe("googleOAuthConfig", () => {
  it("is null without client credentials", () => {
    expect(googleOAuthConfig({}, "https://a.test")).toBeNull();
  });
  it("prefers GOOGLE_OAUTH_REDIRECT_URL, then APP_URL, then the request origin", () => {
    const base = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" };
    expect(
      googleOAuthConfig({ ...base, GOOGLE_OAUTH_REDIRECT_URL: "https://x.test/r" })?.redirectUri,
    ).toBe("https://x.test/r");
    expect(googleOAuthConfig({ ...base, APP_URL: "https://app.test" })?.redirectUri).toBe(
      "https://app.test/oauth/google-calendar/return",
    );
    expect(googleOAuthConfig(base, "https://req.test")?.redirectUri).toBe(
      "https://req.test/oauth/google-calendar/return",
    );
  });
});

describe("OAuth state", () => {
  it("round-trips for the same user", async () => {
    const { state, verifier } = await createOAuthState("user-1", { key, now: 1000 });
    expect(await verifyOAuthState(state, "user-1", { key, now: 2000 })).toBe(verifier);
  });
  it("rejects another user, expiry and tampering", async () => {
    const { state } = await createOAuthState("user-1", { key, now: 1000 });
    await expect(verifyOAuthState(state, "user-2", { key, now: 2000 })).rejects.toMatchObject({
      code: "state_user_mismatch",
    });
    await expect(
      verifyOAuthState(state, "user-1", { key, now: 1000 + 11 * 60_000 }),
    ).rejects.toMatchObject({ code: "state_expired" });
    await expect(verifyOAuthState(state, "user-1", { key: otherKey })).rejects.toMatchObject({
      code: "bad_state",
    });
  });
});

describe("PKCE + authorization URL", () => {
  it("computes the RFC 7636 S256 challenge", async () => {
    // Test vector from RFC 7636 appendix B.
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("requests offline access for calendar.events with PKCE", () => {
    const url = new URL(buildAuthorizationUrl(config, "st", "ch"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_CALENDAR_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });
});

describe("token exchange / refresh", () => {
  const ok = (body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it("stores the refresh token and expiry", async () => {
    const fetchImpl = ok({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: GOOGLE_CALENDAR_SCOPE,
    });
    const tokens = await exchangeAuthorizationCode(config, "code", "verifier", {
      fetchImpl,
      now: 0,
    });
    expect(tokens).toMatchObject({ v: 1, refresh_token: "rt", access_token: "at" });
    expect(tokens.expires_at).toBe(3_600_000);
    const body = String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain("code_verifier=verifier");
    expect(body).toContain("grant_type=authorization_code");
  });

  it("fails without a refresh token or calendar scope", async () => {
    await expect(
      exchangeAuthorizationCode(config, "c", "v", { fetchImpl: ok({ access_token: "a" }) }),
    ).rejects.toMatchObject({ code: "no_refresh_token" });
    await expect(
      exchangeAuthorizationCode(config, "c", "v", {
        fetchImpl: ok({ access_token: "a", refresh_token: "r", scope: "email" }),
      }),
    ).rejects.toMatchObject({ code: "scope_denied" });
  });

  it("refreshes and surfaces invalid_grant", async () => {
    const tokens = { v: 1 as const, refresh_token: "rt" };
    const refreshed = await refreshAccessToken(config, tokens, {
      fetchImpl: ok({ access_token: "new", expires_in: 60 }),
      now: 0,
    });
    expect(refreshed).toMatchObject({
      refresh_token: "rt",
      access_token: "new",
      expires_at: 60_000,
    });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    await expect(refreshAccessToken(config, tokens, { fetchImpl })).rejects.toMatchObject({
      code: "invalid_grant",
    });
  });

  it("treats tokens expiring within a minute as stale", () => {
    expect(
      accessTokenFresh({ v: 1, refresh_token: "r", access_token: "a", expires_at: 120_000 }, 0),
    ).toBe(true);
    expect(
      accessTokenFresh({ v: 1, refresh_token: "r", access_token: "a", expires_at: 30_000 }, 0),
    ).toBe(false);
  });

  it("parses stored tokens defensively", () => {
    expect(parseStoredTokens('{"v":1,"refresh_token":"r"}')).toMatchObject({ refresh_token: "r" });
    expect(parseStoredTokens("legacy-connection-key")).toBeNull();
    expect(parseStoredTokens('{"v":2}')).toBeNull();
  });
});

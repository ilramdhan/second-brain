import { afterEach, describe, expect, it } from "vitest";

import {
  AUTH_CALLBACK_PATH,
  authCallbackErrorKey,
  authCallbackUrl,
  googleAuthEnabled,
  magicLinkEnabled,
  rememberAuthRedirect,
  takeAuthRedirect,
} from "@/lib/auth-methods";

afterEach(() => localStorage.clear());

describe("feature flags", () => {
  it("hides Google unless VITE_AUTH_GOOGLE=true, and always in the demo", () => {
    expect(googleAuthEnabled(undefined, false)).toBe(false);
    expect(googleAuthEnabled("false", false)).toBe(false);
    expect(googleAuthEnabled(" TRUE ", false)).toBe(true);
    expect(googleAuthEnabled("true", true)).toBe(false);
  });

  it("enables magic links by default, off with false or in the demo", () => {
    expect(magicLinkEnabled(undefined, false)).toBe(true);
    expect(magicLinkEnabled("", false)).toBe(true);
    expect(magicLinkEnabled("false", false)).toBe(false);
    expect(magicLinkEnabled("true", true)).toBe(false);
  });
});

describe("callback URL and redirect", () => {
  it("points at /auth/callback on the current origin", () => {
    expect(authCallbackUrl("https://app.test")).toBe(`https://app.test${AUTH_CALLBACK_PATH}`);
  });

  it("remembers only safe internal targets, once", () => {
    rememberAuthRedirect("/notes/abc");
    expect(takeAuthRedirect()).toBe("/notes/abc");
    expect(takeAuthRedirect()).toBeUndefined();
    rememberAuthRedirect("//evil.test");
    expect(takeAuthRedirect()).toBeUndefined();
    localStorage.setItem("second-brain-auth-redirect", "https://evil.test");
    expect(takeAuthRedirect()).toBeUndefined();
  });
});

describe("authCallbackErrorKey", () => {
  it("maps a closed sign-up (new Google account) to the invite hint", () => {
    expect(
      authCallbackErrorKey({
        code: "signup_disabled",
        description: "Signups not allowed for this instance",
      }),
    ).toBe("authCallbackNotRegistered");
    expect(
      authCallbackErrorKey({ code: "server_error", description: "Signups not allowed for otp" }),
    ).toBe("authCallbackNotRegistered");
  });

  it("maps expired links, cancellations and disabled providers", () => {
    expect(authCallbackErrorKey({ code: "otp_expired", description: "" })).toBe(
      "authCallbackExpired",
    );
    expect(authCallbackErrorKey({ code: "access_denied", description: "" })).toBe(
      "authCallbackCancelled",
    );
    expect(
      authCallbackErrorKey({
        code: "validation_failed",
        description: "Unsupported provider: provider is not enabled",
      }),
    ).toBe("authCallbackProviderOff");
    expect(authCallbackErrorKey({ code: "weird", description: "?" })).toBe("authCallbackFailed");
  });
});

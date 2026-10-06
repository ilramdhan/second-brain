import { describe, expect, it } from "vitest";

import { needsMfaChallenge, normalizeTotpCode, totpErrorKey } from "@/lib/mfa";

describe("needsMfaChallenge", () => {
  it("is true only for an aal1 session that can reach aal2", () => {
    expect(needsMfaChallenge({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
    expect(needsMfaChallenge({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
    expect(needsMfaChallenge({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
    expect(needsMfaChallenge({ currentLevel: null, nextLevel: null })).toBe(false);
    expect(needsMfaChallenge(null)).toBe(false);
  });
});

describe("normalizeTotpCode", () => {
  it("accepts six digits with spaces or dashes", () => {
    expect(normalizeTotpCode("123456")).toBe("123456");
    expect(normalizeTotpCode(" 123 456 ")).toBe("123456");
    expect(normalizeTotpCode("123-456")).toBe("123456");
  });
  it("rejects anything else", () => {
    expect(normalizeTotpCode("12345")).toBeNull();
    expect(normalizeTotpCode("1234567")).toBeNull();
    expect(normalizeTotpCode("12a456")).toBeNull();
  });
});

describe("totpErrorKey", () => {
  it("maps wrong codes and rate limits", () => {
    expect(totpErrorKey({ code: "mfa_verification_failed", status: 422 })).toBe("mfaCodeInvalid");
    expect(totpErrorKey({ code: "mfa_challenge_expired" })).toBe("mfaCodeInvalid");
    expect(totpErrorKey({ status: 429 })).toBe("mfaTooMany");
    expect(totpErrorKey({ status: 500 })).toBeUndefined();
    expect(totpErrorKey(null)).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import {
  RECOVERY_ALPHABET,
  RECOVERY_CODE_COUNT,
  findMatchingCode,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  recoveryHashKey,
} from "./mfaRecovery.server";

const USER = "00000000-0000-0000-0000-00000000a001";
const OTHER = "00000000-0000-0000-0000-00000000a002";
const KEY = recoveryHashKey({
  TOKEN_ENCRYPTION_KEY: "c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LTEyMzQ=",
});

describe("recovery code generation", () => {
  it("produces XXXX-XXXX from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRecoveryCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    }
    expect(RECOVERY_ALPHABET).toHaveLength(32);
    expect(RECOVERY_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it("maps every byte value onto the alphabet", () => {
    expect(generateRecoveryCode((b) => b.fill(0))).toBe("0000-0000");
    expect(generateRecoveryCode((b) => b.fill(255))).toBe("ZZZZ-ZZZZ");
    expect(generateRecoveryCode((b) => b.fill(32 + 10))).toBe("AAAA-AAAA");
  });

  it("returns a batch of distinct codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });
});

describe("normalizeRecoveryCode", () => {
  it("accepts case, spaces, missing dash and look-alikes", () => {
    expect(normalizeRecoveryCode("abcd-ef12")).toBe("ABCD-EF12");
    expect(normalizeRecoveryCode(" ab cd ef 12 ")).toBe("ABCD-EF12");
    expect(normalizeRecoveryCode("O0IL-1234")).toBe("0011-1234");
  });

  it("rejects wrong lengths and characters", () => {
    expect(normalizeRecoveryCode("ABC-DEF")).toBeNull();
    expect(normalizeRecoveryCode("ABCD-EF123")).toBeNull();
    expect(normalizeRecoveryCode("ABCD-EFU2")).toBeNull();
    expect(normalizeRecoveryCode("ABCD#EF12")).toBeNull();
    expect(normalizeRecoveryCode("")).toBeNull();
  });
});

describe("hashing and verification", () => {
  it("uses an HMAC with the server key, or a user-salted SHA-256 without it", () => {
    const keyed = hashRecoveryCode(USER, "ABCD-EF12", KEY);
    const salted = hashRecoveryCode(USER, "ABCD-EF12", null);
    expect(keyed).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(salted).toMatch(/^s1:[0-9a-f]{64}$/);
    expect(keyed).not.toContain("ABCD");
    expect(hashRecoveryCode(OTHER, "ABCD-EF12", KEY)).not.toBe(keyed);
    expect(recoveryHashKey({})).toBeNull();
  });

  it("finds the matching row and ignores other users' hashes", () => {
    const rows = [
      { id: "a", code_hash: hashRecoveryCode(USER, "AAAA-AAAA", KEY) },
      { id: "b", code_hash: hashRecoveryCode(USER, "BBBB-BBBB", KEY) },
      { id: "c", code_hash: hashRecoveryCode(USER, "CCCC-CCCC", null) },
    ];
    expect(findMatchingCode(USER, "bbbb bbbb", rows, KEY)).toBe("b");
    // Rows hashed before the key existed still verify.
    expect(findMatchingCode(USER, "CCCC-CCCC", rows, KEY)).toBe("c");
    expect(findMatchingCode(USER, "DDDD-DDDD", rows, KEY)).toBeNull();
    expect(findMatchingCode(OTHER, "AAAA-AAAA", rows, KEY)).toBeNull();
    expect(findMatchingCode(USER, "not a code", rows, KEY)).toBeNull();
    // A keyed hash never verifies without the key.
    expect(findMatchingCode(USER, "AAAA-AAAA", rows, null)).toBeNull();
  });
});

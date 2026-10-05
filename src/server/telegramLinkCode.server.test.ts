import { describe, expect, it } from "vitest";

import {
  formatLinkCode,
  generateLinkCode,
  hashLinkCode,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  LINK_CODE_TTL_MS,
  linkCodeExpiry,
  normalizeLinkCode,
  parseLinkCommand,
} from "./telegramLinkCode.server";

describe("generateLinkCode", () => {
  it("produces 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateLinkCode();
      expect(code).toHaveLength(LINK_CODE_LENGTH);
      expect([...code].every((c) => LINK_CODE_ALPHABET.includes(c))).toBe(true);
      expect(code).not.toMatch(/[01IO]/);
    }
  });

  it("maps random bytes onto the alphabet", () => {
    const bytes = Uint8Array.from([0, 1, 31, 32, 33, 255, 8, 24]);
    expect(generateLinkCode(() => bytes)).toBe("AB9AB9J2");
  });

  it("does not repeat across calls", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateLinkCode()));
    expect(codes.size).toBe(500);
  });
});

describe("normalizeLinkCode", () => {
  it("accepts the display form, lowercase and stray spaces", () => {
    expect(normalizeLinkCode("K7QM-4XPA")).toBe("K7QM4XPA");
    expect(normalizeLinkCode(" k7qm 4xpa ")).toBe("K7QM4XPA");
    expect(normalizeLinkCode(formatLinkCode("K7QM4XPA"))).toBe("K7QM4XPA");
  });

  it("rejects wrong length or characters outside the alphabet", () => {
    expect(normalizeLinkCode("")).toBeNull();
    expect(normalizeLinkCode("K7QM4XP")).toBeNull();
    expect(normalizeLinkCode("K7QM4XPAA")).toBeNull();
    expect(normalizeLinkCode("K7QM4XP0")).toBeNull();
    expect(normalizeLinkCode("someone@example.com")).toBeNull();
  });
});

describe("hashLinkCode", () => {
  it("returns a stable sha256 hex digest that differs from the code", () => {
    const hash = hashLinkCode("K7QM4XPA");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashLinkCode("K7QM4XPA"));
    expect(hash).not.toBe(hashLinkCode("K7QM4XPB"));
  });
});

describe("linkCodeExpiry", () => {
  it("expires after 10 minutes", () => {
    const now = new Date("2026-10-05T10:00:00Z");
    expect(LINK_CODE_TTL_MS).toBe(600_000);
    expect(linkCodeExpiry(now).getTime() - now.getTime()).toBe(LINK_CODE_TTL_MS);
  });
});

describe("parseLinkCommand", () => {
  it("extracts the argument", () => {
    expect(parseLinkCommand("/link K7QM-4XPA")).toBe("K7QM-4XPA");
    expect(parseLinkCommand("/link@SecondBrainBot  K7QM4XPA ")).toBe("K7QM4XPA");
    expect(parseLinkCommand("/link")).toBe("");
  });

  it("ignores other text", () => {
    expect(parseLinkCommand("/linkage")).toBeNull();
    expect(parseLinkCommand("beli susu /link")).toBeNull();
    expect(parseLinkCommand("/start")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { checkWebhookSecret, secretsMatch } from "./telegramSecurity.server";

describe("secretsMatch", () => {
  it("accepts identical strings", () => {
    expect(secretsMatch("s3cret-value", "s3cret-value")).toBe(true);
  });

  it("rejects different strings, including different lengths", () => {
    expect(secretsMatch("s3cret-valuf", "s3cret-value")).toBe(false);
    expect(secretsMatch("short", "s3cret-value")).toBe(false);
    expect(secretsMatch("s3cret-value-longer", "s3cret-value")).toBe(false);
    expect(secretsMatch("", "s3cret-value")).toBe(false);
  });

  it("rejects missing values", () => {
    expect(secretsMatch(null, "s3cret-value")).toBe(false);
    expect(secretsMatch(undefined, "s3cret-value")).toBe(false);
  });
});

describe("checkWebhookSecret", () => {
  it("fails closed when the secret is not configured", () => {
    expect(checkWebhookSecret("anything", undefined)).toBe("missing-secret");
    expect(checkWebhookSecret("anything", "")).toBe("missing-secret");
    expect(checkWebhookSecret(null, null)).toBe("missing-secret");
  });

  it("rejects a missing or wrong header", () => {
    expect(checkWebhookSecret(null, "expected")).toBe("mismatch");
    expect(checkWebhookSecret("wrong", "expected")).toBe("mismatch");
  });

  it("accepts the matching header", () => {
    expect(checkWebhookSecret("expected", "expected")).toBe("ok");
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  AI_RATE_LIMIT,
  base64DecodedBytes,
  enforceRateLimit,
  formatWindow,
  RateLimitError,
  rateLimitMessage,
} from "./rateLimit.server";

const client = (result: { data: boolean | null; error: { message: string } | null }) => ({
  rpc: vi.fn(async () => result),
});

describe("enforceRateLimit", () => {
  it("passes the rule to consume_rate_limit and allows when true", async () => {
    const c = client({ data: true, error: null });
    await expect(enforceRateLimit(c, AI_RATE_LIMIT)).resolves.toBeUndefined();
    expect(c.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      _bucket: "ai",
      _max: 30,
      _window_seconds: 600,
    });
  });

  it("throws a friendly RateLimitError when the budget is exhausted", async () => {
    const err = await enforceRateLimit(client({ data: false, error: null }), AI_RATE_LIMIT).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as Error).message).toBe(rateLimitMessage(AI_RATE_LIMIT));
    expect((err as Error).message).toContain("30 permintaan per 10 menit");
  });

  it("fails closed when the limiter errors or returns null", async () => {
    await expect(
      enforceRateLimit(client({ data: null, error: { message: "boom" } }), AI_RATE_LIMIT),
    ).rejects.toBeInstanceOf(RateLimitError);
    await expect(
      enforceRateLimit(client({ data: null, error: null }), AI_RATE_LIMIT),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("helpers", () => {
  it("formats windows", () => {
    expect(formatWindow(600)).toBe("10 menit");
    expect(formatWindow(3600)).toBe("1 jam");
    expect(formatWindow(45)).toBe("45 detik");
  });

  it("computes decoded base64 size without decoding", () => {
    for (const s of ["", "a", "ab", "abc", "abcd", "hello world!!"]) {
      expect(base64DecodedBytes(btoa(s))).toBe(s.length);
    }
  });
});

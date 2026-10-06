import { describe, expect, it } from "vitest";

import {
  clientIp,
  createIpRateLimiter,
  DEFAULT_DEMO_IP_LIMIT,
  demoIpLimit,
  demoRateLimitResponse,
  isLimitedPath,
} from "./ipRateLimit.server";

const req = (headers: Record<string, string> = {}) =>
  new Request("https://demo.test/_serverFn/x", { headers });

describe("demo IP rate limiter", () => {
  it("keys on x-real-ip, else the first x-forwarded-for hop", () => {
    expect(clientIp(req({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(req({ "x-forwarded-for": " 3.3.3.3 , 10.0.0.1" }))).toBe("3.3.3.3");
    expect(clientIp(req())).toBe("unknown");
  });

  it("reads DEMO_IP_RATE_LIMIT with a safe default", () => {
    expect(demoIpLimit({})).toBe(DEFAULT_DEMO_IP_LIMIT);
    expect(demoIpLimit({ DEMO_IP_RATE_LIMIT: "30" })).toBe(30);
    expect(demoIpLimit({ DEMO_IP_RATE_LIMIT: "0" })).toBe(DEFAULT_DEMO_IP_LIMIT);
    expect(demoIpLimit({ DEMO_IP_RATE_LIMIT: "abc" })).toBe(DEFAULT_DEMO_IP_LIMIT);
  });

  it("allows `limit` requests per window, then reports Retry-After", () => {
    let t = 1_000_000;
    const limiter = createIpRateLimiter({ limit: 2, windowMs: 60_000, now: () => t });
    expect(limiter.consume("a")).toEqual({ allowed: true, retryAfter: 0 });
    expect(limiter.consume("a")).toEqual({ allowed: true, retryAfter: 0 });
    t += 15_000;
    expect(limiter.consume("a")).toEqual({ allowed: false, retryAfter: 45 });
    // Another IP has its own budget.
    expect(limiter.consume("b").allowed).toBe(true);
    // A new window starts fresh.
    t += 45_000;
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("caps the number of tracked IPs", () => {
    let t = 0;
    const limiter = createIpRateLimiter({ limit: 1, maxEntries: 3, now: () => t });
    for (const ip of ["a", "b", "c"]) limiter.consume(ip);
    expect(limiter.size()).toBe(3);
    limiter.consume("d"); // evicts the oldest live entry ("a")
    expect(limiter.size()).toBe(3);
    expect(limiter.consume("a").allowed).toBe(true);
    // Expired windows are dropped first.
    t += 60_000;
    limiter.consume("e");
    expect(limiter.size()).toBe(1);
  });

  it("limits server functions and API endpoints only", () => {
    expect(isLimitedPath("/_serverFn/abc")).toBe(true);
    expect(isLimitedPath("/api/public/n8n/bot")).toBe(true);
    expect(isLimitedPath("/today")).toBe(false);
    expect(isLimitedPath("/apis")).toBe(false);
  });

  it("answers 429 JSON with Retry-After once over budget", async () => {
    const env = { DEMO_IP_RATE_LIMIT: "1" };
    const ip = { "x-real-ip": "9.9.9.9" };
    expect(demoRateLimitResponse(req(ip), env)).toBeNull();
    const res = demoRateLimitResponse(req(ip), env);
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res?.json()).toEqual({ error: expect.stringMatching(/^Batas demo:/) });
  });
});

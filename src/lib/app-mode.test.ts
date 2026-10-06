import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DEMO_EMAIL,
  DEFAULT_DEMO_PASSWORD,
  DEFAULT_PROD_URL,
  demoCredentials,
  isDemo,
  prodUrl,
  robotsFor,
} from "@/lib/app-mode";
import { publicPageHead } from "@/lib/landing";

afterEach(() => vi.unstubAllEnvs());

describe("app mode (client)", () => {
  it("is the demo only for VITE_APP_MODE=demo", () => {
    expect(isDemo("demo")).toBe(true);
    expect(isDemo(" Demo ")).toBe(true);
    expect(isDemo("")).toBe(false);
    expect(isDemo("production")).toBe(false);
    expect(isDemo(undefined)).toBe(false);

    vi.stubEnv("VITE_APP_MODE", "demo");
    expect(isDemo()).toBe(true);
  });

  it("falls back to the default demo account", () => {
    expect(demoCredentials("", undefined)).toEqual({
      email: DEFAULT_DEMO_EMAIL,
      password: DEFAULT_DEMO_PASSWORD,
    });
    expect(demoCredentials(" a@b.c ", "pw")).toEqual({ email: "a@b.c", password: "pw" });
  });

  it("accepts only absolute http(s) production URLs", () => {
    expect(prodUrl("")).toBe(DEFAULT_PROD_URL);
    expect(prodUrl("javascript:alert(1)")).toBe(DEFAULT_PROD_URL);
    expect(prodUrl("not a url")).toBe(DEFAULT_PROD_URL);
    expect(prodUrl("https://example.com/")).toBe("https://example.com");
  });

  it("never lets the demo be indexed", () => {
    expect(robotsFor("index, follow", false)).toBe("index, follow");
    expect(robotsFor("index, follow", true)).toBe("noindex, nofollow");

    const robots = () =>
      publicPageHead({ title: "t", description: "d", path: "/" }).meta.find(
        (m) => "name" in m && m.name === "robots",
      );
    expect(robots()).toEqual({ name: "robots", content: "index, follow" });
    vi.stubEnv("VITE_APP_MODE", "demo");
    expect(robots()).toEqual({ name: "robots", content: "noindex, nofollow" });
  });
});

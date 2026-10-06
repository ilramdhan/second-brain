import { afterEach, describe, expect, it, vi } from "vitest";

import { assertNotDemo, DemoDisabledError, isDemoMode, resetDemoModeWarning } from "./mode.server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetDemoModeWarning();
});

describe("demo mode (server)", () => {
  it("is driven by APP_MODE", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(isDemoMode({ APP_MODE: "demo", VITE_APP_MODE: "demo" })).toBe(true);
    expect(isDemoMode({ APP_MODE: " DEMO ", VITE_APP_MODE: "demo" })).toBe(true);
    expect(isDemoMode({})).toBe(false);
    expect(isDemoMode({ APP_MODE: "production" })).toBe(false);
    // The client flag alone never turns the server guards on.
    expect(isDemoMode({ VITE_APP_MODE: "demo" })).toBe(false);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("VITE_APP_MODE", "demo");
    expect(isDemoMode()).toBe(true);
  });

  it("warns once when APP_MODE and VITE_APP_MODE disagree", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    isDemoMode({ APP_MODE: "demo" });
    isDemoMode({ APP_MODE: "demo" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/disagree/);
  });

  it("does not warn when both agree", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    isDemoMode({});
    isDemoMode({ APP_MODE: "demo", VITE_APP_MODE: "demo" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("assertNotDemo throws a DemoDisabledError only in demo", () => {
    expect(() => assertNotDemo("Telegram", {})).not.toThrow();
    let thrown: unknown;
    try {
      assertNotDemo("Telegram", { APP_MODE: "demo", VITE_APP_MODE: "demo" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DemoDisabledError);
    expect((thrown as DemoDisabledError).feature).toBe("Telegram");
    expect((thrown as Error).message).toBe("Tidak tersedia di demo: Telegram.");
  });
});

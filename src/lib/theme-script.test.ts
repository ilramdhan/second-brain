import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CSP_ENFORCED, CSP_REPORT_ONLY } from "@/server/securityHeaders";

import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme-script";

function run(stored: string | null, systemDark: boolean) {
  if (stored === null) localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, stored);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: systemDark } as Partial<MediaQueryList>),
  );
  new Function(THEME_INIT_SCRIPT)();
  const root = document.documentElement;
  return { dark: root.classList.contains("dark"), scheme: root.style.colorScheme };
}

describe("theme init script", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  it("applies an explicit stored theme regardless of the OS setting", () => {
    expect(run("dark", false)).toEqual({ dark: true, scheme: "dark" });
    expect(run("light", true)).toEqual({ dark: false, scheme: "light" });
  });

  it("follows prefers-color-scheme for `system` or no stored value", () => {
    expect(run("system", true)).toEqual({ dark: true, scheme: "dark" });
    expect(run(null, true)).toEqual({ dark: true, scheme: "dark" });
    expect(run(null, false)).toEqual({ dark: false, scheme: "light" });
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => new Function(THEME_INIT_SCRIPT)()).not.toThrow();
    vi.restoreAllMocks();
  });

  it("is allowed by every CSP that restricts scripts ('unsafe-inline' or its sha256)", () => {
    const hash = `'sha256-${createHash("sha256").update(THEME_INIT_SCRIPT).digest("base64")}'`;
    for (const policy of [CSP_ENFORCED, CSP_REPORT_ONLY]) {
      const scriptSrc = policy.split(";").find((d) => d.trim().startsWith("script-src"));
      if (!scriptSrc) continue; // No script-src: falls back to default-src only if present.
      expect(scriptSrc.includes("'unsafe-inline'") || scriptSrc.includes(hash)).toBe(true);
    }
  });
});

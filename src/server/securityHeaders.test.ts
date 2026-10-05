import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CSP_ENFORCED,
  CSP_REPORT_ONLY,
  SECURITY_HEADERS,
  shouldApplyServerHeaders,
  withSecurityHeaders,
} from "./securityHeaders";

type VercelConfig = {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

describe("security headers", () => {
  it("vercel.json applies exactly SECURITY_HEADERS to every path", () => {
    const cfg = JSON.parse(
      readFileSync(resolve(__dirname, "../../vercel.json"), "utf8"),
    ) as VercelConfig;
    const all = cfg.headers.find((h) => h.source === "/(.*)");
    expect(all).toBeDefined();
    expect(Object.fromEntries(all!.headers.map((h) => [h.key, h.value]))).toEqual(SECURITY_HEADERS);
  });

  it("enforces framing protection and keeps the resource policy report-only", () => {
    expect(CSP_ENFORCED).toContain("frame-ancestors 'none'");
    expect(CSP_ENFORCED).not.toContain("default-src");
    expect(CSP_REPORT_ONLY).toContain(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    );
    expect(CSP_REPORT_ONLY).toContain("worker-src 'self'");
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("microphone=(self)");
  });

  it("adds missing headers without overriding route-specific ones", async () => {
    const res = withSecurityHeaders(
      new Response("ok", { headers: { "Referrer-Policy": "no-referrer" } }),
    );
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("ok");
  });

  it("copies responses with immutable headers", async () => {
    const original = Response.redirect("https://example.com/", 302);
    const res = withSecurityHeaders(original);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("applies server-side in production unless disabled", () => {
    expect(shouldApplyServerHeaders({}, true)).toBe(true);
    expect(shouldApplyServerHeaders({ VERCEL: "1" }, true)).toBe(true);
    expect(shouldApplyServerHeaders({ SECURITY_HEADERS: "off" }, true)).toBe(false);
    expect(shouldApplyServerHeaders({}, false)).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  assertSafeUrl,
  assertSafeUrlShape,
  isBlockedIp,
  parseIPv6,
  safeWebhookPost,
} from "./ssrf.server";

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "2001:db8::1",
    "[::1]",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "allows public %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );
});

describe("parseIPv6", () => {
  it("expands compressed forms and embedded IPv4", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(parseIPv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("rejects malformed input", () => {
    expect(parseIPv6("1::2::3")).toBeNull();
    expect(parseIPv6("1:2:3")).toBeNull();
    expect(parseIPv6("gggg::1")).toBeNull();
  });
});

describe("assertSafeUrlShape", () => {
  it("accepts a normal https URL", () => {
    expect(assertSafeUrlShape("https://hooks.slack.com/services/x").hostname).toBe(
      "hooks.slack.com",
    );
    expect(assertSafeUrlShape("https://example.com:8443/hook").port).toBe("8443");
  });

  it.each([
    ["http://example.com/hook", "https"],
    ["ftp://example.com", "https"],
    ["https://user:pass@example.com", "kredensial"],
    ["https://example.com:22/", "Port"],
    ["https://example.com:80/", "Port"],
    ["https://localhost/hook", "internal"],
    ["https://foo.localhost/", "internal"],
    ["https://metadata.google.internal/computeMetadata/v1/", "internal"],
    ["https://db.internal/", "internal"],
    ["https://printer.local/", "internal"],
    ["https://intranet/", "internal"],
    ["https://127.0.0.1/", "internal"],
    ["https://2130706433/", "internal"], // decimal 127.0.0.1
    ["https://0x7f000001/", "internal"], // hex 127.0.0.1
    ["https://0177.0.0.1/", "internal"], // octal 127.0.0.1
    ["https://169.254.169.254/latest/meta-data", "internal"],
    ["https://[::1]/", "internal"],
    ["https://[::ffff:127.0.0.1]/", "internal"],
    ["https://[fd00::1]/", "internal"],
    ["not a url", "tidak valid"],
  ])("rejects %s", (url, msg) => {
    expect(() => assertSafeUrlShape(url)).toThrow(msg);
  });
});

describe("assertSafeUrl (DNS)", () => {
  it("rejects hostnames that resolve to private addresses", async () => {
    await expect(
      assertSafeUrl("https://rebind.example.com/", async () => ["8.8.8.8", "10.0.0.5"]),
    ).rejects.toThrow("internal");
    await expect(
      assertSafeUrl("https://v6.example.com/", async () => ["::ffff:169.254.169.254"]),
    ).rejects.toThrow("internal");
  });

  it("rejects hostnames that do not resolve", async () => {
    await expect(assertSafeUrl("https://nx.example.com/", async () => [])).rejects.toThrow(
      "resolve",
    );
  });

  it("accepts public addresses and falls back to static checks without DNS", async () => {
    await expect(
      assertSafeUrl("https://ok.example.com/", async () => ["93.184.216.34"]),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertSafeUrl("https://ok.example.com/", async () => null),
    ).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl("https://localhost/", async () => null)).rejects.toThrow();
  });
});

describe("safeWebhookPost", () => {
  const resolve = async () => ["93.184.216.34"];

  it("posts with manual redirects and a timeout signal", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    await expect(
      safeWebhookPost("https://ok.example.com/", { a: 1 }, { resolve, fetchImpl }),
    ).resolves.toEqual({ status: 200 });
    const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("treats redirects and error statuses as failures", async () => {
    const redirect = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "https://10.0.0.1/" } }),
    );
    await expect(
      safeWebhookPost("https://ok.example.com/", {}, { resolve, fetchImpl: redirect }),
    ).rejects.toThrow("redirect");
    const fail = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(
      safeWebhookPost("https://ok.example.com/", {}, { resolve, fetchImpl: fail }),
    ).rejects.toThrow("Webhook 500");
  });

  it("never calls fetch for unsafe URLs", async () => {
    const fetchImpl = vi.fn();
    await expect(
      safeWebhookPost("https://127.0.0.1/", {}, { resolve, fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps timeouts to a friendly error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(
      safeWebhookPost("https://ok.example.com/", {}, { resolve, fetchImpl }),
    ).rejects.toThrow("timeout");
  });
});

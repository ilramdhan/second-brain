// Edge cases for the SSRF guard not covered by ssrf.server.test.ts: the node:dns resolver,
// DNS rebinding between checks, opaque redirects, network errors, the response body cap and
// less common IPv4/IPv6 ranges.
import { afterEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup }));

const {
  assertSafeUrl,
  assertSafeUrlShape,
  isBlockedIp,
  nodeResolver,
  parseIPv4,
  safeWebhookPost,
  UnsafeUrlError,
  WEBHOOK_MAX_RESPONSE_BYTES,
} = await import("./ssrf.server");

afterEach(() => lookup.mockReset());

describe("parseIPv4", () => {
  it.each(["1.2.3", "1.2.3.4.5", "256.0.0.1", "1.2.3.-1", "01234.0.0.1", "a.b.c.d", ""])(
    "rejects %s",
    (ip) => expect(parseIPv4(ip)).toBeNull(),
  );
  it("parses strict dotted quads", () => expect(parseIPv4("10.0.0.255")).toEqual([10, 0, 0, 255]));
});

describe("isBlockedIp: more ranges", () => {
  it.each([
    "192.0.0.8",
    "192.0.2.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "240.0.0.1",
    "fec0::1",
    "2001::1",
    "2001:0:4136:e378::1",
    "100::1",
    "::7f00:1",
    "::10.0.0.1",
    "64:ff9b::7f00:1",
    "2002:a00:1::",
    "2002:c0a8:101::1",
    "febf::1",
    "fc00::",
    "::ffff:192.168.0.1",
    "[fe80::1%25eth0]",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each([
    "192.0.1.1",
    "198.20.0.1",
    "172.15.255.255",
    "169.253.0.1",
    "223.255.255.255",
    "64:ff9b::808:808",
    "2002:808:808::1",
    "2001:4860:4860::8888",
    "2a00:1450::1",
    "[2606:4700::1111]",
  ])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("assertSafeUrlShape: more inputs", () => {
  it("accepts explicit :443 and a trailing-dot public host", () => {
    expect(assertSafeUrlShape("https://example.com:443/").port).toBe("");
    expect(assertSafeUrlShape("https://example.com./x").hostname).toBe("example.com.");
  });
  it.each([
    "https://localhost./",
    "https://LOCALHOST/",
    "https://router.lan/",
    "https://nas.home.arpa/",
    "https://instance-data.ec2.internal/",
    "https://metadata.goog/",
    "https://0.0.0.0/",
    "https://[::]/",
    "https://[::ffff:a9fe:a9fe]/",
    "https://[64:ff9b::a9fe:a9fe]/",
    "https://017700000001/",
    "javascript:alert(1)",
    "data:text/plain,hi",
    "file:///etc/passwd",
  ])("rejects %s", (url) => expect(() => assertSafeUrlShape(url)).toThrow(UnsafeUrlError));
});

describe("assertSafeUrl: resolver handling", () => {
  it("does not resolve IP literals", async () => {
    const resolve = vi.fn();
    await assertSafeUrl("https://8.8.8.8/", resolve);
    await assertSafeUrl("https://[2606:4700::1111]/", resolve);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("strips the trailing dot before resolving", async () => {
    const resolve = vi.fn(async () => ["93.184.216.34"]);
    await assertSafeUrl("https://Example.com./", resolve);
    expect(resolve).toHaveBeenCalledWith("example.com");
  });

  it("blocks any AAAA record that is private even when A records are public", async () => {
    await expect(
      assertSafeUrl("https://dual.example.com/", async () => ["93.184.216.34", "fd00::1"]),
    ).rejects.toThrow("internal");
  });

  it("re-checks on every call (rebinding between two webhook runs is caught)", async () => {
    const answers = [["93.184.216.34"], ["127.0.0.1"]];
    const resolve = vi.fn(async () => answers.shift()!);
    await expect(assertSafeUrl("https://rebind.example.com/", resolve)).resolves.toBeInstanceOf(
      URL,
    );
    await expect(assertSafeUrl("https://rebind.example.com/", resolve)).rejects.toThrow("internal");
  });

  it("propagates resolver errors", async () => {
    await expect(
      assertSafeUrl("https://x.example.com/", async () => {
        throw new UnsafeUrlError("Host webhook tidak dapat di-resolve");
      }),
    ).rejects.toThrow("resolve");
  });
});

describe("nodeResolver", () => {
  it("returns every address from lookup({ all: true })", async () => {
    lookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800::1", family: 6 },
    ]);
    await expect(nodeResolver("example.com")).resolves.toEqual(["93.184.216.34", "2606:2800::1"]);
    expect(lookup).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
  });

  it.each(["ENOTIMP", "ENOSYS", "ERR_METHOD_NOT_IMPLEMENTED"])(
    "returns null when DNS is unavailable (%s)",
    async (code) => {
      lookup.mockRejectedValueOnce(Object.assign(new Error("nope"), { code }));
      await expect(nodeResolver("example.com")).resolves.toBeNull();
    },
  );

  it("throws UnsafeUrlError for NXDOMAIN and other lookup failures", async () => {
    lookup.mockRejectedValueOnce(Object.assign(new Error("nx"), { code: "ENOTFOUND" }));
    await expect(nodeResolver("nx.example.com")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("is the default resolver of assertSafeUrl (DNS rebinding to a private address)", async () => {
    lookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(assertSafeUrl("https://evil.example.com/")).rejects.toThrow("internal");
  });
});

describe("safeWebhookPost: response handling", () => {
  const resolve = async () => ["93.184.216.34"];

  it("treats an opaque redirect (browser fetch) as a redirect", async () => {
    const fetchImpl = vi.fn(async () => {
      const res = new Response(null, { status: 200 });
      Object.defineProperty(res, "type", { value: "opaqueredirect" });
      return res;
    });
    await expect(
      safeWebhookPost("https://ok.example.com/", {}, { resolve, fetchImpl }),
    ).rejects.toThrow("redirect");
  });

  it.each([301, 307, 308])("rejects a %i redirect without following it", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }));
    await expect(
      safeWebhookPost("https://ok.example.com/", {}, { resolve, fetchImpl }),
    ).rejects.toThrow("redirect");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps AbortError and network errors to friendly messages", async () => {
    const abort = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      safeWebhookPost("https://ok.example.com/", {}, { resolve, fetchImpl: abort }),
    ).rejects.toThrow("timeout");
    const net = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      safeWebhookPost("https://ok.example.com/", {}, { resolve, fetchImpl: net }),
    ).rejects.toThrow("tidak dapat dihubungi");
  });

  it("stops reading a huge response body after the cap and cancels the stream", async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const chunk = new Uint8Array(16 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
      cancel,
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    await expect(
      safeWebhookPost("https://ok.example.com/", {}, { resolve, fetchImpl }),
    ).resolves.toEqual({ status: 200 });
    expect(pulls).toBeLessThanOrEqual(WEBHOOK_MAX_RESPONSE_BYTES / chunk.byteLength + 3);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it("ignores body read errors", async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new Error("boom"));
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 202 }));
    await expect(
      safeWebhookPost("https://ok.example.com/", {}, { resolve, fetchImpl }),
    ).resolves.toEqual({ status: 202 });
  });

  it("sends JSON with the webhook user agent", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await safeWebhookPost("https://ok.example.com/", { x: 1 }, { resolve, fetchImpl });
    const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "User-Agent": "SecondBrain-Webhook/1",
    });
  });
});

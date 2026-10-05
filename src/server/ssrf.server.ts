// SSRF guard for outbound requests to user-supplied URLs (automation webhooks).
//
// Layers:
//   1. Static URL checks: https only, no credentials, default port (443 / 8443), no internal
//      hostnames (localhost, *.local, *.internal, metadata hosts) and no literal private IPs.
//   2. DNS check: every address the hostname resolves to (A + AAAA via `lookup({ all: true })`)
//      must be public. If `node:dns` is unavailable (e.g. some Cloudflare Workers builds) the
//      DNS step is skipped and we rely on layer 1 — Workers cannot reach private networks or
//      cloud metadata endpoints anyway, so the remaining risk is limited to Node hosts.
//   3. Request hardening: `redirect: "manual"` (any 3xx is a failure, so a public host cannot
//      bounce us to an internal one), a 5 s timeout and the response body is never read beyond
//      a small cap.
//
// Residual risk: DNS rebinding between our lookup and fetch's own lookup (TOCTOU). Pinning the
// resolved IP is not possible with the platform `fetch` without breaking TLS SNI, so we accept
// this and keep the timeout/redirect/body limits as defence in depth.

export const WEBHOOK_TIMEOUT_MS = 5000;
export const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;
const ALLOWED_PORTS = new Set(["", "443", "8443"]);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Parses a dotted-quad IPv4 address into 4 octets, or null. Only strict decimal form. */
export function parseIPv4(input: string): number[] | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Parses an IPv6 address (incl. `::` compression and embedded IPv4) into 8 hextets, or null. */
export function parseIPv6(input: string): number[] | null {
  let s = input.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(":")) return null;

  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1) → rewrite as two hex groups.
  const lastColon = s.lastIndexOf(":");
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = parseIPv4(maybeV4);
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parseGroup = (g: string) =>
    g === "" ? [] : g.split(":").map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : NaN));
  const head = parseGroup(halves[0]!);
  const rest = halves.length === 2 ? parseGroup(halves[1]!) : [];
  if ([...head, ...rest].some((n) => Number.isNaN(n))) return null;
  const total = head.length + rest.length;
  if (halves.length === 1) return total === 8 ? head : null;
  if (total > 7) return null;
  return [...head, ...new Array<number>(8 - total).fill(0), ...rest];
}

function isBlockedIPv4(o: number[]): boolean {
  const [a, b, c] = o as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network" / unspecified
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast 224/4, reserved 240/4, broadcast
  return false;
}

function isBlockedIPv6(h: number[]): boolean {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const v4 = [h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff];
  const firstFiveZero = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
  if (firstFiveZero && h5 === 0 && h6 === 0 && (h7 === 0 || h7 === 1)) return true; // :: and ::1
  if (firstFiveZero && h5 === 0xffff) return isBlockedIPv4(v4); // IPv4-mapped ::ffff:a.b.c.d
  if (firstFiveZero && h5 === 0) return true; // deprecated IPv4-compatible ::a.b.c.d
  if (h0 === 0x64 && h1 === 0xff9b) return isBlockedIPv4(v4); // NAT64 64:ff9b::/96
  if (h0 === 0x2002) return isBlockedIPv4([h1 >> 8, h1 & 0xff, h2 >> 8, h2 & 0xff]); // 6to4
  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((h0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h0 === 0x2001 && h1 === 0x0db8) return true; // documentation
  if (h0 === 0x2001 && h1 === 0) return true; // Teredo 2001::/32 (tunnels to arbitrary IPv4)
  if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) return true; // discard-only 100::/64
  return false;
}

/** True when the address is not a publicly routable unicast address. Unparseable → blocked. */
export function isBlockedIp(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(address);
  if (v6) return isBlockedIPv6(v6);
  return true;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".localdomain",
];

function isIpLiteral(hostname: string) {
  return hostname.startsWith("[") || /^[\d.]+$/.test(hostname) || /^0x/i.test(hostname);
}

/**
 * Synchronous checks that need no network: scheme, credentials, port and hostname. Throws
 * `UnsafeUrlError` with an Indonesian message (shown in automation run logs).
 */
export function assertSafeUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Alamat webhook tidak valid");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Webhook harus https");
  if (url.username || url.password)
    throw new UnsafeUrlError("Webhook tidak boleh berisi kredensial");
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError("Port webhook tidak diizinkan");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("Alamat webhook tidak valid");
  if (isIpLiteral(host)) {
    // WHATWG URL already normalizes decimal/hex/octal IPv4 forms to dotted quads.
    if (isBlockedIp(host)) throw new UnsafeUrlError("Alamat webhook mengarah ke jaringan internal");
    return url;
  }
  if (!host.includes(".")) throw new UnsafeUrlError("Alamat webhook mengarah ke jaringan internal");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)))
    throw new UnsafeUrlError("Alamat webhook mengarah ke jaringan internal");
  return url;
}

export type Resolver = (hostname: string) => Promise<string[] | null>;

/** Resolves all A/AAAA records via node:dns. Returns null when DNS is unavailable at runtime. */
export const nodeResolver: Resolver = async (hostname) => {
  let lookup: typeof import("node:dns/promises").lookup;
  try {
    ({ lookup } = await import("node:dns/promises"));
    if (typeof lookup !== "function") return null;
  } catch {
    return null;
  }
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((r) => r.address);
  } catch (error) {
    const code = (error as { code?: string }).code;
    // ENOTIMP / ENOSYS: runtime stub without a resolver → fall back to static checks.
    if (code === "ENOTIMP" || code === "ENOSYS" || code === "ERR_METHOD_NOT_IMPLEMENTED")
      return null;
    throw new UnsafeUrlError("Host webhook tidak dapat di-resolve");
  }
};

/** Full check: URL shape plus DNS resolution (every resolved address must be public). */
export async function assertSafeUrl(raw: string, resolve: Resolver = nodeResolver): Promise<URL> {
  const url = assertSafeUrlShape(raw);
  const host = url.hostname.replace(/\.$/, "");
  if (isIpLiteral(host)) return url;
  const addresses = await resolve(host);
  if (addresses === null) return url; // DNS unavailable (Workers): static checks only
  if (!addresses.length) throw new UnsafeUrlError("Host webhook tidak dapat di-resolve");
  if (addresses.some(isBlockedIp))
    throw new UnsafeUrlError("Alamat webhook mengarah ke jaringan internal");
  return url;
}

/**
 * POSTs JSON to a user-supplied URL after `assertSafeUrl`. Never follows redirects, aborts
 * after 5 s and discards the response body (cancelled after at most 64 KB is buffered).
 */
export async function safeWebhookPost(
  raw: string,
  body: unknown,
  opts: { resolve?: Resolver; fetchImpl?: typeof fetch } = {},
): Promise<{ status: number }> {
  const url = await assertSafeUrl(raw, opts.resolve);
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "SecondBrain-Webhook/1" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "TimeoutError" || name === "AbortError")
      throw new Error("Webhook timeout (5 detik)");
    throw new Error("Webhook tidak dapat dihubungi");
  }
  await drain(res);
  // `redirect: "manual"` yields 3xx (Node) or an opaque-redirect with status 0 (browsers).
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400))
    throw new Error("Webhook redirect tidak diizinkan");
  if (!res.ok) throw new Error(`Webhook ${res.status}`);
  return { status: res.status };
}

async function drain(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return;
  let read = 0;
  try {
    while (read <= WEBHOOK_MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) return;
      read += value?.byteLength ?? 0;
    }
  } catch {
    // ignore body errors; status is what matters
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

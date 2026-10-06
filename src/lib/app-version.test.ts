import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compareVersions,
  fetchLatestRelease,
  getLatestRelease,
  readReleaseCache,
  releaseTagUrl,
  RELEASE_CACHE_KEY,
  RELEASE_CACHE_TTL_MS,
  writeReleaseCache,
} from "./app-version";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("compareVersions", () => {
  it("orders major, minor and patch numerically", () => {
    expect(compareVersions("0.3.1", "0.3.1")).toBe(0);
    expect(compareVersions("0.3.1", "0.3.2")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("ignores a leading v, build metadata and missing parts", () => {
    expect(compareVersions("v0.3.1", "0.3.1")).toBe(0);
    expect(compareVersions("0.3.1+abc", "0.3.1")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });

  it("sorts pre-releases before the release", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
    expect(compareVersions("1.0.0-rc", "1.0.0-rc.1")).toBe(-1);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
  });
});

describe("release links", () => {
  it("builds the release tag URL with a single v prefix", () => {
    expect(releaseTagUrl("0.3.1")).toBe(
      "https://github.com/ilramdhan/second-brain/releases/tag/v0.3.1",
    );
    expect(releaseTagUrl("v0.3.1")).toBe(
      "https://github.com/ilramdhan/second-brain/releases/tag/v0.3.1",
    );
  });
});

describe("release cache", () => {
  const release = { version: "0.4.0", url: releaseTagUrl("0.4.0") };
  const now = 1_700_000_000_000;

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("returns a fresh entry", () => {
    writeReleaseCache(release, now);
    expect(readReleaseCache(now + 1000)).toEqual(release);
  });

  it("expires after 6 hours", () => {
    writeReleaseCache(release, now);
    expect(readReleaseCache(now + RELEASE_CACHE_TTL_MS - 1)).toEqual(release);
    expect(readReleaseCache(now + RELEASE_CACHE_TTL_MS)).toBeNull();
  });

  it("ignores missing, malformed and future-dated entries", () => {
    expect(readReleaseCache(now)).toBeNull();
    localStorage.setItem(RELEASE_CACHE_KEY, "{not json");
    expect(readReleaseCache(now)).toBeNull();
    localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify({ fetchedAt: now, release: {} }));
    expect(readReleaseCache(now)).toBeNull();
    writeReleaseCache(release, now + 60_000);
    expect(readReleaseCache(now)).toBeNull();
  });

  it("survives a throwing localStorage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeReleaseCache(release, now)).not.toThrow();
    expect(readReleaseCache(now)).toBeNull();
  });

  it("uses the cache instead of fetching while it is fresh", async () => {
    writeReleaseCache(release, now);
    const fetcher = vi.fn<typeof fetch>();
    await expect(getLatestRelease(fetcher, now + 1000)).resolves.toEqual(release);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fetches and caches when the cache is stale", async () => {
    writeReleaseCache(release, now - RELEASE_CACHE_TTL_MS);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        tag_name: "v0.5.0",
        html_url: "https://github.com/ilramdhan/second-brain/releases/tag/v0.5.0",
      }),
    );
    const expected = {
      version: "0.5.0",
      url: "https://github.com/ilramdhan/second-brain/releases/tag/v0.5.0",
    };
    await expect(getLatestRelease(fetcher, now)).resolves.toEqual(expected);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(readReleaseCache(now + 1000)).toEqual(expected);
  });

  it("does not cache failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 403));
    await expect(getLatestRelease(fetcher, now)).resolves.toBeNull();
    expect(localStorage.getItem(RELEASE_CACHE_KEY)).toBeNull();
  });
});

describe("fetchLatestRelease", () => {
  it("returns null on network errors and bad payloads", async () => {
    await expect(
      fetchLatestRelease(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"))),
    ).resolves.toBeNull();
    await expect(
      fetchLatestRelease(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ name: "x" }))),
    ).resolves.toBeNull();
  });

  it("falls back to the tag URL for foreign html_url values", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ tag_name: "v1.0.0", html_url: "https://evil.example/" }));
    await expect(fetchLatestRelease(fetcher)).resolves.toEqual({
      version: "1.0.0",
      url: releaseTagUrl("1.0.0"),
    });
  });
});

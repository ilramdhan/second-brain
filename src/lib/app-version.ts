import { useEffect, useState } from "react";

/**
 * Build information and project links. The constants are injected at build time by `define`
 * in vite.config.ts; the `typeof` guards keep this module usable where they are not defined
 * (Vitest, tooling).
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
export const GIT_SHA: string = typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "dev";
export const BUILD_TIME: string = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "";

export const REPO_URL = "https://github.com/ilramdhan/second-brain";
export const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;
export const DOCS_URL = `${REPO_URL}#readme`;
export const BUG_REPORT_URL = `${REPO_URL}/issues/new/choose`;
export const LATEST_RELEASE_API =
  "https://api.github.com/repos/ilramdhan/second-brain/releases/latest";

/** GitHub release page for a version (`0.3.1` or `v0.3.1`). */
export function releaseTagUrl(version: string = APP_VERSION): string {
  return `${REPO_URL}/releases/tag/v${version.replace(/^v/i, "")}`;
}

/** GitHub commit page for a SHA. */
export function commitUrl(sha: string = GIT_SHA): string {
  return `${REPO_URL}/commit/${sha}`;
}

/** True when the SHA is a real commit hash (not the "dev" fallback). */
export function hasGitSha(sha: string = GIT_SHA): boolean {
  return /^[0-9a-f]{7,40}$/i.test(sha);
}

function parseVersion(version: string): { core: number[]; pre: string[] } {
  const clean = version.trim().replace(/^v/i, "").split("+")[0] ?? "";
  const dash = clean.indexOf("-");
  const coreText = dash === -1 ? clean : clean.slice(0, dash);
  const preText = dash === -1 ? "" : clean.slice(dash + 1);
  const core = coreText.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  while (core.length < 3) core.push(0);
  return { core, pre: preText ? preText.split(".") : [] };
}

/**
 * Compares two semantic versions (a leading "v" and build metadata are ignored).
 * Returns -1 when `a < b`, 1 when `a > b`, 0 when equal.
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const length = Math.max(va.core.length, vb.core.length);
  for (let i = 0; i < length; i++) {
    const diff = (va.core[i] ?? 0) - (vb.core[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  // A pre-release sorts before the release itself.
  if (va.pre.length === 0 || vb.pre.length === 0) {
    if (va.pre.length === vb.pre.length) return 0;
    return va.pre.length === 0 ? 1 : -1;
  }
  const preLength = Math.max(va.pre.length, vb.pre.length);
  for (let i = 0; i < preLength; i++) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return Math.sign(diff);
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export type LatestRelease = { version: string; url: string };

export const RELEASE_CACHE_KEY = "second-brain-latest-release";
export const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type CachedRelease = { fetchedAt: number; release: LatestRelease };

/** Reads the cached latest release; null when missing, malformed, expired or unavailable. */
export function readReleaseCache(now: number = Date.now()): LatestRelease | null {
  try {
    const raw = localStorage.getItem(RELEASE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedRelease> | null;
    const release = parsed?.release;
    if (
      typeof parsed?.fetchedAt !== "number" ||
      typeof release?.version !== "string" ||
      typeof release.url !== "string"
    ) {
      return null;
    }
    const age = now - parsed.fetchedAt;
    if (age < 0 || age >= RELEASE_CACHE_TTL_MS) return null;
    return { version: release.version, url: release.url };
  } catch {
    return null;
  }
}

export function writeReleaseCache(release: LatestRelease, now: number = Date.now()): void {
  try {
    const value: CachedRelease = { fetchedAt: now, release };
    localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the next visit simply fetches again.
  }
}

/** Fetches the latest GitHub release; null on any failure (offline, rate limit, CSP, ...). */
export async function fetchLatestRelease(
  fetcher: typeof fetch = fetch,
): Promise<LatestRelease | null> {
  try {
    const response = await fetcher(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown } | null;
    if (typeof body?.tag_name !== "string" || !body.tag_name) return null;
    const version = body.tag_name.replace(/^v/i, "");
    const url =
      typeof body.html_url === "string" && body.html_url.startsWith(`${REPO_URL}/`)
        ? body.html_url
        : releaseTagUrl(version);
    return { version, url };
  } catch {
    return null;
  }
}

/** Latest release from the 6-hour cache, else a fresh fetch (cached on success). */
export async function getLatestRelease(
  fetcher: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<LatestRelease | null> {
  const cached = readReleaseCache(now);
  if (cached) return cached;
  const release = await fetchLatestRelease(fetcher);
  if (release) writeReleaseCache(release, now);
  return release;
}

/**
 * Latest published GitHub release (client only, fails silently). `release` stays null while
 * loading or when the check failed; `checked` turns true once the check finished.
 * `updateAvailable` is true when the release is newer than APP_VERSION.
 */
export function useLatestRelease(): {
  release: LatestRelease | null;
  updateAvailable: boolean;
  checked: boolean;
} {
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getLatestRelease().then((result) => {
      if (cancelled) return;
      setRelease(result);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return {
    release,
    updateAvailable: release ? compareVersions(release.version, APP_VERSION) > 0 : false,
    checked,
  };
}

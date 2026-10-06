// Public read-only links (Phase 9.5, migration 0024). Client-safe: types of the sanitized
// payload the public page renders, the token format and the expiry options. The token is
// generated, hashed and resolved on the server (src/server/publicShare.server.ts).

export type ShareResourceType = "note" | "project";

/** Expiry choices in the share dialog. */
export const SHARE_EXPIRY_OPTIONS = ["never", "7d", "30d"] as const;
export type ShareExpiry = (typeof SHARE_EXPIRY_OPTIONS)[number];

const EXPIRY_DAYS: Record<ShareExpiry, number | null> = { never: null, "7d": 7, "30d": 30 };

/** `expires_at` for an expiry choice, counted from `now`. */
export function expiryToTimestamp(expiry: ShareExpiry, now: Date = new Date()): string | null {
  const days = EXPIRY_DAYS[expiry];
  return days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** Raw tokens are 32 random bytes in base64url (43 characters, no padding). */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && SHARE_TOKEN_RE.test(value);
}

/** Absolute URL of a public link. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/s/${token}`;
}

/** A share row as the owner sees it (never the token hash). */
export type ShareRow = {
  id: string;
  resource_type: string;
  resource_id: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  allow_indexing: boolean;
};

export function isShareActive(
  share: Pick<ShareRow, "revoked_at" | "expires_at">,
  now = Date.now(),
) {
  return !share.revoked_at && (!share.expires_at || Date.parse(share.expires_at) > now);
}

/* ---------- sanitized payload of the public page ---------- */

/**
 * Inline pieces of a public note block. Note links (`[[...]]`) and block refs (`((...))`) are
 * already resolved to plain text on the server: the page never receives note or block ids, and
 * never links into the owner's workspace.
 */
export type PublicInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "url"; text: string }
  | { kind: "wiki"; text: string }
  | { kind: "ref"; text: string | null };

export type PublicBlock = {
  type: "p" | "h1" | "h2" | "h3" | "todo" | "bullet" | "numbered" | "quote" | "code" | "divider";
  checked?: boolean;
  inline: PublicInline[];
};

export type PublicNote = {
  kind: "note";
  title: string;
  updatedAt: string;
  blocks: PublicBlock[];
};

export type PublicTask = {
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
};

export type PublicMilestone = { title: string; dueDate: string | null; done: boolean };

export type PublicProject = {
  kind: "project";
  title: string;
  description: string | null;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  updatedAt: string;
  tasks: PublicTask[];
  milestones: PublicMilestone[];
};

export type PublicShare = (PublicNote | PublicProject) & {
  allowIndexing: boolean;
  /** Plain-text summary for the meta description (at most 160 characters). */
  summary: string;
};

export type PublicShareResult =
  | { status: "ok"; share: PublicShare }
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfter: number };

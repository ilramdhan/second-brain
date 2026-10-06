// Public read-only links (Phase 9.5, migration 0024): token handling and the anonymous read path
// behind `/s/$token`.
//
// Threat model (see SECURITY.md → "Public links"): the token is the only credential, so
//   * it is 256 random bits, shown once, and only its SHA-256 is stored;
//   * every failure (malformed, unknown, revoked, expired, owner lost the right to share, item
//     trashed/archived) is the same `not_found`, so the page is no oracle;
//   * the read uses the service role but touches exactly one share row and the one resource it
//     names (plus, for block refs, other notes the same owner shared publicly), and returns a DTO
//     built field by field: no ids, user ids, emails, assignees, descriptions of tasks, tags,
//     properties or raw blocks;
//   * `[[links]]` become plain text and `((refs))`/embeds resolve to text only when the referenced
//     note is this note or another active public share of the same owner; queries are dropped;
//   * requests are rate limited per IP and views are counted at most once per visitor and window.
//
// Everything that talks to Supabase sits behind `PublicShareStore`, so the rules are unit tested
// without a database (publicShare.server.test.ts).

import { createIpRateLimiter } from "@/server/demo/ipRateLimit.server";
import { loadBlocks, REF_RE, type Block } from "@/lib/blocks";
import {
  isShareToken,
  type PublicBlock,
  type PublicInline,
  type PublicMilestone,
  type PublicShare,
  type PublicShareResult,
  type PublicTask,
} from "@/lib/share";
import type { Json } from "@/integrations/supabase/types";

/* ---------- tokens ---------- */

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url (43 characters). */
export function generateShareToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Lower-case hex SHA-256 of the token, the only form stored (`public_shares.token_hash`). */
export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- store ---------- */

export type StoredShare = {
  id: string;
  user_id: string;
  resource_type: string;
  resource_id: string;
  expires_at: string | null;
  revoked_at: string | null;
  allow_indexing: boolean;
};

export type StoredNote = {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  blocks: Json | null;
  content: string | null;
  updated_at: string;
  deleted_at: string | null;
  archived_at: string | null;
};

export type StoredProject = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  due_date: string | null;
  updated_at: string;
  deleted_at: string | null;
};

export type StoredTask = {
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  parent_id: string | null;
  deleted_at: string | null;
  archived_at: string | null;
};

export type StoredMilestone = { title: string; due_date: string | null; done: boolean };

/** Every query the public read needs, each scoped to exactly what it names. */
export type PublicShareStore = {
  shareByHash(hash: string): Promise<StoredShare | null>;
  note(id: string): Promise<StoredNote | null>;
  project(id: string): Promise<StoredProject | null>;
  projectTasks(projectId: string): Promise<StoredTask[]>;
  projectMilestones(projectId: string): Promise<StoredMilestone[]>;
  /** Notes of `userId` with an active public share, for resolving block refs. */
  sharedNotesOf(userId: string, now: Date): Promise<StoredNote[]>;
  recordView(shareId: string): Promise<void>;
};

/* ---------- limits ---------- */

/** Requests per minute per IP on the public page (`PUBLIC_SHARE_IP_RATE_LIMIT`). */
export const DEFAULT_PUBLIC_SHARE_IP_LIMIT = 60;
/** A visitor (IP) adds at most one view per share and window. */
export const VIEW_THROTTLE_MS = 30 * 60_000;
export const MAX_PUBLIC_TASKS = 500;
export const MAX_PUBLIC_MILESTONES = 100;
const MAX_TRACKED_VIEWS = 10_000;
const MAX_REF_DEPTH = 2;

export function publicShareIpLimit(env: Record<string, string | undefined> = process.env) {
  const value = Number(env["PUBLIC_SHARE_IP_RATE_LIMIT"]);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PUBLIC_SHARE_IP_LIMIT;
}

/** Remembers (share, visitor) pairs so reloads do not inflate `view_count`. Per instance. */
export function createViewThrottle(windowMs = VIEW_THROTTLE_MS, now: () => number = Date.now) {
  const seen = new Map<string, number>();
  return (shareId: string, visitor: string): boolean => {
    const at = now();
    const key = `${shareId}:${visitor}`;
    const last = seen.get(key);
    if (last !== undefined && at - last < windowMs) return false;
    seen.delete(key);
    if (seen.size >= MAX_TRACKED_VIEWS) {
      for (const [k, t] of seen) if (at - t >= windowMs) seen.delete(k);
      while (seen.size >= MAX_TRACKED_VIEWS) {
        const oldest = seen.keys().next().value;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
    }
    seen.set(key, at);
    return true;
  };
}

/* ---------- sanitizing ---------- */

const INLINE_SPLIT =
  /(\[\[[^\]\n]+?\]\]|\(\([a-z0-9]{6,10}\)\)|\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>"]+)/;

type RefResolver = (blockId: string) => Block | null;

/** Inline markup of one block, with links and refs resolved to text. */
export function toPublicInline(text: string, resolve: RefResolver, depth = 0): PublicInline[] {
  const out: PublicInline[] = [];
  for (const part of text.split(INLINE_SPLIT)) {
    if (!part) continue;
    if (part.startsWith("[[") && part.endsWith("]]")) {
      const [target, alias] = part.slice(2, -2).split("|");
      out.push({ kind: "wiki", text: (alias ?? target ?? "").trim() });
    } else if (part.startsWith("((") && part.endsWith("))")) {
      out.push({ kind: "ref", text: refText(part.slice(2, -2), resolve, depth) });
    } else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push({ kind: "strong", text: part.slice(2, -2) });
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push({ kind: "code", text: part.slice(1, -1) });
    } else if (/^https?:\/\//.test(part)) {
      out.push({ kind: "url", text: part });
    } else {
      out.push({ kind: "text", text: part });
    }
  }
  return out;
}

/** Plain text of a referenced block, or null when it is not public. Nested refs are flattened. */
function refText(blockId: string, resolve: RefResolver, depth: number): string | null {
  const block = resolve(blockId);
  if (!block || block.type === "query") return null;
  if (block.type === "embed")
    return depth >= MAX_REF_DEPTH ? null : refText(block.text, resolve, depth + 1);
  return block.text
    .replace(/\[\[([^\]\n]+?)\]\]/g, (_, inner: string) =>
      (inner.split("|")[1] ?? inner.split("|")[0] ?? "").trim(),
    )
    .replace(REF_RE, (_, id: string) =>
      depth >= MAX_REF_DEPTH ? "…" : (refText(id, resolve, depth + 1) ?? "…"),
    );
}

const PUBLIC_TYPES = new Set<PublicBlock["type"]>([
  "p",
  "h1",
  "h2",
  "h3",
  "todo",
  "bullet",
  "numbered",
  "quote",
  "code",
  "divider",
]);

/**
 * Blocks of a public note. Query blocks are dropped: they list the owner's private notes and
 * tasks. Embeds become a quote with the referenced text (or the "not shared" placeholder).
 */
export function toPublicBlocks(blocks: Block[], resolve: RefResolver): PublicBlock[] {
  return blocks.flatMap((block): PublicBlock[] => {
    if (block.type === "embed") {
      return [{ type: "quote", inline: [{ kind: "ref", text: refText(block.text, resolve, 0) }] }];
    }
    if (!PUBLIC_TYPES.has(block.type as PublicBlock["type"])) return [];
    const type = block.type as PublicBlock["type"];
    if (type === "divider") return [{ type, inline: [] }];
    if (type === "code") return [{ type, inline: [{ kind: "text", text: block.text }] }];
    return [
      {
        type,
        ...(type === "todo" ? { checked: Boolean(block.checked) } : {}),
        inline: toPublicInline(block.text, resolve),
      },
    ];
  });
}

/** Short description for meta tags: the first lines of plain text. */
export function plainDescription(blocks: PublicBlock[], max = 160): string {
  const text = blocks
    .filter((b) => b.type !== "code" && b.type !== "divider")
    .map((b) => b.inline.map((i) => i.text ?? "").join(""))
    .join(" ");
  return plainSummary(text, max);
}

function plainSummary(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const isLive = (row: { deleted_at: string | null; archived_at?: string | null }) =>
  !row.deleted_at && !row.archived_at;

/* ---------- read ---------- */

export type LoadPublicShareInput = {
  store: PublicShareStore;
  token: unknown;
  now?: Date;
  /** Visitor key for the view throttle (the client IP). */
  visitor?: string;
  /** Returns true when this visitor's view should be counted. */
  shouldCount?: (shareId: string, visitor: string) => boolean;
};

const NOT_FOUND = { status: "not_found" } as const;

/**
 * Resolves a token to the sanitized payload of its resource, or `not_found` for every kind of
 * failure. Does not rate limit (see `publicShareResponse`).
 */
export async function loadPublicShare({
  store,
  token,
  now = new Date(),
  visitor = "unknown",
  shouldCount = () => true,
}: LoadPublicShareInput): Promise<PublicShareResult> {
  if (!isShareToken(token)) return NOT_FOUND;
  const share = await store.shareByHash(await hashShareToken(token));
  if (!share || share.revoked_at) return NOT_FOUND;
  if (share.expires_at && Date.parse(share.expires_at) <= now.getTime()) return NOT_FOUND;

  let payload: PublicShare | null = null;
  if (share.resource_type === "note") payload = await publicNote(store, share, now);
  else if (share.resource_type === "project") payload = await publicProject(store, share);
  if (!payload) return NOT_FOUND;

  if (shouldCount(share.id, visitor)) {
    try {
      await store.recordView(share.id);
    } catch (error) {
      // A failed counter must never hide the page.
      console.warn(
        "public share view count failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { status: "ok", share: payload };
}

/** The creator may still publish the note: they wrote it, or they own its project. */
async function mayStillShareNote(store: PublicShareStore, share: StoredShare, note: StoredNote) {
  if (note.user_id === share.user_id) return true;
  if (!note.project_id) return false;
  const project = await store.project(note.project_id);
  return Boolean(project && !project.deleted_at && project.user_id === share.user_id);
}

async function publicNote(
  store: PublicShareStore,
  share: StoredShare,
  now: Date,
): Promise<PublicShare | null> {
  const note = await store.note(share.resource_id);
  if (!note || note.id !== share.resource_id || !isLive(note)) return null;
  if (!(await mayStillShareNote(store, share, note))) return null;

  const blocks = loadBlocks({ blocks: note.blocks, content: note.content ?? "" });
  const own = new Map(blocks.map((b) => [b.id, b]));
  let shared: Map<string, Block> | null = null;
  const needsOthers = blocks.some((b) =>
    b.type === "embed"
      ? !own.has(b.text)
      : [...b.text.matchAll(REF_RE)].some((m) => !own.has(m[1]!)),
  );
  if (needsOthers) {
    shared = new Map();
    for (const other of await store.sharedNotesOf(share.user_id, now)) {
      if (other.id === note.id || !isLive(other)) continue;
      for (const b of loadBlocks({ blocks: other.blocks, content: other.content ?? "" })) {
        if (!shared.has(b.id)) shared.set(b.id, b);
      }
    }
  }
  const resolve: RefResolver = (id) => own.get(id) ?? shared?.get(id) ?? null;
  const publicBlocks = toPublicBlocks(blocks, resolve);
  return {
    kind: "note",
    title: note.title.trim() || "Tanpa judul",
    updatedAt: note.updated_at,
    blocks: publicBlocks,
    allowIndexing: share.allow_indexing,
    summary: plainDescription(publicBlocks),
  };
}

async function publicProject(
  store: PublicShareStore,
  share: StoredShare,
): Promise<PublicShare | null> {
  const project = await store.project(share.resource_id);
  if (!project || project.id !== share.resource_id || project.deleted_at) return null;
  if (project.user_id !== share.user_id) return null;

  const [tasks, milestones] = await Promise.all([
    store.projectTasks(project.id),
    store.projectMilestones(project.id),
  ]);
  const publicTasks: PublicTask[] = tasks
    .filter((t) => isLive(t) && !t.parent_id)
    .slice(0, MAX_PUBLIC_TASKS)
    .map((t) => ({ title: t.title, status: t.status, priority: t.priority, dueDate: t.due_date }));
  const publicMilestones: PublicMilestone[] = milestones
    .slice(0, MAX_PUBLIC_MILESTONES)
    .map((m) => ({ title: m.title, dueDate: m.due_date, done: m.done }));
  const description = project.description?.trim() || null;
  return {
    kind: "project",
    title: project.name.trim() || "Tanpa nama",
    description,
    status: project.status,
    startDate: project.start_date,
    dueDate: project.due_date,
    updatedAt: project.updated_at,
    tasks: publicTasks,
    milestones: publicMilestones,
    allowIndexing: share.allow_indexing,
    summary: description ? plainSummary(description) : "",
  };
}

/* ---------- Supabase store (service role) ---------- */

type AdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

const NOTE_COLS = "id,user_id,project_id,title,blocks,content,updated_at,deleted_at,archived_at";

/**
 * Store over the service-role client. Each query names the one row (or the one project's rows)
 * it reads and selects only the columns the DTO needs; soft-deleted and archived rows are
 * filtered in SQL as well as in `loadPublicShare`.
 */
export function supabaseShareStore(db: AdminClient): PublicShareStore {
  return {
    async shareByHash(hash) {
      const { data, error } = await db
        .from("public_shares")
        .select("id,user_id,resource_type,resource_id,expires_at,revoked_at,allow_indexing")
        .eq("token_hash", hash)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw new Error(`public share lookup failed: ${error.message}`);
      return data;
    },
    async note(id) {
      const { data, error } = await db
        .from("notes")
        .select(NOTE_COLS)
        .eq("id", id)
        .is("deleted_at", null)
        .is("archived_at", null)
        .maybeSingle();
      if (error) throw new Error(`public note lookup failed: ${error.message}`);
      return data;
    },
    async project(id) {
      const { data, error } = await db
        .from("projects")
        .select("id,user_id,name,description,status,start_date,due_date,updated_at,deleted_at")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(`public project lookup failed: ${error.message}`);
      return data;
    },
    async projectTasks(projectId) {
      const { data, error } = await db
        .from("tasks")
        .select("title,status,priority,due_date,parent_id,deleted_at,archived_at")
        .eq("project_id", projectId)
        .is("parent_id", null)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("position")
        .limit(MAX_PUBLIC_TASKS);
      if (error) throw new Error(`public tasks lookup failed: ${error.message}`);
      return data ?? [];
    },
    async projectMilestones(projectId) {
      const { data, error } = await db
        .from("milestones")
        .select("title,due_date,done")
        .eq("project_id", projectId)
        .order("due_date", { nullsFirst: false })
        .limit(MAX_PUBLIC_MILESTONES);
      if (error) throw new Error(`public milestones lookup failed: ${error.message}`);
      return data ?? [];
    },
    async sharedNotesOf(userId, now) {
      const { data: shares, error } = await db
        .from("public_shares")
        .select("resource_id,expires_at")
        .eq("user_id", userId)
        .eq("resource_type", "note")
        .is("revoked_at", null)
        .limit(200);
      if (error) throw new Error(`public share refs lookup failed: ${error.message}`);
      const ids = (shares ?? [])
        .filter((s) => !s.expires_at || Date.parse(s.expires_at) > now.getTime())
        .map((s) => s.resource_id);
      if (!ids.length) return [];
      const { data, error: notesError } = await db
        .from("notes")
        .select(NOTE_COLS)
        .in("id", ids)
        .is("deleted_at", null)
        .is("archived_at", null);
      if (notesError) throw new Error(`public ref notes lookup failed: ${notesError.message}`);
      // Same rule as the page itself: the owner must still be allowed to publish each note.
      const projectIds = [...new Set((data ?? []).map((n) => n.project_id).filter(Boolean))];
      const owned = new Set<string>();
      if (projectIds.length) {
        const { data: projects } = await db
          .from("projects")
          .select("id")
          .in("id", projectIds as string[])
          .eq("user_id", userId)
          .is("deleted_at", null);
        for (const p of projects ?? []) owned.add(p.id);
      }
      return (data ?? []).filter(
        (n) => n.user_id === userId || (n.project_id !== null && owned.has(n.project_id)),
      );
    },
    async recordView(shareId) {
      const { error } = await db.rpc("record_public_share_view", { _share_id: shareId });
      if (error) throw new Error(error.message);
    },
  };
}

/* ---------- request entry point ---------- */

let ipLimiter: ReturnType<typeof createIpRateLimiter> | undefined;
let viewThrottle: ReturnType<typeof createViewThrottle> | undefined;

/**
 * Entry point of the `/s/$token` server function: per-IP limit, then `loadPublicShare` with the
 * service-role store and the per-instance view throttle. Lookup errors are logged and reported
 * as `not_found` (the page must not reveal whether a token exists).
 */
export async function readPublicShare(token: unknown, ip: string): Promise<PublicShareResult> {
  ipLimiter ??= createIpRateLimiter({ limit: publicShareIpLimit() });
  const limit = ipLimiter.consume(ip);
  if (!limit.allowed) return { status: "rate_limited", retryAfter: limit.retryAfter };
  if (!isShareToken(token)) return NOT_FOUND;
  viewThrottle ??= createViewThrottle();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    return await loadPublicShare({
      store: supabaseShareStore(supabaseAdmin),
      token,
      visitor: ip,
      shouldCount: viewThrottle,
    });
  } catch (error) {
    console.error("public share read failed:", error instanceof Error ? error.message : error);
    return NOT_FOUND;
  }
}

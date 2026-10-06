import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { shareHead } from "@/lib/share-head";
import { expiryToTimestamp, isShareActive, isShareToken, shareUrl } from "@/lib/share";
import {
  createViewThrottle,
  generateShareToken,
  hashShareToken,
  loadPublicShare,
  plainDescription,
  publicShareIpLimit,
  toPublicInline,
  type PublicShareStore,
  type StoredNote,
  type StoredProject,
  type StoredShare,
  type StoredTask,
} from "./publicShare.server";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-07T10:00:00Z");

function note(over: Partial<StoredNote> = {}): StoredNote {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    user_id: OWNER,
    project_id: null,
    title: "Rencana rilis",
    blocks: [
      { id: "blk00001", type: "h1", text: "Ringkasan" },
      { id: "blk00002", type: "p", text: "Lihat [[Catatan Rahasia]] dan **penting**" },
      { id: "blk00003", type: "todo", text: "Kirim email", checked: true },
      { id: "blk00004", type: "query", text: "LIST FROM #rahasia" },
      { id: "blk00005", type: "p", text: "Ref sendiri ((blk00001)) dan luar ((priv0001))" },
      { id: "blk00006", type: "embed", text: "pub00001" },
    ],
    content: "",
    updated_at: "2026-10-01T08:00:00Z",
    deleted_at: null,
    archived_at: null,
    ...over,
  };
}

function project(over: Partial<StoredProject> = {}): StoredProject {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    user_id: OWNER,
    name: "Peluncuran",
    description: "Proyek publik",
    status: "active",
    start_date: "2026-10-01",
    due_date: "2026-12-01",
    updated_at: "2026-10-02T08:00:00Z",
    deleted_at: null,
    ...over,
  };
}

const task = (over: Partial<StoredTask> = {}): StoredTask => ({
  title: "Tugas",
  status: "todo",
  priority: "medium",
  due_date: null,
  parent_id: null,
  deleted_at: null,
  archived_at: null,
  ...over,
});

type Setup = {
  share?: Partial<StoredShare>;
  notes?: StoredNote[];
  projects?: StoredProject[];
  tasks?: (StoredTask & { assignee_name?: string; description?: string; user_id?: string })[];
  sharedNotes?: StoredNote[];
};

async function setup(token: string, opts: Setup = {}) {
  const hash = await hashShareToken(token);
  const share: StoredShare = {
    id: "share-1",
    user_id: OWNER,
    resource_type: "note",
    resource_id: note().id,
    expires_at: null,
    revoked_at: null,
    allow_indexing: false,
    ...opts.share,
  };
  const recordView = vi.fn(async () => {});
  const shareByHash = vi.fn(async (h: string) => (h === hash ? share : null));
  const store: PublicShareStore = {
    shareByHash,
    note: async (id) => (opts.notes ?? [note()]).find((n) => n.id === id) ?? null,
    project: async (id) => (opts.projects ?? [project()]).find((p) => p.id === id) ?? null,
    projectTasks: async () => opts.tasks ?? [],
    projectMilestones: async () => [{ title: "Beta", due_date: "2026-11-01", done: false }],
    sharedNotesOf: async () => opts.sharedNotes ?? [],
    recordView,
  };
  return { store, recordView, shareByHash, share };
}

describe("share tokens", () => {
  it("generates 256-bit base64url tokens that pass the format check", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).not.toBe(b);
    expect(isShareToken(a)).toBe(true);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
  });

  it("stores the hex SHA-256 of the token", async () => {
    const token = generateShareToken();
    expect(await hashShareToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(await hashShareToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects malformed tokens", () => {
    for (const bad of ["", "abc", `${"a".repeat(42)}=`, `${"a".repeat(43)}/`, "a".repeat(44), 42])
      expect(isShareToken(bad)).toBe(false);
  });

  it("builds URLs and expiry timestamps", () => {
    expect(shareUrl("https://x.test/", "tok")).toBe("https://x.test/s/tok");
    expect(expiryToTimestamp("never", NOW)).toBeNull();
    expect(expiryToTimestamp("7d", NOW)).toBe("2026-10-14T10:00:00.000Z");
    expect(expiryToTimestamp("30d", NOW)).toBe("2026-11-06T10:00:00.000Z");
    expect(isShareActive({ revoked_at: null, expires_at: null })).toBe(true);
    expect(isShareActive({ revoked_at: null, expires_at: "2000-01-01T00:00:00Z" })).toBe(false);
    expect(isShareActive({ revoked_at: "2026-01-01T00:00:00Z", expires_at: null })).toBe(false);
  });
});

describe("loadPublicShare: not found for every failure (no oracle)", () => {
  const token = generateShareToken();

  it("malformed token: no lookup at all", async () => {
    const { store, shareByHash } = await setup(token);
    expect(await loadPublicShare({ store, token: "nope", now: NOW })).toEqual({
      status: "not_found",
    });
    expect(shareByHash).not.toHaveBeenCalled();
  });

  it("unknown token", async () => {
    const { store } = await setup(token);
    const res = await loadPublicShare({ store, token: generateShareToken(), now: NOW });
    expect(res).toEqual({ status: "not_found" });
  });

  it.each([
    ["revoked", { share: { revoked_at: "2026-10-05T00:00:00Z" } }],
    ["expired", { share: { expires_at: "2026-10-07T09:59:59Z" } }],
    ["trashed note", { notes: [note({ deleted_at: "2026-10-06T00:00:00Z" })] }],
    ["archived note", { notes: [note({ archived_at: "2026-10-06T00:00:00Z" })] }],
    ["note now owned by someone else", { notes: [note({ user_id: OTHER })] }],
    [
      "note in a project the sharer no longer owns",
      {
        notes: [note({ user_id: OTHER, project_id: project().id })],
        projects: [project({ user_id: OTHER })],
      },
    ],
    [
      "trashed project",
      {
        share: { resource_type: "project", resource_id: project().id },
        projects: [project({ deleted_at: "2026-10-06T00:00:00Z" })],
      },
    ],
    [
      "project of another owner",
      {
        share: { resource_type: "project", resource_id: project().id },
        projects: [project({ user_id: OTHER })],
      },
    ],
    ["unknown resource type", { share: { resource_type: "task" } }],
  ] as [string, Setup][])("%s", async (_label, opts) => {
    const { store, recordView } = await setup(token, opts);
    expect(await loadPublicShare({ store, token, now: NOW })).toEqual({ status: "not_found" });
    expect(recordView).not.toHaveBeenCalled();
  });

  it("an expiry in the future still works", async () => {
    const { store } = await setup(token, { share: { expires_at: "2026-10-07T10:00:01Z" } });
    expect((await loadPublicShare({ store, token, now: NOW })).status).toBe("ok");
  });

  it("the project owner may publish a member's note in their project", async () => {
    const { store } = await setup(token, {
      notes: [note({ user_id: OTHER, project_id: project().id })],
    });
    expect((await loadPublicShare({ store, token, now: NOW })).status).toBe("ok");
  });
});

describe("loadPublicShare: sanitized note", () => {
  const token = generateShareToken();

  it("returns only title, blocks, update time and indexing flag", async () => {
    const { store } = await setup(token, {
      sharedNotes: [
        note({
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          blocks: [{ id: "pub00001", type: "p", text: "Teks publik [[X|alias]]" }],
        }),
      ],
    });
    const res = await loadPublicShare({ store, token, now: NOW });
    if (res.status !== "ok" || res.share.kind !== "note") throw new Error("expected a note");
    const json = JSON.stringify(res);
    // No ids of any kind, no user id, no raw block ids, no private query.
    expect(json).not.toContain(OWNER);
    expect(json).not.toContain(note().id);
    expect(json).not.toMatch(/blk0000|priv0001|pub00001/);
    expect(json).not.toContain("#rahasia");
    expect(Object.keys(res.share).sort()).toEqual(
      ["allowIndexing", "blocks", "kind", "summary", "title", "updatedAt"].sort(),
    );
    expect(res.share.blocks.map((b) => b.type)).toEqual(["h1", "p", "todo", "p", "quote"]);
    // [[link]] -> plain text; own ref -> its text; private ref -> null; shared embed -> text.
    expect(res.share.blocks[1]!.inline).toEqual([
      { kind: "text", text: "Lihat " },
      { kind: "wiki", text: "Catatan Rahasia" },
      { kind: "text", text: " dan " },
      { kind: "strong", text: "penting" },
    ]);
    expect(res.share.blocks[3]!.inline).toEqual([
      { kind: "text", text: "Ref sendiri " },
      { kind: "ref", text: "Ringkasan" },
      { kind: "text", text: " dan luar " },
      { kind: "ref", text: null },
    ]);
    expect(res.share.blocks[4]!.inline).toEqual([{ kind: "ref", text: "Teks publik alias" }]);
    expect(res.share.blocks[2]).toMatchObject({ checked: true });
    expect(res.share.summary).toBe(
      "Ringkasan Lihat Catatan Rahasia dan penting Kirim email Ref sendiri Ringkasan dan luar Teks publik alias",
    );
  });

  it("refs into other notes are not resolved without an active share of them", async () => {
    const { store } = await setup(token, { sharedNotes: [] });
    const res = await loadPublicShare({ store, token, now: NOW });
    if (res.status !== "ok" || res.share.kind !== "note") throw new Error("expected a note");
    expect(res.share.blocks[4]!.inline).toEqual([{ kind: "ref", text: null }]);
  });

  it("legacy markdown notes (no blocks) render too", async () => {
    const { store } = await setup(token, {
      notes: [note({ blocks: null, content: "# Judul\n- satu\n- dua" })],
    });
    const res = await loadPublicShare({ store, token, now: NOW });
    if (res.status !== "ok" || res.share.kind !== "note") throw new Error("expected a note");
    expect(res.share.blocks.map((b) => b.type)).toEqual(["h1", "bullet", "bullet"]);
  });
});

describe("loadPublicShare: sanitized project", () => {
  const token = generateShareToken();

  it("returns tasks and milestones without private fields or deleted rows", async () => {
    const { store } = await setup(token, {
      share: { resource_type: "project", resource_id: project().id, allow_indexing: true },
      tasks: [
        {
          ...task({ title: "Desain", status: "done", due_date: "2026-10-10" }),
          assignee_name: "Rina",
          description: "rahasia",
          user_id: OTHER,
        },
        task({ title: "Dihapus", deleted_at: "2026-10-06T00:00:00Z" }),
        task({ title: "Diarsip", archived_at: "2026-10-06T00:00:00Z" }),
        task({ title: "Subtugas", parent_id: "x" }),
      ],
    });
    const res = await loadPublicShare({ store, token, now: NOW });
    if (res.status !== "ok" || res.share.kind !== "project") throw new Error("expected a project");
    expect(res.share.tasks).toEqual([
      { title: "Desain", status: "done", priority: "medium", dueDate: "2026-10-10" },
    ]);
    expect(res.share.milestones).toEqual([{ title: "Beta", dueDate: "2026-11-01", done: false }]);
    const json = JSON.stringify(res);
    for (const secret of ["Rina", "rahasia", OTHER, OWNER, project().id])
      expect(json).not.toContain(secret);
    expect(res.share).toMatchObject({
      title: "Peluncuran",
      description: "Proyek publik",
      allowIndexing: true,
      summary: "Proyek publik",
    });
  });
});

describe("view counting", () => {
  it("counts a view through the store, throttled per visitor", async () => {
    const token = generateShareToken();
    const { store, recordView } = await setup(token);
    let t = 0;
    const throttle = createViewThrottle(60_000, () => t);
    const load = (visitor: string) =>
      loadPublicShare({ store, token, now: NOW, visitor, shouldCount: throttle });
    await load("1.1.1.1");
    await load("1.1.1.1");
    await load("2.2.2.2");
    expect(recordView).toHaveBeenCalledTimes(2);
    t += 60_000;
    await load("1.1.1.1");
    expect(recordView).toHaveBeenCalledTimes(3);
  });

  it("a failing counter never hides the page", async () => {
    const token = generateShareToken();
    const { store } = await setup(token);
    store.recordView = async () => {
      throw new Error("db down");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await loadPublicShare({ store, token, now: NOW })).status).toBe("ok");
    warn.mockRestore();
  });

  it("reads PUBLIC_SHARE_IP_RATE_LIMIT with a safe default", () => {
    expect(publicShareIpLimit({})).toBe(60);
    expect(publicShareIpLimit({ PUBLIC_SHARE_IP_RATE_LIMIT: "10" })).toBe(10);
    expect(publicShareIpLimit({ PUBLIC_SHARE_IP_RATE_LIMIT: "-1" })).toBe(60);
  });
});

describe("inline helpers", () => {
  it("keeps URLs and code, never emits markup", () => {
    expect(toPublicInline("a `x` https://e.test/p <b>", () => null)).toEqual([
      { kind: "text", text: "a " },
      { kind: "code", text: "x" },
      { kind: "text", text: " " },
      { kind: "url", text: "https://e.test/p" },
      { kind: "text", text: " <b>" },
    ]);
  });

  it("caps nested refs", () => {
    const blocks = {
      aaaaaa01: { id: "aaaaaa01", type: "p" as const, text: "A ((aaaaaa02))" },
      aaaaaa02: { id: "aaaaaa02", type: "p" as const, text: "B ((aaaaaa01))" },
    };
    const parts = toPublicInline("((aaaaaa01))", (id) => blocks[id as keyof typeof blocks] ?? null);
    expect(parts[0]).toEqual({ kind: "ref", text: "A B A …" });
  });

  it("summarises at 160 characters", () => {
    const text = plainDescription([
      { type: "p", inline: [{ kind: "text", text: "x ".repeat(200) }] },
    ]);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("share page head", () => {
  const base = {
    kind: "note" as const,
    title: "Judul",
    updatedAt: NOW.toISOString(),
    blocks: [],
    summary: "Ringkas",
  };
  const meta = (head: ReturnType<typeof shareHead>, key: string) =>
    head.meta.find(
      (m) => ("name" in m && m.name === key) || ("property" in m && m.property === key),
    );

  it("is noindex unless the owner allowed indexing", () => {
    expect(meta(shareHead({ ...base, allowIndexing: false }), "robots")).toMatchObject({
      content: "noindex, nofollow",
    });
    expect(meta(shareHead({ ...base, allowIndexing: true }), "robots")).toMatchObject({
      content: "index, follow",
    });
    expect(meta(shareHead(null), "robots")).toMatchObject({ content: "noindex, nofollow" });
  });

  it("carries the title in Open Graph and no-referrer", () => {
    const head = shareHead({ ...base, allowIndexing: false });
    expect(meta(head, "og:title")).toMatchObject({ content: "Judul" });
    expect(meta(head, "description")).toMatchObject({ content: "Ringkas" });
    expect(meta(head, "referrer")).toMatchObject({ content: "no-referrer" });
    expect(head.meta[0]).toEqual({ title: "Judul — Second Brain" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The provider must never be reached in demo mode: fail loudly if it is.
const embedMany = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  embedMany,
}));

import { aiConfigFromEnv, aiEmbed, embeddingModelId } from "@/lib/ai.server";
import { DEMO_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, hashEmbedding } from "@/lib/semantic";

import {
  DEMO_MIN_SIMILARITY,
  SEMANTIC_BATCH,
  SEMANTIC_MIN_SIMILARITY,
  semanticSearch,
  syncSemanticIndex,
  toHit,
  type PendingRow,
  type SemanticClient,
} from "./semantic.server";

const GEMINI = {
  AI_API_KEY: "gem",
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
};

function pending(n: number, offset = 0): PendingRow[] {
  return Array.from({ length: n }, (_, i) => ({
    entity_type: i % 2 ? "note" : "task",
    entity_id: `id-${offset + i}`,
    user_id: "u1",
    body: `text ${offset + i}`,
    content_hash: `h${offset + i}`,
  }));
}

/** Fake RLS client: serves `queue` pages to semantic_pending and records every call. */
function fakeClient(queue: PendingRow[][], matches: unknown[] = []) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === "semantic_pending")
        return Promise.resolve({ data: queue.shift() ?? [], error: null });
      if (fn === "semantic_upsert")
        return Promise.resolve({ data: (args["_docs"] as unknown[]).length, error: null });
      return Promise.resolve({ data: matches, error: null });
    },
  } as unknown as SemanticClient;
  return { client, calls };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  embedMany.mockReset();
});

describe("embedding model config", () => {
  it("defaults per provider and honours AI_EMBEDDING_MODEL", () => {
    expect(aiConfigFromEnv({ AI_API_KEY: "k" }).embeddingModel).toBe("text-embedding-3-small");
    expect(aiConfigFromEnv(GEMINI).embeddingModel).toBe("gemini-embedding-001");
    expect(
      aiConfigFromEnv({ ...GEMINI, AI_EMBEDDING_MODEL: "gemini-embedding-2" }).embeddingModel,
    ).toBe("gemini-embedding-2");
  });

  it("uses the hash model in the demo and throws without a key elsewhere", async () => {
    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("VITE_APP_MODE", "demo");
    expect(await embeddingModelId()).toBe(DEMO_EMBEDDING_MODEL);
    vi.stubEnv("APP_MODE", "");
    vi.stubEnv("VITE_APP_MODE", "");
    vi.stubEnv("AI_API_KEY", "");
    await expect(embeddingModelId()).rejects.toThrow(/AI belum dikonfigurasi/);
  });
});

describe("aiEmbed", () => {
  it("never calls the provider in the demo", async () => {
    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("VITE_APP_MODE", "demo");
    vi.stubEnv("AI_API_KEY", "");
    const [v] = await aiEmbed(["rapat klien"]);
    expect(v).toEqual(hashEmbedding("rapat klien"));
    expect(embedMany).not.toHaveBeenCalled();
  });

  it("requests 1536 dims from OpenAI and truncates Gemini's 3072", async () => {
    vi.stubEnv("APP_MODE", "");
    vi.stubEnv("VITE_APP_MODE", "");
    vi.stubEnv("AI_API_KEY", "k");
    embedMany.mockResolvedValue({ embeddings: [Array(EMBEDDING_DIMENSIONS).fill(1)] });
    await aiEmbed(["x"]);
    expect(embedMany.mock.calls[0]![0].providerOptions).toEqual({
      openai: { dimensions: EMBEDDING_DIMENSIONS },
    });

    for (const [k, v] of Object.entries(GEMINI)) vi.stubEnv(k, v);
    embedMany.mockResolvedValue({ embeddings: [Array(3072).fill(1)] });
    const [g] = await aiEmbed(["x"]);
    expect(embedMany.mock.calls[1]![0].providerOptions).toBeUndefined();
    expect(g).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("returns [] for no input without touching the config", async () => {
    vi.stubEnv("AI_API_KEY", "");
    expect(await aiEmbed([])).toEqual([]);
  });
});

describe("syncSemanticIndex", () => {
  const embed = async (texts: string[]) => texts.map(hashEmbedding);

  it("embeds pending batches until the queue is drained", async () => {
    const { client, calls } = fakeClient([pending(SEMANTIC_BATCH), pending(3, SEMANTIC_BATCH)]);
    const result = await syncSemanticIndex(client, { batches: 5, model: "m", embed });
    expect(result).toEqual({ embedded: SEMANTIC_BATCH + 3, remaining: 0, model: "m" });
    const upserts = calls.filter((c) => c.fn === "semantic_upsert");
    expect(upserts).toHaveLength(2);
    const doc = (upserts[0]!.args["_docs"] as Record<string, string>[])[0]!;
    expect(doc).toMatchObject({ entity_type: "task", entity_id: "id-0", content_hash: "h0" });
    expect(doc["embedding"]).toMatch(/^\[.*\]$/);
  });

  it("reports remaining work when the batch budget runs out", async () => {
    const { client } = fakeClient([pending(SEMANTIC_BATCH), pending(SEMANTIC_BATCH)]);
    const result = await syncSemanticIndex(client, { batches: 1, model: "m", embed });
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("scopes the queue to one user for the service role and skips empty queues", async () => {
    const { client, calls } = fakeClient([[]]);
    const result = await syncSemanticIndex(client, { userId: "u9", model: "m", embed });
    expect(result.embedded).toBe(0);
    expect(calls[0]!.args).toMatchObject({ _user_id: "u9", _model: "m" });
    expect(calls.some((c) => c.fn === "semantic_upsert")).toBe(false);
  });
});

describe("semanticSearch", () => {
  it("matches with the demo threshold and maps rows to hits", async () => {
    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("VITE_APP_MODE", "demo");
    const { client, calls } = fakeClient(
      [],
      [
        {
          entity_type: "note",
          entity_id: "n1",
          title: "Rapat",
          snippet: "isi",
          project_id: null,
          similarity: 1.2,
        },
      ],
    );
    const { hits, model } = await semanticSearch(client, "rapat", { demo: true, limit: 99 });
    expect(model).toBe(DEMO_EMBEDDING_MODEL);
    expect(hits).toEqual([
      { type: "note", id: "n1", title: "Rapat", snippet: "isi", projectId: null, similarity: 1 },
    ]);
    expect(calls[0]!.args).toMatchObject({ _min_similarity: DEMO_MIN_SIMILARITY, _limit: 30 });
    expect(embedMany).not.toHaveBeenCalled();
  });

  it("uses the stricter threshold outside the demo", async () => {
    vi.stubEnv("APP_MODE", "");
    vi.stubEnv("VITE_APP_MODE", "");
    vi.stubEnv("AI_API_KEY", "k");
    embedMany.mockResolvedValue({ embeddings: [Array(EMBEDDING_DIMENSIONS).fill(0.1)] });
    const { client, calls } = fakeClient([]);
    await semanticSearch(client, "x");
    expect(calls[0]!.args).toMatchObject({
      _min_similarity: SEMANTIC_MIN_SIMILARITY,
      _model: "text-embedding-3-small",
    });
  });

  it("toHit clamps similarity and defaults unknown types to task", () => {
    expect(
      toHit({
        entity_type: "x",
        entity_id: "a",
        title: "t",
        snippet: null as unknown as string,
        project_id: "p",
        similarity: -0.2,
      }),
    ).toEqual({ type: "task", id: "a", title: "t", snippet: "", projectId: "p", similarity: 0 });
  });
});

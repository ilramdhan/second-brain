// Semantic search over tasks and notes (plan item 9.1), on top of migration 0020.
//
// Indexing is an incremental queue, never part of a save: `semantic_pending` lists the rows the
// caller can see whose embedding is missing, from another model or outdated (md5 of the text
// built in SQL), `aiEmbed` embeds a batch in one provider call and `semantic_upsert` stores it,
// skipping rows edited in the meantime (they stay pending). Callers:
//   * the browser, debounced after task/note edits and before a semantic search
//     (`syncSemanticIndex`, RLS client, own + shared rows),
//   * Settings → "Indeks ulang" (same function, looped until nothing is pending),
//   * n8n maintenance `semantic_index` and the demo reset (service role, per user).
import { aiEmbed, embeddingModelId } from "@/lib/ai.server";
import { toVectorLiteral, type SemanticHit } from "@/lib/semantic";

export type { SemanticHit };

/** Rows embedded per provider call / semantic_upsert (the RPC accepts at most 100). */
export const SEMANTIC_BATCH = 50;
/** Largest number of results one search returns (match_semantic_documents caps at 50). */
export const SEMANTIC_MAX_RESULTS = 30;
/** Below this cosine similarity a hit is noise for real embedding models. */
export const SEMANTIC_MIN_SIMILARITY = 0.25;
/** The demo's bag-of-words vectors: any shared word or trigram is a (weak) match. */
export const DEMO_MIN_SIMILARITY = 0.05;

type RpcResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export type PendingRow = {
  entity_type: string;
  entity_id: string;
  user_id: string;
  body: string;
  content_hash: string;
};

export type MatchRow = {
  entity_type: string;
  entity_id: string;
  title: string;
  snippet: string;
  project_id: string | null;
  similarity: number;
};

/** The slice of a Supabase client this module uses (RLS client or supabaseAdmin). */
export type SemanticClient = {
  rpc(
    fn: "semantic_pending",
    args: { _model: string; _limit?: number; _user_id?: string },
  ): RpcResult<PendingRow[]>;
  rpc(fn: "semantic_upsert", args: { _model: string; _docs: unknown }): RpcResult<number>;
  rpc(
    fn: "match_semantic_documents",
    args: {
      _query_embedding: string;
      _model: string;
      _limit?: number;
      _min_similarity?: number;
    },
  ): RpcResult<MatchRow[]>;
};

export type SyncResult = { embedded: number; remaining: number; model: string };

/**
 * Embeds up to `batches` × {@link SEMANTIC_BATCH} pending rows. `remaining` is 0 when the last
 * batch was not full (the queue is drained), otherwise a lower bound (more may be pending).
 */
export async function syncSemanticIndex(
  client: SemanticClient,
  opts: {
    batches?: number;
    userId?: string;
    signal?: AbortSignal;
    /** Overrides the provider (the demo seed passes the deterministic hash embedding). */
    model?: string;
    embed?: (texts: string[]) => Promise<number[][]>;
  } = {},
): Promise<SyncResult> {
  const model = opts.model ?? (await embeddingModelId());
  const batches = Math.max(1, Math.min(opts.batches ?? 1, 20));
  let embedded = 0;
  for (let i = 0; i < batches; i++) {
    const { data, error } = await client.rpc("semantic_pending", {
      _model: model,
      _limit: SEMANTIC_BATCH,
      ...(opts.userId ? { _user_id: opts.userId } : {}),
    });
    if (error) throw new Error(`semantic_pending failed: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) return { embedded, remaining: 0, model };
    const texts = rows.map((r) => r.body);
    const vectors = opts.embed ? await opts.embed(texts) : await aiEmbed(texts, opts.signal);
    const docs = rows.map((r, j) => ({
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      content_hash: r.content_hash,
      embedding: toVectorLiteral(vectors[j] ?? []),
    }));
    const { data: stored, error: upsertError } = await client.rpc("semantic_upsert", {
      _model: model,
      _docs: docs,
    });
    if (upsertError) throw new Error(`semantic_upsert failed: ${upsertError.message}`);
    embedded += stored ?? 0;
    if (rows.length < SEMANTIC_BATCH) return { embedded, remaining: 0, model };
  }
  return { embedded, remaining: SEMANTIC_BATCH, model };
}

/** Embeds `query` and returns the nearest tasks/notes the client may read, best first. */
export async function semanticSearch(
  client: SemanticClient,
  query: string,
  opts: { limit?: number; signal?: AbortSignal; demo?: boolean } = {},
): Promise<{ hits: SemanticHit[]; model: string }> {
  const model = await embeddingModelId();
  const [vector] = await aiEmbed([query], opts.signal);
  const { data, error } = await client.rpc("match_semantic_documents", {
    _query_embedding: toVectorLiteral(vector ?? []),
    _model: model,
    _limit: Math.max(1, Math.min(opts.limit ?? 20, SEMANTIC_MAX_RESULTS)),
    _min_similarity: opts.demo ? DEMO_MIN_SIMILARITY : SEMANTIC_MIN_SIMILARITY,
  });
  if (error) throw new Error(`match_semantic_documents failed: ${error.message}`);
  return { hits: (data ?? []).map(toHit), model };
}

export function toHit(row: MatchRow): SemanticHit {
  return {
    type: row.entity_type === "note" ? "note" : "task",
    id: row.entity_id,
    title: row.title,
    snippet: row.snippet ?? "",
    projectId: row.project_id,
    similarity: Math.max(0, Math.min(1, Number(row.similarity) || 0)),
  };
}

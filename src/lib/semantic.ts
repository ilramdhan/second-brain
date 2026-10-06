// Embedding helpers shared by the semantic search server code (src/server/semantic.server.ts),
// the AI provider (src/lib/ai.server.ts) and the demo seed. Pure functions, no secrets.

/** Width of `semantic_documents.embedding` (migration 0004/0020). HNSW indexes at most 2000. */
export const EMBEDDING_DIMENSIONS = 1536;

/** One semantic search result (a task or a note the caller can read). */
export type SemanticHit = {
  type: "task" | "note";
  id: string;
  title: string;
  snippet: string;
  projectId: string | null;
  /** Cosine similarity, 0..1. */
  similarity: number;
};

/** Model id stored for the deterministic demo embedding (no provider call). */
export const DEMO_EMBEDDING_MODEL = "demo-hash-v1";

/**
 * Fits a provider embedding to {@link EMBEDDING_DIMENSIONS}: longer Matryoshka embeddings
 * (Gemini gemini-embedding-001 returns 3072 values) are truncated, shorter ones zero-padded, and
 * the result is L2-normalised (truncated MRL vectors are not unit length). Cosine similarity is
 * scale-invariant, but normalising keeps every stored vector comparable.
 */
export function fitEmbedding(values: readonly number[]): number[] {
  const out = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const n = Math.min(values.length, EMBEDDING_DIMENSIONS);
  for (let i = 0; i < n; i++) {
    const v = values[i] ?? 0;
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return normalize(out);
}

function normalize(values: number[]): number[] {
  let sum = 0;
  for (const v of values) sum += v * v;
  if (sum === 0) return values;
  const norm = Math.sqrt(sum);
  return values.map((v) => v / norm);
}

/** pgvector text literal ('[0.1,-0.2,...]'), rounded to keep RPC payloads small. */
export function toVectorLiteral(values: readonly number[]): string {
  return `[${values.map((v) => (v === 0 ? "0" : String(Number(v.toFixed(6))))).join(",")}]`;
}

/** Lowercase words without diacritics; drops one-letter tokens. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

/** 32-bit FNV-1a. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic "embedding" for the public demo (APP_MODE=demo) and tests: a hashed bag of
 * words plus character trigrams (so "rapat" also matches "rapatnya"), L2-normalised. No AI
 * call, no secret, the same text always gives the same vector, and texts that share no word or
 * trigram have similarity 0. Weights are non-negative, so similarity is in [0, 1].
 */
export function hashEmbedding(text: string): number[] {
  const out = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of tokenize(text)) {
    out[fnv1a(`w:${word}`) % EMBEDDING_DIMENSIONS]! += 1;
    const padded = `^${word}$`;
    for (let i = 0; i + 3 <= padded.length; i++) {
      out[fnv1a(`t:${padded.slice(i, i + 3)}`) % EMBEDDING_DIMENSIONS]! += 0.4;
    }
  }
  return normalize(out);
}

/** Cosine similarity of two equally long vectors (0 when either is all zeros). */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

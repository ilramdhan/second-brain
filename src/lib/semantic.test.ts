import { describe, expect, it } from "vitest";

import {
  cosineSimilarity,
  EMBEDDING_DIMENSIONS,
  fitEmbedding,
  hashEmbedding,
  tokenize,
  toVectorLiteral,
} from "./semantic";

const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe("fitEmbedding", () => {
  it("truncates 3072-d Matryoshka vectors and re-normalises", () => {
    const long = Array.from({ length: 3072 }, (_, i) => (i % 7) - 3);
    const fit = fitEmbedding(long);
    expect(fit).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(norm(fit)).toBeCloseTo(1, 6);
    // Direction of the first 1536 values is kept.
    expect(cosineSimilarity(fit, long.slice(0, EMBEDDING_DIMENSIONS))).toBeCloseTo(1, 6);
  });

  it("pads short vectors, drops non-finite values and keeps all-zero vectors", () => {
    const fit = fitEmbedding([3, 4, Number.NaN]);
    expect(fit).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(fit.slice(0, 3)).toEqual([0.6, 0.8, 0]);
    expect(fitEmbedding([]).every((x) => x === 0)).toBe(true);
  });
});

describe("toVectorLiteral", () => {
  it("formats a pgvector literal with bounded precision", () => {
    expect(toVectorLiteral([0, 0.1234567891, -1])).toBe("[0,0.123457,-1]");
  });
});

describe("hashEmbedding (demo)", () => {
  it("is deterministic, unit length and 1536-d", () => {
    const a = hashEmbedding("Persiapan rapat klien");
    expect(a).toEqual(hashEmbedding("Persiapan rapat klien"));
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(norm(a)).toBeCloseTo(1, 6);
  });

  it("ranks texts sharing words and word parts above unrelated ones", () => {
    const query = hashEmbedding("rapat klien");
    const related = hashEmbedding("Siapkan materi rapatnya dengan klien besok");
    const unrelated = hashEmbedding("Belanja sayur dan buah");
    expect(cosineSimilarity(query, related)).toBeGreaterThan(0.3);
    expect(cosineSimilarity(query, unrelated)).toBeLessThan(cosineSimilarity(query, related));
    expect(cosineSimilarity(query, unrelated)).toBeGreaterThanOrEqual(0);
  });

  it("ignores case and diacritics", () => {
    expect(tokenize("Café RÉSUMÉ a")).toEqual(["cafe", "resume"]);
    expect(hashEmbedding("Café")).toEqual(hashEmbedding("cafe"));
  });

  it("returns a zero vector for empty text", () => {
    expect(hashEmbedding("  ").every((x) => x === 0)).toBe(true);
    expect(cosineSimilarity(hashEmbedding(""), hashEmbedding("x y"))).toBe(0);
  });
});

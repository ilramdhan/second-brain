import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/semantic.functions", () => ({ syncSemanticIndexFn: vi.fn() }));

import { __resetSemanticSync, flushSemanticSync, scheduleSemanticSync } from "./semantic-sync";

type Sync = Parameters<typeof __resetSemanticSync>[0];

const ok = (remaining = 0) => Promise.resolve({ embedded: 1, remaining, model: "m" });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  __resetSemanticSync();
});

describe("semantic sync scheduler", () => {
  it("debounces edits into one call", async () => {
    const fn = vi.fn(() => ok());
    __resetSemanticSync(fn as unknown as Sync);
    scheduleSemanticSync();
    scheduleSemanticSync();
    vi.advanceTimersByTime(4_999);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ data: { batches: 1 } });
  });

  it("flush runs a pending sync immediately, then skips until something changes", async () => {
    const fn = vi.fn(() => ok());
    __resetSemanticSync(fn as unknown as Sync);
    scheduleSemanticSync();
    await flushSemanticSync();
    await flushSemanticSync();
    expect(fn).toHaveBeenCalledTimes(1);
    // Re-checks after a minute even without local edits (rows from n8n/other devices).
    vi.setSystemTime(Date.now() + 61_000);
    await flushSemanticSync();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops for the session when AI is not configured and never throws", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("AI belum dikonfigurasi. Admin…")));
    __resetSemanticSync(fn as unknown as Sync);
    await expect(flushSemanticSync()).resolves.toBeUndefined();
    scheduleSemanticSync();
    vi.setSystemTime(Date.now() + 120_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await flushSemanticSync();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps the queue dirty while more rows remain or after a transient error", async () => {
    const fn = vi
      .fn<() => Promise<{ embedded: number; remaining: number; model: string }>>()
      .mockImplementationOnce(() => ok(50))
      .mockImplementationOnce(() => Promise.reject(new Error("network")))
      .mockImplementation(() => ok());
    __resetSemanticSync(fn as unknown as Sync);
    await flushSemanticSync();
    await flushSemanticSync();
    await flushSemanticSync();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

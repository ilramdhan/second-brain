// Client-side trigger for the semantic search index (plan item 9.1). Saves never wait for an
// embedding: task/note writes call `scheduleSemanticSync()`, which runs one debounced
// `syncSemanticIndexFn` call a few seconds after the last edit. The server finds the stale rows
// itself (content hash), so the client never sends text or tracks ids. `flushSemanticSync()`
// runs a pending sync right away (before a semantic search) so fresh edits are findable.
import { syncSemanticIndexFn } from "@/lib/semantic.functions";

const DEBOUNCE_MS = 5_000;
/** A search re-checks the queue at most this often even without local edits (inbox, n8n...). */
const RECHECK_MS = 60_000;

type SyncFn = typeof syncSemanticIndexFn;

let timer: ReturnType<typeof setTimeout> | null = null;
// Starts dirty: rows written elsewhere (n8n, other devices) are picked up by the first search.
let dirty = true;
let disabled = false;
let inflight: Promise<void> | null = null;
let lastRun = 0;
let syncFn: SyncFn = syncSemanticIndexFn;

function run(now = Date.now()): Promise<void> {
  if (inflight) return inflight;
  if (disabled || (!dirty && now - lastRun < RECHECK_MS)) return Promise.resolve();
  dirty = false;
  lastRun = now;
  inflight = syncFn({ data: { batches: 1 } })
    .then((result) => {
      // More rows than one batch: keep going on the next trigger.
      if (result.remaining > 0) dirty = true;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      // No AI here: stop trying for this session (search falls back to keywords).
      if (/AI belum dikonfigurasi/i.test(message)) disabled = true;
      else dirty = true;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Marks the index stale and syncs after {@link DEBOUNCE_MS} without further edits. */
export function scheduleSemanticSync(): void {
  if (disabled || typeof window === "undefined") return;
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, DEBOUNCE_MS);
}

/** Runs a pending sync now (no-op when nothing changed recently); never throws. */
export function flushSemanticSync(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  return run();
}

/** Test hook: swaps the server function and resets the module state. */
export function __resetSemanticSync(fn: SyncFn = syncSemanticIndexFn): void {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty = true;
  disabled = false;
  inflight = null;
  lastRun = 0;
  syncFn = fn;
}

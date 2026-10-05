import { describe, expect, it } from "vitest";

import { createQueryClient, QUERY_STALE_TIME } from "@/router";

describe("createQueryClient", () => {
  it("keeps data fresh between navigations and does not refetch on focus", () => {
    const q = createQueryClient().getDefaultOptions().queries;
    expect(q?.staleTime).toBe(QUERY_STALE_TIME);
    expect(QUERY_STALE_TIME).toBeGreaterThanOrEqual(60_000);
    expect(q?.gcTime).toBe(30 * 60_000);
    expect(q?.refetchOnWindowFocus).toBe(false);
    expect(q?.retry).toBe(1);
  });
});

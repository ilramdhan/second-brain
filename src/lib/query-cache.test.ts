import { describe, expect, it } from "vitest";

import { ilikePattern } from "@/lib/query-cache";

describe("ilikePattern", () => {
  it("wraps the trimmed term in wildcards", () => {
    expect(ilikePattern("  rapat ")).toBe("%rapat%");
  });
  it("escapes LIKE wildcards and backslashes typed by the user", () => {
    expect(ilikePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});

// Regression: graph nodes rendered black because their class was derived at runtime
// (`dot.replace("bg-", "fill-")`), so Tailwind never saw `fill-tone-*` and generated no CSS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@tailwindcss/node";
import { describe, expect, it } from "vitest";

import { COLORS, color } from "./constants";

const root = join(__dirname, "..", "..");

describe("project tone classes", () => {
  it("every tone has a literal SVG fill class matching its dot", () => {
    for (const [key, c] of Object.entries(COLORS)) {
      expect(c.fill).toBe(`fill-tone-${key}`);
      expect(c.dot).toBe(`bg-tone-${key}`);
    }
    expect(color("nope").fill).toBe("fill-tone-teal");
  });

  it("the literal classes appear in source, so Tailwind's scanner generates them", () => {
    const src = readFileSync(join(root, "src/lib/constants.ts"), "utf8");
    for (const c of Object.values(COLORS)) expect(src).toContain(`"${c.fill}"`);
    const graph = readFileSync(join(root, "src/routes/_authenticated/graph.tsx"), "utf8");
    expect(graph).not.toMatch(/\.replace\(\s*["']bg-/);
  });

  it("Tailwind emits a fill rule for each tone, backed by light and dark variables", async () => {
    const css = readFileSync(join(root, "src/styles.css"), "utf8");
    const compiler = await compile(css, { base: join(root, "src"), onDependency: () => {} });
    const out = compiler.build(Object.values(COLORS).map((c) => c.fill));
    for (const key of Object.keys(COLORS)) {
      expect(out).toMatch(
        new RegExp(`\\.fill-tone-${key}\\s*{\\s*fill:\\s*var\\(--tone-${key}\\)`),
      );
      // Defined for both themes (:root and .dark).
      expect(css.match(new RegExp(`--tone-${key}:`, "g"))?.length).toBeGreaterThanOrEqual(2);
    }
  });
});

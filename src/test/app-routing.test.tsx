import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  const router = () => createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  it("serves the public landing page at / outside the auth guard", () => {
    const ids = router()
      .matchRoutes("/")
      .map((m) => m.routeId);

    expect(ids.at(-1)).toBe("/");
    expect(ids).not.toContain("/_authenticated");
  });

  it("serves the Today dashboard at /today inside the auth guard", () => {
    const ids = router()
      .matchRoutes("/today")
      .map((m) => m.routeId);

    expect(ids).toContain("/_authenticated");
    expect(ids.at(-1)).toBe("/_authenticated/today");
  });

  it("client-renders the authenticated subtree and guards it in beforeLoad", () => {
    const route = router().routesById["/_authenticated"];

    expect(route.options.ssr).toBe(false);
    expect(route.options.beforeLoad).toBeTypeOf("function");
  });

  it("server-renders the landing page", () => {
    expect(router().routesById["/"].options.ssr).not.toBe(false);
  });
});

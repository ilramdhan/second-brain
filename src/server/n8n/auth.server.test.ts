import { describe, expect, it } from "vitest";

import { authorizeN8nRequest, n8nKeysFromEnv } from "./auth.server";

const req = (key?: string) =>
  new Request("https://app.test/api/public/n8n/bot", {
    method: "POST",
    headers: key === undefined ? {} : { "x-api-key": key },
  });

describe("n8n auth", () => {
  it("fails closed without a configured key", () => {
    expect(authorizeN8nRequest(req("anything"), {})).toBe("not-configured");
    expect(authorizeN8nRequest(req(""), { N8N_API_KEY: "  " })).toBe("not-configured");
  });

  it("accepts the current and the previous key", () => {
    const env = { N8N_API_KEY: "current-key", N8N_API_KEY_PREVIOUS: "old-key" };
    expect(authorizeN8nRequest(req("current-key"), env)).toBe("ok");
    expect(authorizeN8nRequest(req("old-key"), env)).toBe("ok");
  });

  it("rejects missing, wrong or prefixed keys", () => {
    const env = { N8N_API_KEY: "current-key" };
    expect(authorizeN8nRequest(req(), env)).toBe("unauthorized");
    expect(authorizeN8nRequest(req("current-ke"), env)).toBe("unauthorized");
    expect(authorizeN8nRequest(req("current-key-x"), env)).toBe("unauthorized");
  });

  it("does not read the Authorization header", () => {
    const r = new Request("https://app.test", { headers: { authorization: "Bearer current-key" } });
    expect(authorizeN8nRequest(r, { N8N_API_KEY: "current-key" })).toBe("unauthorized");
  });

  it("lists non-empty keys only", () => {
    expect(n8nKeysFromEnv({ N8N_API_KEY: "a", N8N_API_KEY_PREVIOUS: "" })).toEqual(["a"]);
  });
});

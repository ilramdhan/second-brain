import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureServerError,
  isServerMonitoringEnabled,
  requestContext,
  resetServerMonitoringForTests,
} from "./sentry.server";

afterEach(() => {
  resetServerMonitoringForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("server monitoring", () => {
  it("is disabled and sends nothing without SENTRY_DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(isServerMonitoringEnabled()).toBe(false);
    await captureServerError(new Error("boom"), {
      source: "test",
      request: new Request("https://app.test/x", { method: "POST", body: "secret" }),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("request context has no body, headers or query", () => {
    const req = new Request("https://app.test/api/x?token=abc", {
      method: "POST",
      headers: { authorization: "Bearer t", "x-api-key": "k" },
      body: "secret",
    });
    expect(requestContext(req)).toEqual({ url: "https://app.test/api/x", method: "POST" });
  });

  it("sends a scrubbed envelope to the DSN ingest when enabled", async () => {
    vi.stubEnv("SENTRY_DSN", "https://publickey@o1.ingest.sentry.io/42");
    vi.stubEnv("SENTRY_ENVIRONMENT", "test");
    const calls: { url: string; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response("{}", { status: 200 });
    });

    await captureServerError(new Error("failed for jane@example.com"), {
      source: "n8n",
      userId: "user-1",
      request: new Request("https://app.test/api/public/n8n/capture?q=1", {
        method: "POST",
        headers: { "x-api-key": "secret-key" },
        body: '{"text":"my private note"}',
      }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("o1.ingest.sentry.io/api/42/envelope/");
    const body = calls[0]!.body;
    expect(body).toContain('"environment":"test"');
    expect(body).toContain('"source":"n8n"');
    expect(body).toContain('"id":"user-1"');
    expect(body).toContain("[email]");
    expect(body).not.toContain("jane@example.com");
    expect(body).not.toContain("secret-key");
    expect(body).not.toContain("my private note");
    expect(body).not.toContain("q=1");
  });
});

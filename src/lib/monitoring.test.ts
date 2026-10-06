import { afterEach, describe, expect, it, vi } from "vitest";

import { reportError, setErrorReporter } from "./error-reporting";
import {
  initMonitoring,
  pendingCountForTests,
  resetMonitoringForTests,
  setMonitoringUser,
} from "./monitoring";
import {
  maskEmails,
  parseSampleRate,
  readDsn,
  scrubBreadcrumb,
  scrubEvent,
  stripQuery,
} from "./monitoring-config";

afterEach(() => {
  resetMonitoringForTests();
  setErrorReporter(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("monitoring without a DSN", () => {
  it("is a no-op: no reporter, no network, nothing queued", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    vi.stubEnv("DEV", false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(initMonitoring()).toBe(false);
    setMonitoringUser("user-1");
    reportError(new Error("boom"));

    expect(pendingCountForTests()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats a blank DSN as disabled", () => {
    expect(readDsn("   ")).toBeUndefined();
    expect(readDsn(undefined)).toBeUndefined();
    expect(readDsn(" https://k@o1.ingest.sentry.io/1 ")).toBe("https://k@o1.ingest.sentry.io/1");
  });
});

describe("monitoring with a DSN", () => {
  it("queues errors reported before the SDK chunk loads", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    expect(initMonitoring()).toBe(true);
    reportError(new Error("early"), { boundary: "test" });
    expect(pendingCountForTests()).toBe(1);
  });
});

describe("parseSampleRate", () => {
  it("defaults to 0 and clamps to [0, 1]", () => {
    expect(parseSampleRate(undefined)).toBe(0);
    expect(parseSampleRate("")).toBe(0);
    expect(parseSampleRate("abc")).toBe(0);
    expect(parseSampleRate("0.2")).toBe(0.2);
    expect(parseSampleRate("5")).toBe(1);
    expect(parseSampleRate("-1")).toBe(0);
  });
});

describe("scrubbing", () => {
  it("keeps only url (no query) and method of the request", () => {
    const event = scrubEvent({
      request: {
        url: "https://app.test/notes/1?q=secret#x",
        method: "POST",
        data: '{"title":"diary"}',
        headers: { authorization: "Bearer abc", cookie: "sb=1" },
        cookies: { sb: "1" },
        query_string: "q=secret",
      },
    });
    expect(event.request).toEqual({ url: "https://app.test/notes/1", method: "POST" });
  });

  it("keeps the user id only and drops server_name", () => {
    const event = scrubEvent({
      user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4", username: "a" },
      server_name: "host-1",
    });
    expect(event.user).toEqual({ id: "u1" });
    expect(event).not.toHaveProperty("server_name");
    expect(scrubEvent({ user: { email: "a@b.co" } })).not.toHaveProperty("user");
  });

  it("redacts content-like keys and masks e-mails", () => {
    const event = scrubEvent({
      message: "failed for jane@example.com",
      exception: { values: [{ type: "Error", value: "user bob@example.org missing" }] },
      extra: { title: "My secret task", content: "note body", count: 3, nested: { blocks: [1] } },
      contexts: { report: { description: "x", routeId: "/notes/$id" } },
    });
    expect(event.message).toBe("failed for [email]");
    expect(event.exception.values[0]?.value).toBe("user [email] missing");
    expect(event.extra).toEqual({
      title: "[redacted]",
      content: "[redacted]",
      count: 3,
      nested: { blocks: "[redacted]" },
    });
    expect(event.contexts.report).toEqual({ description: "[redacted]", routeId: "/notes/$id" });
  });

  it("drops console/ui breadcrumbs and strips query strings and bodies", () => {
    expect(scrubBreadcrumb({ category: "console", message: "task: buy milk" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.click", message: "div > Buy milk" })).toBeNull();
    const crumb = scrubBreadcrumb({
      category: "fetch",
      data: {
        url: "https://x.supabase.co/rest/v1/tasks?title=ilike.*milk*",
        method: "GET",
        status_code: 200,
        request_body: "secret",
        response_body_size: 10,
      },
    });
    expect(crumb?.data).toEqual({
      url: "https://x.supabase.co/rest/v1/tasks",
      method: "GET",
      status_code: 200,
    });
    const nav = scrubBreadcrumb({ category: "navigation", data: { from: "/a?x=1", to: "/b#c" } });
    expect(nav?.data).toEqual({ from: "/a", to: "/b" });
  });

  it("helpers", () => {
    expect(stripQuery("/a?b=1")).toBe("/a");
    expect(stripQuery("/a")).toBe("/a");
    expect(maskEmails("no email here")).toBe("no email here");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDemoReset } from "./resetRoute.server";

const URL = "https://demo.test/api/public/n8n/demo/reset";
const CRON = "cron-secret-value";
const KEY = "n8n-key-value";

const request = (method: string, headers: Record<string, string> = {}) =>
  new Request(URL, { method, headers });

async function call(req: Request, reset = vi.fn(async () => ({ ok: true }))) {
  const res = await handleDemoReset(req, reset);
  return { status: res.status, body: await res.json(), reset };
}

describe("demo reset route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", CRON);
    vi.stubEnv("N8N_API_KEY", KEY);
    vi.stubEnv("SECOND_BRAIN_CRON_SECRET", "");
    vi.stubEnv("SECOND_BRAIN_CRON_SECRET_PREVIOUS", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const demo = () => {
    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("VITE_APP_MODE", "demo");
  };

  it("is a 404 outside demo mode, even with valid credentials", async () => {
    vi.stubEnv("APP_MODE", "");
    for (const req of [
      request("GET", { authorization: `Bearer ${CRON}` }),
      request("POST", { "x-api-key": KEY }),
    ]) {
      const res = await call(req);
      expect(res.status).toBe(404);
      expect(res.reset).not.toHaveBeenCalled();
    }
  });

  it("rejects a wrong bearer token, a wrong key and anonymous requests with 401", async () => {
    demo();
    for (const req of [
      request("GET", { authorization: "Bearer nope" }),
      request("POST", { authorization: "Bearer nope" }),
      request("POST", { "x-api-key": "nope" }),
      request("POST"),
      request("GET"),
      request("GET", { "x-api-key": KEY }),
    ]) {
      const res = await call(req);
      expect(res.status, `${req.method} ${[...req.headers.keys()].join()}`).toBe(401);
      expect(res.reset).not.toHaveBeenCalled();
    }
  });

  it("runs the reset for Vercel Cron (GET + Bearer CRON_SECRET) and POST + Bearer", async () => {
    demo();
    for (const method of ["GET", "POST"]) {
      const res = await call(request(method, { authorization: `Bearer ${CRON}` }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(res.reset).toHaveBeenCalledOnce();
    }
  });

  it("runs the reset for n8n (POST + x-api-key)", async () => {
    demo();
    const res = await call(request("POST", { "x-api-key": KEY }));
    expect(res.status).toBe(200);
    expect(res.reset).toHaveBeenCalledOnce();
  });

  it("hides reset errors behind a generic 500", async () => {
    demo();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(
      request("GET", { authorization: `Bearer ${CRON}` }),
      vi.fn(async () => {
        throw new Error("db password in message");
      }),
    );
    expect(res).toMatchObject({ status: 500, body: { error: "reset failed" } });
  });
});

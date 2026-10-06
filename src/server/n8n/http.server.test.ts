import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { handleN8n, N8nHttpError, readJson, readQuery, zodMessage } from "./http.server";
import { captureSchema, digestQuerySchema, maintenanceSchema } from "./schemas.server";

const KEY = "test-n8n-key";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://app.test/api/public/n8n/capture", {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json", ...headers },
    body,
  });

async function call(request: Request, handler: () => Promise<Response>) {
  const res = await handleN8n(request, handler);
  return { status: res.status, body: await res.json() };
}

describe("n8n error mapping (zod 4)", () => {
  beforeEach(() => vi.stubEnv("N8N_API_KEY", KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("maps a zod failure to 400 { error: 'path: message' }", async () => {
    const req = post(JSON.stringify({ chat_id: "abc", text: "x" }));
    const res = await call(req, async () => {
      await readJson(req, captureSchema);
      return new Response("unreachable");
    });
    expect(res).toEqual({ status: 400, body: { error: "chat_id: invalid chat_id" } });
  });

  it("keeps custom superRefine messages and paths", async () => {
    const req = post(JSON.stringify({ chat_id: 1 }));
    const res = await call(req, async () => {
      await readJson(req, captureSchema);
      return new Response("unreachable");
    });
    expect(res).toEqual({ status: 400, body: { error: "text: title or text required" } });
  });

  it("rejects non-uuid ids and invalid emails with a 400 string error", async () => {
    for (const body of [
      { kind: "morning", user_id: "nope" },
      { user_email: "not-an-email", text: "x" },
    ]) {
      const req = post(JSON.stringify(body));
      const res = await call(req, async () => {
        await readJson(req, "user_id" in body ? digestQuerySchema : captureSchema);
        return new Response("unreachable");
      });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body)).toEqual(["error"]);
      expect(res.body.error).toMatch(/^user_(id|email): /);
    }
  });

  it("accepts non-RFC (all-zero variant) ids used by fixtures", () => {
    expect(
      digestQuerySchema.parse({ kind: "morning", user_id: "00000000-0000-0000-0000-00000000e001" })
        .user_id,
    ).toBe("00000000-0000-0000-0000-00000000e001");
  });

  it("applies defaults on empty bodies and query strings", async () => {
    const req = post("");
    expect((await readJson(req, maintenanceSchema)).purge_after_days).toBe(30);
    const q = new Request("https://app.test/x?mark=false");
    expect(readQuery(q, z.object({ mark: z.string().default("true") })).mark).toBe("false");
  });

  it("maps invalid JSON, N8nHttpError and unexpected errors", async () => {
    const bad = post("{");
    expect(await call(bad, () => readJson(bad, captureSchema).then(() => new Response()))).toEqual({
      status: 400,
      body: { error: "invalid JSON body" },
    });
    expect(
      await call(post("{}"), async () => {
        throw new N8nHttpError(404, "not found");
      }),
    ).toEqual({ status: 404, body: { error: "not found" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await call(post("{}"), async () => {
        throw new Error("db password leaked");
      }),
    ).toEqual({ status: 500, body: { error: "internal error" } });
    spy.mockRestore();
  });

  it("returns 401 for a wrong key before running the handler", async () => {
    const handler = vi.fn(async () => new Response());
    expect(await call(post("{}", { "x-api-key": "wrong" }), handler)).toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("zodMessage formats root-level issues without a path", () => {
    const result = z.string().safeParse(1);
    expect(result.success).toBe(false);
    if (!result.success) expect(zodMessage(result.error)).not.toMatch(/^: /);
  });
});

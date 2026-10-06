import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_BRAIN_DUMP_EXAMPLES,
  DEMO_OCR_TEXT,
  DEMO_VOICE_TRANSCRIPT,
} from "@/lib/demo-examples";

// The provider must never be reached in the demo: fail loudly if it is.
const streamText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText,
}));
// Keep the real fixtures, without the 600–1200 ms "thinking" pause.
vi.mock("@/server/demo/ai-fixtures.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/demo/ai-fixtures.server")>();
  return { ...real, demoDelay: (signal?: AbortSignal) => real.demoDelay(signal, 0) };
});

import {
  AiNotConfiguredError,
  aiParseBrainDump,
  aiText,
  aiTranscribe,
  assertAiAvailable,
} from "./ai.server";

const request = () => new Request("https://app.test/_serverFn");
const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled in tests")));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("APP_MODE", "demo");
  vi.stubEnv("VITE_APP_MODE", "demo");
  vi.stubEnv("AI_API_KEY", "");
  vi.stubGlobal("fetch", fetchSpy);
  streamText.mockImplementation(() => {
    throw new Error("streamText must not run in the demo");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchSpy.mockClear();
  streamText.mockReset();
});

describe("ai.server in demo mode", () => {
  it("is available without AI_API_KEY (and not outside the demo)", async () => {
    await expect(assertAiAvailable()).resolves.toBeUndefined();
    vi.stubEnv("APP_MODE", "");
    vi.stubEnv("VITE_APP_MODE", "");
    await expect(assertAiAvailable()).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it("parses brain dumps from fixtures with the usual shape", async () => {
    const tasks = await aiParseBrainDump(request(), DEMO_BRAIN_DUMP_EXAMPLES[0]!.text, []);
    expect(tasks.length).toBeGreaterThan(2);
    expect(tasks[0]).toEqual({
      title: expect.any(String),
      description: expect.any(String),
      priority: "high",
      due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      tags: expect.any(Array),
      project: "Aplikasi Kasir",
      kind: "issue",
    });
  });

  it("answers text requests by kind", async () => {
    const meeting = await aiText(
      request(),
      "system",
      [{ role: "user", content: "Retro sprint 12, deploy lancar, QA telat, timebox meeting" }],
      "meeting",
    );
    expect(meeting).toMatch(/^## Ringkasan/);
    const ocr = await aiText(request(), "system", [
      {
        role: "user",
        content: [
          { type: "text", text: "Ekstrak teks" },
          { type: "image", image: "data:image/png;base64,AAAA" },
        ],
      },
    ]);
    expect(ocr).toBe(DEMO_OCR_TEXT);
    const summary = await aiText(request(), "system", [{ role: "user", content: "A. B." }]);
    expect(summary).toBe("- A.\n- B.");
  });

  it("transcribes without uploading the audio", async () => {
    const text = await aiTranscribe(new Blob([new Uint8Array(4)]), "audio/webm");
    expect(text).toBe(DEMO_VOICE_TRANSCRIPT);
  });

  it("never calls the provider or fetch", async () => {
    await aiParseBrainDump(request(), "beli susu besok", []);
    await aiText(request(), "s", [{ role: "user", content: "x" }], "paraphrase");
    await aiTranscribe(new Blob([]), "audio/webm");
    expect(streamText).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stops when the request is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new Request("https://app.test/_serverFn", { signal: controller.signal });
    await expect(aiParseBrainDump(aborted, "x", [])).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

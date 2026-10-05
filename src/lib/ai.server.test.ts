import { describe, expect, it } from "vitest";
import { AiNotConfiguredError, aiConfigFromEnv, hasImageContent } from "./ai.server";

describe("aiConfigFromEnv", () => {
  it("reports a clear error when AI_API_KEY is missing", () => {
    expect(() => aiConfigFromEnv({})).toThrow(AiNotConfiguredError);
    expect(() => aiConfigFromEnv({ AI_API_KEY: "  " })).toThrow(/AI belum dikonfigurasi/);
  });

  it("defaults to OpenAI with a cheap model", () => {
    expect(aiConfigFromEnv({ AI_API_KEY: "k" })).toEqual({
      provider: "openai",
      apiKey: "k",
      baseURL: undefined,
      model: "gpt-4o-mini",
      visionModel: "gpt-4o-mini",
      transcribeModel: "whisper-1",
    });
  });

  it("supports OpenAI-compatible hosts and requires their base URL", () => {
    expect(() => aiConfigFromEnv({ AI_API_KEY: "k", AI_PROVIDER: "openai-compatible" })).toThrow(
      /AI_BASE_URL/,
    );
    const cfg = aiConfigFromEnv({
      AI_API_KEY: "k",
      AI_PROVIDER: "OpenAI-Compatible",
      AI_BASE_URL: "https://openrouter.ai/api/v1/",
      AI_MODEL: "meta-llama/llama-3.3-70b-instruct:free",
      AI_VISION_MODEL: "google/gemini-2.0-flash-exp:free",
      AI_TRANSCRIBE_MODEL: "whisper-large-v3",
    });
    expect(cfg.provider).toBe("openai-compatible");
    expect(cfg.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(cfg.visionModel).toBe("google/gemini-2.0-flash-exp:free");
    expect(cfg.transcribeModel).toBe("whisper-large-v3");
  });

  it("rejects unknown providers", () => {
    expect(() => aiConfigFromEnv({ AI_API_KEY: "k", AI_PROVIDER: "acme" })).toThrow(
      /tidak dikenal/,
    );
  });
});

describe("hasImageContent", () => {
  it("detects image parts", () => {
    expect(hasImageContent([{ role: "user", content: "hi" }])).toBe(false);
    expect(
      hasImageContent([
        {
          role: "user",
          content: [
            { type: "text", text: "x" },
            { type: "image", image: "data:image/png;base64,AA==" },
          ],
        },
      ]),
    ).toBe(true);
  });
});

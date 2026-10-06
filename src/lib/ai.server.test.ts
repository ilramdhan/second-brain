import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiNotConfiguredError,
  TRANSCRIBE_PROMPT,
  aiConfigFromEnv,
  aiTranscribe,
  audioFormat,
  buildTranscribeRequest,
  hasImageContent,
} from "./ai.server";

const GEMINI = {
  AI_API_KEY: "gem",
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  AI_MODEL: "gemini-3.8-flash",
};

describe("transcription mode", () => {
  it("auto-selects chat for Gemini and uses AI_MODEL", () => {
    const cfg = aiConfigFromEnv(GEMINI);
    expect(cfg.transcribeMode).toBe("chat");
    expect(cfg.transcribeModel).toBe("gemini-3.8-flash");
    expect(cfg.transcribeBaseURL).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(cfg.transcribeApiKey).toBe("gem");
  });

  it("honours an explicit mode and rejects unknown ones", () => {
    expect(
      aiConfigFromEnv({ ...GEMINI, AI_TRANSCRIBE_MODE: "transcriptions" }).transcribeMode,
    ).toBe("transcriptions");
    expect(aiConfigFromEnv({ AI_API_KEY: "k", AI_TRANSCRIBE_MODE: "Chat" }).transcribeMode).toBe(
      "chat",
    );
    expect(() => aiConfigFromEnv({ AI_API_KEY: "k", AI_TRANSCRIBE_MODE: "x" })).toThrow(
      /AI_TRANSCRIBE_MODE/,
    );
  });

  it("can send voice to a separate host (Groq) while Gemini handles text", () => {
    const cfg = aiConfigFromEnv({
      ...GEMINI,
      AI_TRANSCRIBE_BASE_URL: "https://api.groq.com/openai/v1/",
      AI_TRANSCRIBE_API_KEY: "groq",
      AI_TRANSCRIBE_MODEL: "whisper-large-v3",
    });
    expect(cfg).toMatchObject({
      transcribeMode: "transcriptions",
      transcribeBaseURL: "https://api.groq.com/openai/v1",
      transcribeApiKey: "groq",
      transcribeModel: "whisper-large-v3",
      apiKey: "gem",
    });
  });

  it("maps recorder MIME types to input_audio formats", () => {
    expect(audioFormat("audio/webm;codecs=opus")).toBe("webm");
    expect(audioFormat("audio/ogg; codecs=opus")).toBe("ogg");
    expect(audioFormat("audio/mp4")).toBe("m4a");
    expect(audioFormat("audio/mpeg")).toBe("mp3");
    expect(audioFormat("audio/x-wav")).toBe("wav");
    expect(audioFormat("audio/unknown")).toBe("webm");
  });
});

describe("buildTranscribeRequest / aiTranscribe", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("builds a chat completions body with an input_audio part", async () => {
    const cfg = aiConfigFromEnv(GEMINI);
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const { url, init } = await buildTranscribeRequest(cfg, audio, "audio/webm;codecs=opus");
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer gem",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gemini-3.8-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: TRANSCRIBE_PROMPT },
            { type: "input_audio", input_audio: { data: "AQID", format: "webm" } },
          ],
        },
      ],
    });
  });

  it("builds a multipart /audio/transcriptions request by default", async () => {
    const cfg = aiConfigFromEnv({ AI_API_KEY: "k" });
    const audio = new Blob([new Uint8Array([1])], { type: "audio/mp4" });
    const { url, init } = await buildTranscribeRequest(cfg, audio, "audio/mp4");
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect((form.get("file") as File).name).toBe("voice.mp4");
  });

  it("reads the transcript from a chat completion (mocked fetch)", async () => {
    for (const [k, v] of Object.entries(GEMINI)) vi.stubEnv(k, v);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: " halo dunia \n" } }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const text = await aiTranscribe(new Blob([new Uint8Array([1])]), "audio/ogg");
    expect(text).toBe("halo dunia");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces provider errors", async () => {
    vi.stubEnv("AI_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(aiTranscribe(new Blob([]), "audio/webm")).rejects.toThrow(
      /Transkripsi gagal \[404\]/,
    );
  });
});

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
      transcribeMode: "transcriptions",
      transcribeBaseURL: "https://api.openai.com/v1",
      transcribeApiKey: "k",
      embeddingModel: "text-embedding-3-small",
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

import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output, NoObjectGeneratedError, type ModelMessage } from "ai";
import { z } from "zod";

// Direct AI provider access through the Vercel AI SDK (no vendor gateway).
//
//   AI_PROVIDER           `openai` (default; Responses API) or `openai-compatible` (Chat
//                         Completions API at AI_BASE_URL: OpenRouter, Groq, Gemini, Ollama, ...)
//   AI_API_KEY            provider API key (required; AI features are disabled without it)
//   AI_BASE_URL           API base URL, e.g. https://openrouter.ai/api/v1 (required for
//                         `openai-compatible`, optional for `openai`)
//   AI_MODEL              text model (default gpt-4o-mini)
//   AI_VISION_MODEL       model for image input / OCR (default AI_MODEL)
//   AI_TRANSCRIBE_MODE    `transcriptions` (OpenAI-style /audio/transcriptions, default) or `chat`
//                         (Chat Completions with an `input_audio` part; Gemini has no
//                         /audio/transcriptions). Defaults to `chat` when the transcription host is
//                         generativelanguage.googleapis.com.
//   AI_TRANSCRIBE_MODEL   speech-to-text model (default whisper-1; AI_MODEL in `chat` mode)
//   AI_TRANSCRIBE_BASE_URL / AI_TRANSCRIBE_API_KEY
//                         optional separate host for voice (e.g. Groq whisper-large-v3 while Gemini
//                         handles text); the key defaults to AI_API_KEY

export const AI_NOT_CONFIGURED_MESSAGE =
  "AI belum dikonfigurasi. Admin perlu mengisi AI_API_KEY (lihat .env.example).";

export class AiNotConfiguredError extends Error {
  constructor(detail?: string) {
    super(detail ? `${AI_NOT_CONFIGURED_MESSAGE} ${detail}` : AI_NOT_CONFIGURED_MESSAGE);
    this.name = "AiNotConfiguredError";
  }
}

export type AiProviderKind = "openai" | "openai-compatible";

export type AiConfig = {
  provider: AiProviderKind;
  apiKey: string;
  baseURL: string | undefined;
  model: string;
  visionModel: string;
  transcribeModel: string;
  transcribeMode: AiTranscribeMode;
  /** Host for voice transcription (AI_TRANSCRIBE_BASE_URL, else AI_BASE_URL, else OpenAI). */
  transcribeBaseURL: string;
  transcribeApiKey: string;
};

export type AiTranscribeMode = "transcriptions" | "chat";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GEMINI_HOST = "generativelanguage.googleapis.com";

function isGeminiHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === GEMINI_HOST;
  } catch {
    return false;
  }
}

/** Reads and validates the AI settings. Throws AiNotConfiguredError when unusable. */
export function aiConfigFromEnv(env: Record<string, string | undefined> = process.env): AiConfig {
  const read = (key: string) => env[key]?.trim() || undefined;
  const apiKey = read("AI_API_KEY");
  if (!apiKey) throw new AiNotConfiguredError();

  const rawProvider = (read("AI_PROVIDER") ?? "openai").toLowerCase();
  if (rawProvider !== "openai" && rawProvider !== "openai-compatible") {
    throw new AiNotConfiguredError(
      `AI_PROVIDER "${rawProvider}" tidak dikenal (pakai openai atau openai-compatible).`,
    );
  }
  const provider: AiProviderKind = rawProvider;
  const baseURL = read("AI_BASE_URL")?.replace(/\/+$/, "");
  if (provider === "openai-compatible" && !baseURL) {
    throw new AiNotConfiguredError("AI_BASE_URL wajib diisi untuk AI_PROVIDER=openai-compatible.");
  }

  const model = read("AI_MODEL") ?? DEFAULT_MODEL;
  const transcribeBaseURL =
    read("AI_TRANSCRIBE_BASE_URL")?.replace(/\/+$/, "") ?? baseURL ?? OPENAI_BASE_URL;
  const rawMode = read("AI_TRANSCRIBE_MODE")?.toLowerCase();
  if (rawMode !== undefined && rawMode !== "transcriptions" && rawMode !== "chat") {
    throw new AiNotConfiguredError(
      `AI_TRANSCRIBE_MODE "${rawMode}" tidak dikenal (pakai transcriptions atau chat).`,
    );
  }
  const transcribeMode: AiTranscribeMode =
    rawMode ?? (isGeminiHost(transcribeBaseURL) ? "chat" : "transcriptions");
  return {
    provider,
    apiKey,
    baseURL,
    model,
    visionModel: read("AI_VISION_MODEL") ?? model,
    transcribeModel:
      read("AI_TRANSCRIBE_MODEL") ?? (transcribeMode === "chat" ? model : DEFAULT_TRANSCRIBE_MODEL),
    transcribeMode,
    transcribeBaseURL,
    transcribeApiKey: read("AI_TRANSCRIBE_API_KEY") ?? apiKey,
  };
}

/** True when any message carries an image or file part (routes the call to AI_VISION_MODEL). */
export function hasImageContent(messages: ModelMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((part) => part.type === "image" || part.type === "file"),
  );
}

function languageModel(config: AiConfig, modelId: string) {
  const provider = createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.provider === "openai-compatible" ? { name: "openai-compatible" } : {}),
  });
  // OpenAI-compatible hosts implement Chat Completions, not OpenAI's Responses API.
  return config.provider === "openai" ? provider.responses(modelId) : provider.chat(modelId);
}

/** Provider options: never let OpenAI store prompts (user notes) server-side. */
function providerOptions(config: AiConfig) {
  return config.provider === "openai" ? { openai: { store: false } } : undefined;
}

export async function aiText(
  request: Request,
  system: string,
  messages: ModelMessage[],
): Promise<string> {
  const config = aiConfigFromEnv();
  const modelId = hasImageContent(messages) ? config.visionModel : config.model;
  const opts = providerOptions(config);
  const result = streamText({
    model: languageModel(config, modelId),
    system,
    messages,
    abortSignal: request.signal,
    ...(opts ? { providerOptions: opts } : {}),
  });
  return await result.text;
}

const parsedTaskSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string().nullable(),
      priority: z.enum(["high", "medium", "low"]),
      due_date: z.string().nullable(),
      tags: z.array(z.string()),
      project: z.string().nullable(),
      kind: z.enum(["task", "note", "issue"]),
    }),
  ),
});

export type ParsedTask = z.infer<typeof parsedTaskSchema>["tasks"][number];

export async function aiParseBrainDump(
  request: Request,
  dump: string,
  existingProjects: string[],
): Promise<ParsedTask[]> {
  const config = aiConfigFromEnv();
  const opts = providerOptions(config);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const result = streamText({
      model: languageModel(config, config.model),
      abortSignal: request.signal,
      output: Output.object({ schema: parsedTaskSchema }),
      system: `Anda adalah asisten yang mengubah brain dump acak (bahasa Indonesia, poin-poin singkat dari meeting/diskusi/belanja) menjadi daftar item terstruktur. Hari ini: ${today}.
Aturan:
- Pecah setiap poin menjadi item terpisah, walau satu kalimat berisi beberapa poin.
- Meeting bisa membahas beberapa aplikasi/fitur berbeda — kelompokkan lewat field "project" (nama aplikasi/proyek yang disebut; null jika tidak jelas).
- kind: "task" untuk pekerjaan, "issue" untuk bug/masalah yang harus diperbaiki, "note" untuk catatan/referensi.
- priority: "high" untuk hal mendesak/blocking/deadline dekat, "medium" default, "low" untuk suka-suka.
- due_date: ISO date (YYYY-MM-DD) jika disebut atau jelas tersirat (misal "besok", "Jumat"), selain itu null.
- tags: 1-3 tag pendek lowercase (misal "bug", "meeting", "belanja", "follow-up").
- description: parafrase singkat 1-2 kalimat yang memperjelas maksud poin, dalam bahasa Indonesia. null jika poin sudah jelas.
Proyek yang sudah ada: ${existingProjects.length ? existingProjects.join(", ") : "(belum ada)"}. Gunakan nama persis sama jika cocok.`,
      messages: [{ role: "user", content: dump }],
      ...(opts ? { providerOptions: opts } : {}),
    });
    return (await result.output).tasks;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) && error.text) {
      const match = error.text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = parsedTaskSchema.safeParse(JSON.parse(match[0]));
        if (parsed.success) return parsed.data.tasks;
      }
    }
    throw error;
  }
}

/**
 * `input_audio.format` for a recorder MIME type. Browsers record audio/webm (Chrome, Edge,
 * Firefox), audio/ogg (older Firefox) or audio/mp4 (Safari); Gemini accepts webm, ogg, m4a/aac,
 * mp3, wav, flac, aiff and opus. (OpenAI's own chat audio models only accept wav and mp3, so use
 * `transcriptions` mode there.)
 */
export function audioFormat(mimeType: string): string {
  const sub = (mimeType.split(";")[0]?.split("/")[1] ?? "").trim().toLowerCase();
  if (sub === "mpeg" || sub === "mp3" || sub === "mpga") return "mp3";
  if (sub === "wav" || sub === "x-wav" || sub === "wave" || sub === "vnd.wave") return "wav";
  if (sub === "mp4" || sub === "m4a" || sub === "x-m4a") return "m4a";
  if (sub === "ogg" || sub === "oga" || sub === "x-ogg") return "ogg";
  if (["aac", "flac", "opus", "webm", "aiff"].includes(sub)) return sub;
  return "webm";
}

/** File extension for the multipart upload. */
function audioExtension(mimeType: string): string {
  const fmt = audioFormat(mimeType);
  return fmt === "m4a" ? "mp4" : fmt;
}

export const TRANSCRIBE_PROMPT = "Transcribe this audio verbatim; reply with the transcript only.";

/** Builds the HTTP request for the configured transcription mode. */
export async function buildTranscribeRequest(
  config: AiConfig,
  audio: Blob,
  mimeType: string,
): Promise<{ url: string; init: RequestInit }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.transcribeApiKey}` };
  if (config.transcribeMode === "chat") {
    const data = Buffer.from(await audio.arrayBuffer()).toString("base64");
    headers["Content-Type"] = "application/json";
    return {
      url: `${config.transcribeBaseURL}/chat/completions`,
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.transcribeModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: TRANSCRIBE_PROMPT },
                { type: "input_audio", input_audio: { data, format: audioFormat(mimeType) } },
              ],
            },
          ],
        }),
      },
    };
  }
  const form = new FormData();
  form.append("file", new File([audio], `voice.${audioExtension(mimeType)}`, { type: mimeType }));
  form.append("model", config.transcribeModel);
  // OpenAI-style endpoint, also offered by Groq and other OpenAI-compatible hosts.
  return {
    url: `${config.transcribeBaseURL}/audio/transcriptions`,
    init: { method: "POST", headers, body: form },
  };
}

type ChatCompletion = {
  choices?: { message?: { content?: string | { text?: string }[] | null } }[];
};

export async function aiTranscribe(audio: Blob, mimeType: string): Promise<string> {
  const config = aiConfigFromEnv();
  const { url, init } = await buildTranscribeRequest(config, audio, mimeType);
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Transkripsi gagal [${res.status}]: ${detail}`);
  }
  if (config.transcribeMode === "chat") {
    const data = (await res.json()) as ChatCompletion;
    const content = data.choices?.[0]?.message?.content;
    const text = Array.isArray(content)
      ? content.map((p) => p.text ?? "").join("")
      : (content ?? "");
    return text.trim();
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

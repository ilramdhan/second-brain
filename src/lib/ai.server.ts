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
//   AI_TRANSCRIBE_MODEL   speech-to-text model for /audio/transcriptions (default whisper-1)

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
};

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

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
  return {
    provider,
    apiKey,
    baseURL,
    model,
    visionModel: read("AI_VISION_MODEL") ?? model,
    transcribeModel: read("AI_TRANSCRIBE_MODEL") ?? DEFAULT_TRANSCRIBE_MODEL,
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

export async function aiTranscribe(audio: Blob, mimeType: string): Promise<string> {
  const config = aiConfigFromEnv();
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new File([audio], `voice.${ext}`, { type: mimeType }));
  form.append("model", config.transcribeModel);
  // OpenAI-style endpoint, also offered by Groq and other OpenAI-compatible hosts.
  const res = await fetch(`${config.baseURL ?? OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Transkripsi gagal [${res.status}]: ${detail}`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

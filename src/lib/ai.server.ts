import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output, NoObjectGeneratedError, type ModelMessage } from "ai";
import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

function getApiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  return key;
}

function createRunIdFetch(request: Request) {
  let runId = request.headers.get(RUN_ID_HEADER)?.trim() || undefined;
  return {
    getRunId: () => runId,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(RUN_ID_HEADER)) headers.set(RUN_ID_HEADER, runId);
      const response = await fetch(input, { ...init, headers });
      runId ??= response.headers.get(RUN_ID_HEADER)?.trim() || undefined;
      return response;
    },
  };
}

function createProvider(request: Request) {
  const apiKey = getApiKey();
  const runIdFetch = createRunIdFetch(request);
  return createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });
}

const MODEL = "openai/gpt-6-astra";

export async function aiText(
  request: Request,
  system: string,
  messages: ModelMessage[],
): Promise<string> {
  const provider = createProvider(request);
  const result = streamText({
    model: provider.responses(MODEL),
    system,
    messages,
    abortSignal: request.signal,
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
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
  const provider = createProvider(request);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const result = streamText({
      model: provider.responses(MODEL),
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
      providerOptions: {
        openai: {
          store: false,
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
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
  const apiKey = getApiKey();
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new File([audio], `voice.${ext}`, { type: mimeType }));
  form.append("model", "google/gemini-3.5-transcribe");
  const res = await fetch(`${GATEWAY_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Lovable-API-Key": apiKey },
    body: form,
  });
  if (!res.ok) throw new Error(`Transkripsi gagal [${res.status}]: ${await res.text()}`);
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

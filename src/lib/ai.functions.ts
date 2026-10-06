import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Input limits (ANALYSIS S8): bound AI cost and serverless memory. Base64 payloads are checked
// by length before decoding (4 base64 chars = 3 bytes).
const MAX_DUMP_CHARS = 20_000;
const MAX_POINT_CHARS = 5_000;
const MAX_MEETING_CHARS = 50_000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const b64Len = (bytes: number) => Math.ceil(bytes / 3) * 4;

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Teks kosong")
    .max(max, `Teks terlalu panjang (maks ${max.toLocaleString("id-ID")} karakter)`);
const base64 = (maxBytes: number, label: string) =>
  z
    .string()
    .min(1)
    .max(b64Len(maxBytes), `${label} terlalu besar (maks ${maxBytes / 1024 / 1024}MB)`)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, `${label} tidak valid`);
const audioMime = z
  .string()
  .max(100)
  .regex(/^audio\/[\w.+-]+(;[\w=.+\- ]*)*$/i, "Format audio tidak didukung");
const imageMime = z
  .string()
  .regex(/^image\/(png|jpe?g|webp|gif|heic|heif|avif|bmp)$/i, "Format gambar tidak didukung");

// Tighter limits in the public demo (APP_MODE=demo): the fixtures ignore most of the input, so
// there is no reason to accept (and ship through a serverless function) large payloads.
const DEMO_MAX_TEXT_CHARS = 2_000;
const DEMO_MAX_UPLOAD_BYTES = 1024 * 1024;

type AiInput = { text?: string; base64?: string };

/** Rejects inputs over the demo limits; a no-op outside the demo. */
async function enforceDemoInputLimits(input: AiInput) {
  const { isDemoMode } = await import("@/server/demo/mode.server");
  if (!isDemoMode()) return;
  if (input.text !== undefined && input.text.length > DEMO_MAX_TEXT_CHARS) {
    throw new Error(
      `Batas demo: teks maks ${DEMO_MAX_TEXT_CHARS.toLocaleString("id-ID")} karakter.`,
    );
  }
  if (input.base64 !== undefined && input.base64.length > b64Len(DEMO_MAX_UPLOAD_BYTES)) {
    throw new Error("Batas demo: file maks 1MB.");
  }
}

/**
 * Fails fast with "AI belum dikonfigurasi" when no provider is set up (so no budget is spent;
 * the demo never needs one), applies the demo input limits, then spends one unit of the per-user
 * AI budget (30 calls / 10 min) or throws a friendly error.
 */
async function limitAi(
  supabase: Parameters<typeof import("@/server/rateLimit.server").enforceRateLimit>[0],
  input: AiInput,
) {
  const { assertAiAvailable } = await import("./ai.server");
  await assertAiAvailable();
  await enforceDemoInputLimits(input);
  const { enforceRateLimit, AI_RATE_LIMIT } = await import("@/server/rateLimit.server");
  await enforceRateLimit(supabase, AI_RATE_LIMIT);
}

export const parseBrainDump = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ dump: text(MAX_DUMP_CHARS) }))
  .handler(async ({ data, context }) => {
    await limitAi(context.supabase, { text: data.dump });
    const request = getRequest();
    const { aiParseBrainDump } = await import("./ai.server");
    const { data: projects } = await context.supabase.from("projects").select("name");
    return aiParseBrainDump(
      request,
      data.dump,
      (projects ?? []).map((p) => p.name),
    );
  });

export const paraphrasePoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ point: text(MAX_POINT_CHARS) }))
  .handler(async ({ data, context }) => {
    await limitAi(context.supabase, { text: data.point });
    const request = getRequest();
    const { aiText } = await import("./ai.server");
    return aiText(
      request,
      "Parafrase poin singkat berikut menjadi deskripsi catatan yang lengkap dan jelas dalam bahasa Indonesia (2-4 kalimat). Jaga makna asli, jangan menambah fakta baru. Balas hanya dengan hasil parafrase.",
      [{ role: "user", content: data.point }],
      "paraphrase",
    );
  });

export const summarizeMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ notes: text(MAX_MEETING_CHARS) }))
  .handler(async ({ data, context }) => {
    await limitAi(context.supabase, { text: data.notes });
    const request = getRequest();
    const { aiText } = await import("./ai.server");
    return aiText(
      request,
      "Buat notulen meeting yang rapi dalam bahasa Indonesia dari catatan mentah berikut. Format markdown: ## Ringkasan, ## Poin Pembahasan (per topik/aplikasi jika lebih dari satu), ## Action Items (dengan penanggung jawab & deadline bila disebut).",
      [{ role: "user", content: data.notes }],
      "meeting",
    );
  });

export const transcribeVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ audioBase64: base64(MAX_AUDIO_BYTES, "Rekaman"), mimeType: audioMime }),
  )
  .handler(async ({ data, context }) => {
    await limitAi(context.supabase, { base64: data.audioBase64 });
    const request = getRequest();
    const { aiTranscribe } = await import("./ai.server");
    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    return aiTranscribe(new Blob([bytes], { type: data.mimeType }), data.mimeType, request.signal);
  });

export const ocrImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ imageBase64: base64(MAX_IMAGE_BYTES, "Gambar"), mimeType: imageMime }))
  .handler(async ({ data, context }) => {
    await limitAi(context.supabase, { base64: data.imageBase64 });
    const request = getRequest();
    const { aiText } = await import("./ai.server");
    return aiText(
      request,
      "Ekstrak semua teks dari gambar (foto papan tulis, coretan tangan, catatan). Tulis hasilnya dalam bahasa aslinya. Jika ada bagian yang tidak terbaca atau ragu, tandai dengan [?]. Jika gambar berisi diagram/daftar, susun ulang jadi teks terstruktur.",
      [
        {
          role: "user",
          content: [
            { type: "text", text: "Ekstrak teks dari gambar ini." },
            { type: "image", image: `data:${data.mimeType};base64,${data.imageBase64}` },
          ],
        },
      ],
      "ocr",
    );
  });

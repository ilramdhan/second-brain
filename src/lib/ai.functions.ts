import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const parseBrainDump = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ dump: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const request = getRequest();
    const { aiParseBrainDump } = await import("./ai.server");
    const { data: projects } = await context.supabase.from("projects").select("name");
    return aiParseBrainDump(request, data.dump, (projects ?? []).map((p) => p.name));
  });

export const paraphrasePoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ point: z.string().min(1) }))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { aiText } = await import("./ai.server");
    return aiText(
      request,
      "Parafrase poin singkat berikut menjadi deskripsi catatan yang lengkap dan jelas dalam bahasa Indonesia (2-4 kalimat). Jaga makna asli, jangan menambah fakta baru. Balas hanya dengan hasil parafrase.",
      [{ role: "user", content: data.point }],
    );
  });

export const summarizeMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ notes: z.string().min(1) }))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { aiText } = await import("./ai.server");
    return aiText(
      request,
      "Buat notulen meeting yang rapi dalam bahasa Indonesia dari catatan mentah berikut. Format markdown: ## Ringkasan, ## Poin Pembahasan (per topik/aplikasi jika lebih dari satu), ## Action Items (dengan penanggung jawab & deadline bila disebut).",
      [{ role: "user", content: data.notes }],
    );
  });

export const transcribeVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ audioBase64: z.string().min(1), mimeType: z.string() }))
  .handler(async ({ data }) => {
    const { aiTranscribe } = await import("./ai.server");
    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    if (bytes.length > 10 * 1024 * 1024) throw new Error("Rekaman terlalu besar (maks 10MB)");
    return aiTranscribe(new Blob([bytes], { type: data.mimeType }), data.mimeType);
  });

export const ocrImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ imageBase64: z.string().min(1), mimeType: z.string() }))
  .handler(async ({ data }) => {
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
    );
  });

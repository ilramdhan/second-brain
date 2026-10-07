import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// "Isi dari teks" for the project and template forms. These functions only EXTRACT a draft: the
// user reviews it in the form and saves through the normal path. Same AI gate as message capture
// (AI available → per-user AI budget → AI; local fallback on not configured, rate limited or any
// AI error), same input bounds.
const MAX_PREFILL_CHARS = 4000;
const DEMO_MAX_PREFILL_CHARS = 2000;

const prefillText = z
  .string()
  .trim()
  .min(1, "Teks kosong")
  .max(MAX_PREFILL_CHARS, "Teks terlalu panjang");

type RlsClient = Parameters<typeof import("@/server/rateLimit.server").enforceRateLimit>[0];

async function setup(supabase: RlsClient, text: string) {
  const { isDemoMode } = await import("@/server/demo/mode.server");
  if (isDemoMode() && text.length > DEMO_MAX_PREFILL_CHARS)
    throw new Error(`Batas demo: teks maks ${DEMO_MAX_PREFILL_CHARS} karakter.`);
  const { appTimezone } = await import("@/server/n8n/time.server");
  return {
    request: getRequest(),
    clock: { now: new Date(), tz: appTimezone() },
    gate: {
      assertAi: async () => {
        const { assertAiAvailable } = await import("./ai.server");
        await assertAiAvailable();
      },
      consume: async () => {
        const { enforceRateLimit, AI_RATE_LIMIT } = await import("@/server/rateLimit.server");
        await enforceRateLimit(supabase, AI_RATE_LIMIT);
        return true;
      },
    },
  };
}

/**
 * New-project draft from text: name, description, PARA, status, colour, parent project, start/due/
 * launch dates and suggested members. Members are only names of people the caller already shares
 * a project with; they are NOT invited here (the owner invites from the project's team tab).
 */
export const draftProjectFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ text: prefillText }))
  .handler(async ({ data, context }) => {
    const { request, clock, gate } = await setup(context.supabase, data.text);
    const { loadTaskCandidates, extractWithFallback } = await import("@/server/taskCapture.server");
    const prefill = await import("@/server/formPrefill.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Same scoped candidate loader as task capture: accessible projects and their people.
    const t = await loadTaskCandidates(context.userId, supabaseAdmin);
    const seen = new Set<string>([context.userId]);
    const candidates = {
      projects: t.projects,
      people: t.members.flatMap((m) =>
        seen.has(m.user_id) ? [] : (seen.add(m.user_id), [{ user_id: m.user_id, name: m.name }]),
      ),
    };
    const { extraction, via, reason } = await extractWithFallback(
      "project",
      gate,
      async () => {
        const { aiExtractProject } = await import("./ai.server");
        return aiExtractProject(request, data.text, candidates, clock);
      },
      () => prefill.fallbackProjectExtraction(data.text, clock),
    );
    const r = prefill.resolveProjectExtraction(extraction, candidates, clock, data.text);
    return { ...r, via, fallbackReason: reason ?? null };
  });

/** New-template draft from text: kind, name, initial title, body, tags, priority, estimate. */
export const draftTemplateFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ text: prefillText }))
  .handler(async ({ data, context }) => {
    const { request, clock, gate } = await setup(context.supabase, data.text);
    const { extractWithFallback } = await import("@/server/taskCapture.server");
    const prefill = await import("@/server/formPrefill.server");
    const { extraction, via, reason } = await extractWithFallback(
      "template",
      gate,
      async () => {
        const { aiExtractTemplate } = await import("./ai.server");
        return aiExtractTemplate(request, data.text, clock);
      },
      () => prefill.fallbackTemplateExtraction(data.text, clock),
    );
    const r = prefill.resolveTemplateExtraction(extraction, data.text);
    return { ...r, via, fallbackReason: reason ?? null };
  });

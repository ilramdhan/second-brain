import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  requireSupabaseAuth,
  requireSupabaseSession,
} from "@/integrations/supabase/auth-middleware";

// TOTP recovery codes (migration 0027, src/server/mfaRecovery.server.ts). Generating and counting
// need a fully verified (aal2) session; redeeming is part of the sign-in TOTP step, so it accepts
// an aal1 token and does nothing but check the code and reset the caller's own 2FA.

async function assertRecoveryAvailable() {
  const { assertNotDemo } = await import("@/server/demo/mode.server");
  assertNotDemo("Kode pemulihan");
}

/** Creates a new batch of 10 codes (old ones stop working) and returns them once. */
export const generateRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertRecoveryAvailable();
    // Only users with 2FA (an aal2 session) have something to recover.
    if (context.claims.aal !== "aal2") {
      throw new Error("Aktifkan verifikasi dua langkah terlebih dahulu.");
    }
    const { enforceRateLimit } = await import("@/server/rateLimit.server");
    const { RECOVERY_GENERATE_RATE_LIMIT, replaceRecoveryCodes } =
      await import("@/server/mfaRecovery.server");
    await enforceRateLimit(context.supabase, RECOVERY_GENERATE_RATE_LIMIT);
    return { codes: await replaceRecoveryCodes(context.userId) };
  });

/** Number of unused codes of the signed-in user. */
export const recoveryCodesStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertRecoveryAvailable();
    const { countRecoveryCodes } = await import("@/server/mfaRecovery.server");
    return { remaining: await countRecoveryCodes(context.userId) };
  });

/**
 * Sign-in TOTP step: trades one recovery code for a 2FA reset (the user's factors are deleted,
 * which also ends their other sessions). Answers `{ ok: false, reason }` instead of throwing for
 * a wrong code or an exhausted budget.
 */
export const redeemRecoveryCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseSession])
  .inputValidator(z.object({ code: z.string().trim().min(1).max(32) }))
  .handler(async ({ data, context }) => {
    await assertRecoveryAvailable();
    const { clientIp } = await import("@/server/demo/ipRateLimit.server");
    const { redeemRecoveryCodeFor } = await import("@/server/mfaRecovery.server");
    return redeemRecoveryCodeFor(context.userId, data.code, clientIp(getRequest()));
  });

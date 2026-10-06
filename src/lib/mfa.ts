// TOTP two-factor authentication through Supabase MFA (Phase 9.2). A user with a verified TOTP
// factor signs in at `aal1` (password, magic link or Google) and must answer a TOTP challenge to
// reach `aal2` before the app opens. The client guard is a UX layer: the database refuses aal1
// sessions of such users as well (migration 0021, restrictive RLS policies via mfa_satisfied()).
import type { Factor } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

export type AssuranceLevels = {
  currentLevel: string | null;
  nextLevel: string | null;
};

/** True when the session must still pass a TOTP challenge (verified factor, session below aal2). */
export function needsMfaChallenge(levels: AssuranceLevels | null | undefined): boolean {
  if (!levels) return false;
  return levels.nextLevel === "aal2" && levels.currentLevel !== "aal2";
}

/**
 * Assurance levels of the stored session. supabase-js reads them from the access token and the
 * cached user (no network request). An error is reported as "challenge required" (fail closed):
 * the visitor then sees the TOTP step or is sent back to /login, never the app.
 */
export async function sessionAssurance(): Promise<AssuranceLevels> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return { currentLevel: "aal1", nextLevel: "aal2" };
  return { currentLevel: data.currentLevel, nextLevel: data.nextLevel };
}

/** Six-digit code from an authenticator app (spaces and dashes typed or pasted are ignored). */
export function normalizeTotpCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

/** Verified TOTP factors of the signed-in user. */
export async function verifiedTotpFactors(): Promise<Factor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data.totp ?? []).filter((f) => f.status === "verified");
}

/** Answers a TOTP challenge for `factorId`; on success the session is upgraded to aal2. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verified = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
  if (verified.error) throw verified.error;
}

/** Message key for a TOTP verify error (wrong or expired code, too many attempts). */
export function totpErrorKey(error: unknown): "mfaCodeInvalid" | "mfaTooMany" | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { code?: unknown; status?: unknown };
  if (e.status === 429 || e.code === "over_request_rate_limit" || e.code === "too_many_attempts")
    return "mfaTooMany";
  if (
    e.code === "mfa_verification_failed" ||
    e.code === "mfa_challenge_expired" ||
    e.code === "invalid_code" ||
    e.status === 422 ||
    e.status === 400
  )
    return "mfaCodeInvalid";
  return undefined;
}

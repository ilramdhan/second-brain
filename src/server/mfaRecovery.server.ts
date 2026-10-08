// One-time recovery codes for TOTP two-factor authentication (migration 0027).
//
// Codes are 8 characters from a 32-letter alphabet without look-alikes (40 bits each), shown as
// `XXXX-XXXX`. Only a keyed hash is stored: HMAC-SHA256 over `<user id>:<code>` with a key
// derived from TOKEN_ENCRYPTION_KEY (prefix `h1:`), or, when that secret is not configured, a
// SHA-256 salted with the user id (prefix `s1:`). The user id binds every hash to its owner, so
// equal codes of two users never share a hash. The pure helpers are unit-tested; the database
// helpers use the service role and scope every query to the user id they were given.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createIpRateLimiter } from "@/server/demo/ipRateLimit.server";
import type { RateLimitRule } from "@/server/rateLimit.server";

/** Codes generated per batch (a new batch replaces the previous one). */
export const RECOVERY_CODE_COUNT = 10;
/** Crockford-style base32 without I, L, O, U: easy to read aloud and to type. */
export const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;

/** Redeem attempts per user (counted in Postgres, shared by every server instance). */
export const RECOVERY_REDEEM_RATE_LIMIT: RateLimitRule = {
  bucket: "mfa_recovery",
  subject: "kode pemulihan",
  max: 5,
  windowSeconds: 900,
};
/** Generating a new batch (each one invalidates the previous codes). */
export const RECOVERY_GENERATE_RATE_LIMIT: RateLimitRule = {
  bucket: "mfa_recovery_gen",
  subject: "kode pemulihan",
  max: 10,
  windowSeconds: 3600,
};
/** Redeem attempts per IP and minute (in memory, per instance). */
export const RECOVERY_IP_LIMIT = 10;

type Env = Record<string, string | undefined>;

/** One random code, `XXXX-XXXX`. 256 is a multiple of 32, so `byte & 31` is uniform. */
export function generateRecoveryCode(
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  let out = "";
  for (const byte of random(new Uint8Array(CODE_LENGTH))) out += RECOVERY_ALPHABET[byte & 31];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** A batch of distinct codes. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/**
 * Canonical `XXXX-XXXX` form of a typed or pasted code (case, spaces and dashes are ignored;
 * the look-alikes O/I/L are read as 0/1/1), or null when it cannot be a recovery code.
 */
export function normalizeRecoveryCode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (compact.length !== CODE_LENGTH) return null;
  for (const ch of compact) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/** HMAC key derived from TOKEN_ENCRYPTION_KEY (domain-separated), or null when unset. */
export function recoveryHashKey(env: Env = process.env): Buffer | null {
  const secret = env["TOKEN_ENCRYPTION_KEY"]?.trim();
  if (!secret) return null;
  return createHash("sha256").update(`mfa-recovery-codes:v1:${secret}`, "utf8").digest();
}

/** Stored hash of a normalized code. */
export function hashRecoveryCode(userId: string, code: string, key: Buffer | null): string {
  const message = `${userId}:${code}`;
  if (key) return `h1:${createHmac("sha256", key).update(message, "utf8").digest("hex")}`;
  return `s1:${createHash("sha256").update(`mfa-recovery-codes:${message}`, "utf8").digest("hex")}`;
}

/** Constant-time comparison of two stored-hash strings (lengths are hidden by hashing first). */
function hashesEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Id of the stored code that matches `rawCode`, or null. Every row is compared (no early exit)
 * and each row's own scheme (`h1:`/`s1:`) is used, so codes stored before TOKEN_ENCRYPTION_KEY
 * was configured keep working.
 */
export function findMatchingCode(
  userId: string,
  rawCode: string,
  rows: { id: string; code_hash: string }[],
  key: Buffer | null,
): string | null {
  const code = normalizeRecoveryCode(rawCode);
  if (!code) return null;
  const hmac = key ? hashRecoveryCode(userId, code, key) : null;
  const salted = hashRecoveryCode(userId, code, null);
  let match: string | null = null;
  for (const row of rows) {
    const candidate = row.code_hash.startsWith("h1:") ? hmac : salted;
    const equal = candidate !== null && hashesEqual(candidate, row.code_hash);
    if (equal && match === null) match = row.id;
  }
  return match;
}

// --- Database (service role, always scoped to `userId`) -----------------------------------------

/** Replaces the user's codes with a new batch and returns the plaintext (shown once). */
export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const key = recoveryHashKey();
  const { error: deleteError } = await supabaseAdmin
    .from("mfa_recovery_codes")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw new Error("Gagal membuat kode pemulihan.");
  const { error } = await supabaseAdmin
    .from("mfa_recovery_codes")
    .insert(
      codes.map((code) => ({ user_id: userId, code_hash: hashRecoveryCode(userId, code, key) })),
    );
  if (error) throw new Error("Gagal membuat kode pemulihan.");
  return codes;
}

/** Unused codes left. */
export async function countRecoveryCodes(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("mfa_recovery_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("used_at", null);
  if (error) throw new Error("Gagal memuat kode pemulihan.");
  return count ?? 0;
}

export type RedeemResult = { ok: true } | { ok: false; reason: "invalid" | "rate_limited" };

let ipLimiter: ReturnType<typeof createIpRateLimiter> | undefined;

async function consumeUserBudget(userId: string): Promise<boolean> {
  const rule = RECOVERY_REDEEM_RATE_LIMIT;
  const { data, error } = await supabaseAdmin.rpc("consume_rate_limit_for", {
    _user_id: userId,
    _bucket: rule.bucket,
    _max: rule.max,
    _window_seconds: rule.windowSeconds,
  });
  // Fail closed: a broken limiter must not allow unlimited guessing.
  return !error && data === true;
}

/**
 * Redeems one code for `userId` (identified by their aal1 token): per-IP and per-user limits,
 * then a constant-time match against the unused codes, then the code is marked used, the
 * remaining codes are dropped and every MFA factor of the user is deleted so they can finish
 * signing in and enroll again. Nothing about the code is logged.
 */
export async function redeemRecoveryCodeFor(
  userId: string,
  rawCode: string,
  ip: string,
): Promise<RedeemResult> {
  ipLimiter ??= createIpRateLimiter({ limit: RECOVERY_IP_LIMIT });
  if (!ipLimiter.consume(ip).allowed) return { ok: false, reason: "rate_limited" };
  if (!(await consumeUserBudget(userId))) return { ok: false, reason: "rate_limited" };

  const { data: rows, error } = await supabaseAdmin
    .from("mfa_recovery_codes")
    .select("id,code_hash")
    .eq("user_id", userId)
    .is("used_at", null);
  if (error) throw new Error("Gagal memeriksa kode pemulihan.");
  const matchId = findMatchingCode(userId, rawCode, rows ?? [], recoveryHashKey());
  if (!matchId) return { ok: false, reason: "invalid" };

  // Compare-and-swap: a code redeemed twice in parallel only counts once.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", matchId)
    .eq("user_id", userId)
    .is("used_at", null)
    .select("id");
  if (claimError) throw new Error("Gagal memeriksa kode pemulihan.");
  if (!claimed?.length) return { ok: false, reason: "invalid" };

  // 2FA is reset, so the rest of this batch is meaningless; a new batch comes with re-enrollment.
  await supabaseAdmin.from("mfa_recovery_codes").delete().eq("user_id", userId).is("used_at", null);

  const { data: factors, error: listError } = await supabaseAdmin.auth.admin.mfa.listFactors({
    userId,
  });
  if (listError) throw new Error("Gagal mengatur ulang verifikasi dua langkah.");
  for (const factor of factors.factors) {
    const { error: deleteError } = await supabaseAdmin.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId,
    });
    if (deleteError) throw new Error("Gagal mengatur ulang verifikasi dua langkah.");
  }
  return { ok: true };
}

// One-time codes that link a Telegram chat to a signed-in account (`/link <code>`).
// Pure helpers (no I/O) so generation, parsing and hashing can be unit-tested.
import { createHash, randomBytes } from "node:crypto";

/** 32 symbols without the look-alikes 0/O and 1/I, so `byte % 32` is unbiased. */
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

/** Generates a random code such as `K7QM4XPA`. `random` is injectable for tests. */
export function generateLinkCode(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(LINK_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    code += LINK_CODE_ALPHABET[bytes[i]! % LINK_CODE_ALPHABET.length];
  }
  return code;
}

/** Display form shown in Settings: `K7QM-4XPA`. */
export function formatLinkCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Normalizes user input (case, spaces, dashes) to the canonical code, or returns null if it
 * cannot be a valid code. Callers must still verify the code against the database.
 */
export function normalizeLinkCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  if (code.length !== LINK_CODE_LENGTH) return null;
  for (const char of code) if (!LINK_CODE_ALPHABET.includes(char)) return null;
  return code;
}

/** SHA-256 hex digest stored in `telegram_link_codes.code_hash`; the plain code is never stored. */
export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function linkCodeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + LINK_CODE_TTL_MS);
}

/**
 * Parses a `/link` command (optionally addressed as `/link@BotName`). Returns null when the text
 * is not a `/link` command, otherwise the raw argument (possibly empty).
 */
export function parseLinkCommand(text: string): string | null {
  const match = /^\/link(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  return (match[1] ?? "").trim();
}

/**
 * Parses a `/start` command (optionally `/start@BotName`). Returns null when the text is not
 * `/start`, "" for a bare `/start`, otherwise the deep-link payload (`t.me/<bot>?start=<code>`).
 */
export function parseStartPayload(text: string): string | null {
  const match = /^\/start(?:@\w+)?(?:\s+(\S*))?\s*$/i.exec(text.trim());
  if (!match) return null;
  return (match[1] ?? "").trim();
}

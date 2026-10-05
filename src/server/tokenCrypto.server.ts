// AES-256-GCM encryption for secrets stored at rest (Google OAuth refresh/access tokens in
// `app_user_connections`, OAuth `state`). Key: TOKEN_ENCRYPTION_KEY, base64 of exactly 32 bytes
// (`openssl rand -base64 32`). Output format: base64(iv[12] || ciphertext || tag[16]).
// Rotating the key invalidates every stored connection (users reconnect once).

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

/** Decodes and validates TOKEN_ENCRYPTION_KEY; throws a readable error when unusable. */
export function tokenKeyBytes(env: Record<string, string | undefined> = process.env): Uint8Array {
  const secret = env["TOKEN_ENCRYPTION_KEY"]?.trim();
  if (!secret)
    throw new TokenCryptoError("Kunci enkripsi token (TOKEN_ENCRYPTION_KEY) belum diatur.");
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(secret);
  } catch {
    throw new TokenCryptoError("TOKEN_ENCRYPTION_KEY harus base64.");
  }
  if (bytes.length !== 32)
    throw new TokenCryptoError("TOKEN_ENCRYPTION_KEY harus 32 byte (openssl rand -base64 32).");
  return bytes;
}

async function importKey(raw: Uint8Array) {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptToken(value: string, keyBytes: Uint8Array = tokenKeyBytes()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await importKey(keyBytes),
      new TextEncoder().encode(value),
    ),
  );
  const stored = new Uint8Array(iv.length + encrypted.length);
  stored.set(iv);
  stored.set(encrypted, iv.length);
  return bytesToBase64(stored);
}

/** Decrypts `encryptToken` output; throws TokenCryptoError on tampering or a wrong key. */
export async function decryptToken(value: string, keyBytes: Uint8Array = tokenKeyBytes()) {
  try {
    const stored = base64ToBytes(value);
    const iv = stored.slice(0, 12);
    const encrypted = stored.slice(12);
    return new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await importKey(keyBytes), encrypted),
    );
  } catch {
    throw new TokenCryptoError("Token terenkripsi tidak valid.");
  }
}

/** URL-safe base64 without padding (for OAuth state / PKCE). */
export function base64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

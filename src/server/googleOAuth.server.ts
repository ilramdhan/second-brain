// Google OAuth 2.0 (authorization code + PKCE) for per-user Google Calendar access.
//
// Flow: Settings → `startGoogleCalendarConnect` builds the consent URL with an encrypted,
// short-lived `state` that carries the user id, a nonce and the PKCE verifier → Google redirects
// the popup to /oauth/google-calendar/return → the popup posts {code, state} to the opener →
// `completeGoogleCalendarConnect` runs as the signed-in user, verifies that `state` was issued to
// *this* user (blocks connecting a victim's calendar to someone else's account) and exchanges the
// code server-side with the client secret. Only the encrypted refresh token is stored.
//
// Pure helpers (no Supabase) so they can be unit-tested; network calls take an injectable fetch.
import { base64Url, decryptToken, encryptToken, tokenKeyBytes } from "./tokenCrypto.server";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_CONNECTOR = "google_calendar";
export const OAUTH_RETURN_PATH = "/oauth/google-calendar/return";
export const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

/**
 * Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and the redirect URI: GOOGLE_OAUTH_REDIRECT_URL,
 * else APP_URL + /oauth/google-calendar/return, else the request origin. Returns null when the
 * client is not configured (feature disabled).
 */
export function googleOAuthConfig(
  env: Record<string, string | undefined> = process.env,
  requestOrigin?: string,
): GoogleOAuthConfig | null {
  const clientId = env["GOOGLE_CLIENT_ID"]?.trim();
  const clientSecret = env["GOOGLE_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  const explicit = env["GOOGLE_OAUTH_REDIRECT_URL"]?.trim();
  const base = env["APP_URL"]?.trim() || requestOrigin;
  const redirectUri = explicit || (base ? new URL(OAUTH_RETURN_PATH, base).toString() : "");
  if (!redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function randomToken(bytes = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** RFC 7636 S256 code challenge. */
export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

type StatePayload = { uid: string; v: string; n: string; exp: number };

/** Encrypted (AES-GCM) state: opaque to the browser and to Google, tamper-proof, 10 min TTL. */
export async function createOAuthState(
  userId: string,
  opts: { now?: number; key?: Uint8Array } = {},
): Promise<{ state: string; verifier: string }> {
  const verifier = randomToken(48);
  const payload: StatePayload = {
    uid: userId,
    v: verifier,
    n: randomToken(12),
    exp: (opts.now ?? Date.now()) + STATE_TTL_MS,
  };
  const state = await encryptToken(JSON.stringify(payload), opts.key ?? tokenKeyBytes());
  return { state, verifier };
}

/** Verifies state for `userId`; returns the PKCE verifier or throws GoogleOAuthError. */
export async function verifyOAuthState(
  state: string,
  userId: string,
  opts: { now?: number; key?: Uint8Array } = {},
): Promise<string> {
  let payload: StatePayload;
  try {
    payload = JSON.parse(await decryptToken(state, opts.key ?? tokenKeyBytes())) as StatePayload;
  } catch {
    throw new GoogleOAuthError("Status OAuth tidak valid. Coba hubungkan lagi.", "bad_state");
  }
  if (payload.uid !== userId)
    throw new GoogleOAuthError("Status OAuth bukan milik akun ini.", "state_user_mismatch");
  if (!(payload.exp > (opts.now ?? Date.now())))
    throw new GoogleOAuthError("Waktu koneksi habis. Coba hubungkan lagi.", "state_expired");
  if (typeof payload.v !== "string" || payload.v.length < 43)
    throw new GoogleOAuthError("Status OAuth tidak valid.", "bad_state");
  return payload.v;
}

export function buildAuthorizationUrl(
  config: GoogleOAuthConfig,
  state: string,
  codeChallenge: string,
) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: "offline",
    // Always ask again so Google returns a refresh token on reconnect.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** Stored (encrypted) in app_user_connections.connection_key_ciphertext. */
export type StoredGoogleTokens = {
  v: 1;
  refresh_token: string;
  access_token?: string;
  /** epoch ms */
  expires_at?: number;
  scope?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postForm(url: string, body: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  return { ok: res.ok, status: res.status, json };
}

export async function exchangeAuthorizationCode(
  config: GoogleOAuthConfig,
  code: string,
  verifier: string,
  opts: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<StoredGoogleTokens> {
  const { ok, status, json } = await postForm(
    GOOGLE_TOKEN_URL,
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    },
    opts.fetchImpl ?? fetch,
  );
  if (!ok || !json.access_token)
    throw new GoogleOAuthError(
      `Penukaran kode Google gagal [${status}]${json.error ? `: ${json.error}` : ""}`,
      json.error,
    );
  if (!json.refresh_token)
    throw new GoogleOAuthError(
      "Google tidak mengirim refresh token. Cabut akses aplikasi di myaccount.google.com/permissions lalu hubungkan lagi.",
      "no_refresh_token",
    );
  if (json.scope && !json.scope.split(" ").includes(GOOGLE_CALENDAR_SCOPE))
    throw new GoogleOAuthError("Izin Google Calendar tidak diberikan.", "scope_denied");
  return {
    v: 1,
    refresh_token: json.refresh_token,
    access_token: json.access_token,
    expires_at: (opts.now ?? Date.now()) + (json.expires_in ?? 3600) * 1000,
    ...(json.scope ? { scope: json.scope } : {}),
  };
}

/** True when the cached access token is still valid for at least 60 s. */
export function accessTokenFresh(tokens: StoredGoogleTokens, now = Date.now()) {
  return Boolean(tokens.access_token && tokens.expires_at && tokens.expires_at - 60_000 > now);
}

/**
 * Refreshes the access token. Throws GoogleOAuthError with code `invalid_grant` when the user
 * revoked access (caller should delete the connection).
 */
export async function refreshAccessToken(
  config: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">,
  tokens: StoredGoogleTokens,
  opts: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<StoredGoogleTokens> {
  const { ok, status, json } = await postForm(
    GOOGLE_TOKEN_URL,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    },
    opts.fetchImpl ?? fetch,
  );
  if (!ok || !json.access_token)
    throw new GoogleOAuthError(`Refresh token Google gagal [${status}]`, json.error);
  return {
    ...tokens,
    access_token: json.access_token,
    expires_at: (opts.now ?? Date.now()) + (json.expires_in ?? 3600) * 1000,
    ...(json.refresh_token ? { refresh_token: json.refresh_token } : {}),
  };
}

/** Best-effort revoke (disconnect). Returns false when Google rejected the call. */
export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch) {
  try {
    const res = await fetchImpl(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function parseStoredTokens(raw: string): StoredGoogleTokens | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredGoogleTokens>;
    if (value?.v !== 1 || typeof value.refresh_token !== "string" || !value.refresh_token)
      return null;
    return value as StoredGoogleTokens;
  } catch {
    return null;
  }
}

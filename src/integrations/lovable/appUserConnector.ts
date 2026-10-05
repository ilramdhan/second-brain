function requireApiKey() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Koneksi Google belum dikonfigurasi.");
  return key;
}

export async function authorizeAppUserOAuth(params: { connectorId: string; appUserId: string; clientAPIKey: string; returnUrl: string; connectionAPIKey?: string; scopes: string[] }) {
  const headers: Record<string, string> = { Authorization: `Bearer ${requireApiKey()}`, "Content-Type": "application/json", "X-Client-Api-Key": params.clientAPIKey };
  if (params.connectionAPIKey) headers["X-Connection-Api-Key"] = params.connectionAPIKey;
  const response = await fetch("https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/authorize", { method: "POST", headers, body: JSON.stringify({ connector_id: params.connectorId, app_user_id: params.appUserId, return_url: params.returnUrl, credentials_configuration: { scopes: params.scopes } }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google OAuth gagal [${response.status}]: ${text}`);
  const body = JSON.parse(text) as { authorization_url?: string };
  if (!body.authorization_url) throw new Error("URL otorisasi Google tidak tersedia.");
  return { authorizationUrl: body.authorization_url };
}

export async function exchangeAppUserOAuthCode(code: string) {
  const response = await fetch("https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/exchange", { method: "POST", headers: { Authorization: `Bearer ${requireApiKey()}`, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Penyelesaian Google OAuth gagal [${response.status}]: ${text}`);
  const body = JSON.parse(text) as { api_key?: string; connector_id?: string };
  if (!body.api_key || body.connector_id !== "google_calendar") throw new Error("Kredensial Google Calendar tidak valid.");
  return body.api_key;
}

export async function callAsAppUser(connectionAPIKey: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${requireApiKey()}`);
  headers.set("X-Connection-Api-Key", connectionAPIKey);
  headers.set("X-Lovable-Required-Scopes", "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/calendar.events");
  return fetch(`https://connector-gateway.lovable.dev/google_calendar${path}`, { ...init, headers });
}

export async function disconnectAppUser(connectionAPIKey: string) {
  const response = await fetch("https://connector-gateway.lovable.dev/api/v1/app-users/connection", { method: "DELETE", headers: { Authorization: `Bearer ${requireApiKey()}`, "X-Connection-Api-Key": connectionAPIKey, "Content-Type": "application/json" }, body: JSON.stringify({ connector_id: "google_calendar" }) });
  if (!response.ok) throw new Error(`Google Calendar gagal diputus [${response.status}]: ${await response.text()}`);
}
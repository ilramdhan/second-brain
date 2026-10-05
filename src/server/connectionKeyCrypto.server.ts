function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function getKey() {
  const secret = process.env["APP_USER_CONNECTION_KEY_SECRET"];
  if (!secret) throw new Error("Kunci enkripsi koneksi tidak tersedia.");
  return crypto.subtle.importKey("raw", base64ToBytes(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptConnectionKey(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(), new TextEncoder().encode(value)));
  const stored = new Uint8Array(iv.length + encrypted.length); stored.set(iv); stored.set(encrypted, iv.length);
  return bytesToBase64(stored);
}

export async function decryptConnectionKey(value: string) {
  const stored = base64ToBytes(value); const iv = stored.slice(0, 12); const encrypted = stored.slice(12);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await getKey(), encrypted));
}
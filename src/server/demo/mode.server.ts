// Server-side demo switch (Phase 10). `APP_MODE=demo` turns the deployment into the public demo:
// integrations that reach real people or third parties (Telegram, Google Calendar, outgoing
// webhooks, n8n endpoints) are refused here, on the server, so a crafted request cannot bypass
// the disabled UI. Row limits and the write quota live in the database (migration 0019).
export const DEMO_DISABLED_MESSAGE = "Tidak tersedia di demo";

type Env = Record<string, string | undefined>;

const processEnv = (): Env => (typeof process !== "undefined" ? (process.env as Env) : {});
const isDemoValue = (value: string | undefined) => value?.trim().toLowerCase() === "demo";

let warnedMismatch = false;

/**
 * True when the server runs as the demo. `APP_MODE` is authoritative; `VITE_APP_MODE` (the
 * client build flag) is only compared to warn once about a half-configured deployment, where
 * the UI and the server would disagree.
 */
export function isDemoMode(env: Env = processEnv()): boolean {
  const server = isDemoValue(env["APP_MODE"]);
  // On Vercel both are project env vars, so the runtime env carries the build flag as well.
  const clientRaw = env["VITE_APP_MODE"];
  if (server !== isDemoValue(clientRaw) && !warnedMismatch) {
    warnedMismatch = true;
    console.warn(
      `[demo] APP_MODE (${env["APP_MODE"] ?? "unset"}) and VITE_APP_MODE ` +
        `(${clientRaw ?? "unset"}) disagree; set both to "demo" on the demo ` +
        "deployment and leave both unset elsewhere.",
    );
  }
  return server;
}

/** Thrown when a feature that is switched off in the demo is called anyway. */
export class DemoDisabledError extends Error {
  constructor(readonly feature: string) {
    super(`${DEMO_DISABLED_MESSAGE}: ${feature}.`);
    this.name = "DemoDisabledError";
  }
}

/** Throws {@link DemoDisabledError} in demo mode; a no-op everywhere else. */
export function assertNotDemo(feature: string, env?: Env): void {
  if (isDemoMode(env)) throw new DemoDisabledError(feature);
}

/** Test helper: lets the mismatch warning fire again. */
export function resetDemoModeWarning(): void {
  warnedMismatch = false;
}

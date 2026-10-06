import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (e2e/). See CONTRIBUTING.md → "End-to-end tests".
 *
 * - `E2E_BASE_URL` set: tests run against that deployment (e.g. a Vercel preview) and no local
 *   server is started.
 * - Otherwise a production build with the `node-server` Nitro preset is started on port 3100
 *   (`NITRO_PRESET=node-server bun run build` must have run first; CI does this).
 *
 * `VERCEL_AUTOMATION_BYPASS_SECRET` (optional) is sent as `x-vercel-protection-bypass` so
 * protected Vercel previews can be tested.
 */
const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const externalUrl = process.env["E2E_BASE_URL"];
const baseURL = externalUrl || `http://127.0.0.1:${PORT}`;
const bypass = process.env["VERCEL_AUTOMATION_BYPASS_SECRET"];
const isCI = !!process.env["CI"];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  ...(isCI ? { workers: 2 } : {}),
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    ...(bypass
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": bypass,
            // Also sets the bypass cookie so client-side navigations and assets pass.
            "x-vercel-set-bypass-cookie": "true",
          },
        }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(externalUrl
    ? {}
    : {
        webServer: {
          command: "node .output/server/index.mjs",
          url: `${baseURL}/login`,
          env: { PORT: String(PORT), HOST: "127.0.0.1", NITRO_PORT: String(PORT) },
          reuseExistingServer: !isCI,
          timeout: 60_000,
          stdout: "pipe",
        },
      }),
});

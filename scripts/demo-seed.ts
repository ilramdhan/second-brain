#!/usr/bin/env bun
// Optional CLI for the demo reset (Phase 10, docs/DEMO.md). The usual first seed is a single
// `curl` to /api/public/n8n/demo/reset; this script does the same from a local checkout, e.g. to
// re-seed after changing src/server/demo/seed-data.ts without deploying.
//
//   APP_MODE=demo SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… bun scripts/demo-seed.ts
//
// Optional: DEMO_EMAIL / DEMO_PASSWORD (default demo@ilramdhan.dev / demo2ndbrain) and
// APP_TIMEZONE (default Asia/Jakarta). Bun resolves the `@/` path alias from tsconfig.json.
// It refuses to run without APP_MODE=demo so it can never wipe a production account by accident:
// the reset hard-deletes everything the demo account owns.
import { isDemoMode } from "@/server/demo/mode.server";
import { resetDemo } from "@/server/demo/seed.server";

if (!isDemoMode()) {
  console.error("Refusing to run: set APP_MODE=demo and point SUPABASE_URL at the demo project.");
  process.exit(1);
}

try {
  const result = await resetDemo();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("Demo seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}

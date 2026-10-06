// Demo account provisioning and the daily reset (Phase 10). Runs only with the service role
// (supabaseAdmin), which bypasses RLS and the demo limit triggers of migration 0019.
//
// ensureDemoUser(): creates the shared demo account (and two teammate accounts shown as project
//   members) if missing, then turns demo mode on in the database (`app_config`). Order matters:
//   once `demo_mode = 'on'` and `demo_user_email` are set, the auth.users trigger refuses every
//   password/email change and delete of that account, even through the admin API. So the user is
//   created first and an existing user's password is never touched (rotate it as described in
//   docs/DEMO.md: demo_mode off → change → on).
// resetDemo(): HARD-deletes everything the demo accounts own (soft-deleted rows would still count
//   toward the row limits), resets the profile and inserts the seed from seed-data.ts with dates
//   relative to today in APP_TIMEZONE. Idempotent: running it twice gives the same data.
import { randomBytes } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEMO_EMBEDDING_MODEL, hashEmbedding } from "@/lib/semantic";
import { syncSemanticIndex, type SemanticClient } from "@/server/semantic.server";
import { appTimezone, zonedIsoDate } from "@/server/n8n/time.server";

import {
  buildDemoSeed,
  DEMO_DISPLAY_NAME,
  DEMO_SEED_INSERT_ORDER,
  DEMO_TEAMMATES,
  type DemoSeed,
  type DemoTeammateKey,
} from "./seed-data";

export const DEFAULT_DEMO_EMAIL = "demo@ilramdhan.dev";
export const DEFAULT_DEMO_PASSWORD = "demo2ndbrain";

type Env = Record<string, string | undefined>;

/** Demo login from DEMO_EMAIL/DEMO_PASSWORD, else the public VITE_* values, else the defaults. */
export function demoAccountFromEnv(env: Env = process.env) {
  const pick = (...keys: string[]) => keys.map((k) => env[k]?.trim()).find(Boolean);
  return {
    email: (pick("DEMO_EMAIL", "VITE_DEMO_EMAIL") ?? DEFAULT_DEMO_EMAIL).toLowerCase(),
    password: pick("DEMO_PASSWORD", "VITE_DEMO_PASSWORD") ?? DEFAULT_DEMO_PASSWORD,
  };
}

/** Tables with a `user_id` column, deleted children first (FK order). */
const USER_TABLES = [
  "canvas_edges",
  "canvas_nodes",
  "canvas_boards",
  "automation_runs",
  "automations",
  "templates",
  "inbox_items",
  "note_versions",
  "semantic_documents",
  "time_entries",
  "task_comments",
  "task_dependencies",
  "notes",
  "tasks",
  "milestones",
  "project_members",
  "projects",
  "calendar_connections",
  "app_user_connections",
  "telegram_link_codes",
  "rate_limits",
  "n8n_events",
] as const;

const CHUNK = 500;

async function findUserIdByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`demo: listing users failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function createUser(email: string, password: string, name: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) {
    // Created by a concurrent reset in the meantime.
    const existing = await findUserIdByEmail(email);
    if (existing) return existing;
    throw new Error(`demo: creating ${email} failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function setConfig(rows: { key: string; value: string }[]) {
  const { error } = await supabaseAdmin.from("app_config").upsert(rows, { onConflict: "key" });
  if (error) throw new Error(`demo: writing app_config failed: ${error.message}`);
}

export type DemoUsers = {
  userId: string;
  email: string;
  created: boolean;
  teammates: Partial<Record<DemoTeammateKey, string>>;
};

/**
 * Makes sure the demo account exists, then switches demo mode on in the database. The teammate
 * accounts are optional: when one cannot be created the seed simply has no project members.
 */
export async function ensureDemoUser(env: Env = process.env): Promise<DemoUsers> {
  const { email, password } = demoAccountFromEnv(env);
  let userId = await findUserIdByEmail(email);
  const created = !userId;
  // Never update an existing user's password here: with demo mode on the trigger would reject it.
  if (!userId) userId = await createUser(email, password, DEMO_DISPLAY_NAME);

  const teammates: Partial<Record<DemoTeammateKey, string>> = {};
  for (const mate of DEMO_TEAMMATES) {
    try {
      teammates[mate.key] =
        (await findUserIdByEmail(mate.email)) ??
        // Never signs in: random password, no deliverable mailbox (example.com).
        (await createUser(mate.email, randomBytes(24).toString("base64url"), mate.name));
    } catch (error) {
      console.warn(
        `[demo] teammate ${mate.key} skipped:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Only now: from here on the account is protected (migration 0019).
  await setConfig([
    { key: "demo_user_email", value: email },
    { key: "demo_mode", value: "on" },
  ]);
  return { userId, email, created, teammates };
}

async function deleteRows(table: string, column: string, ids: string[]) {
  // The typed client only knows literal table names; this helper is generic over USER_TABLES.
  const { error } = await (
    supabaseAdmin.from(table as "tasks").delete() as unknown as {
      in: (c: string, v: string[]) => Promise<{ error: { message: string } | null }>;
    }
  ).in(column, ids);
  if (error) throw new Error(`demo reset: deleting ${table} failed: ${error.message}`);
}

async function insertRows(table: string, rows: readonly object[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabaseAdmin
      .from(table as "tasks")
      .upsert(rows.slice(i, i + CHUNK) as never, { onConflict: "id" });
    if (error) throw new Error(`demo reset: inserting ${table} failed: ${error.message}`);
  }
}

/** Hard-deletes every row the demo accounts own, children first. */
export async function wipeDemoData(userIds: string[]) {
  await deleteRows("project_invites", "invited_by", userIds);
  for (const table of USER_TABLES) await deleteRows(table, "user_id", userIds);
}

export type DemoResetResult = {
  ok: true;
  user_id: string;
  created_user: boolean;
  today: string;
  inserted: Record<string, number>;
  ms: number;
};

/** Ensures the demo account, wipes its data and inserts a fresh seed for today. */
export async function resetDemo(opts: { now?: Date; env?: Env } = {}): Promise<DemoResetResult> {
  const started = Date.now();
  const env = opts.env ?? process.env;
  const users = await ensureDemoUser(env);
  const tz = appTimezone(env);
  const today = zonedIsoDate(opts.now ?? new Date(), tz);
  const seed: DemoSeed = buildDemoSeed({
    userId: users.userId,
    today,
    tz,
    teammates: users.teammates,
  });
  const allIds = [users.userId, ...Object.values(users.teammates)];

  await wipeDemoData(allIds);

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert({ id: users.userId, ...seed.profile }, { onConflict: "id" });
  if (profileError) throw new Error(`demo reset: profile failed: ${profileError.message}`);

  const inserted: Record<string, number> = {};
  for (const table of DEMO_SEED_INSERT_ORDER) {
    // The audit trigger logged every delete and insert above; replace that noise with the
    // curated history right before inserting it.
    if (table === "activity_logs") await deleteRows("activity_logs", "user_id", allIds);
    await insertRows(table, seed[table]);
    inserted[table] = seed[table].length;
  }

  // Semantic search index for the seed: the deterministic hashed bag-of-words embedding (no AI
  // provider, no key), the same one aiEmbed() uses in demo mode, so search works right after
  // the reset.
  let embedded = 0;
  for (const id of allIds) {
    const result = await syncSemanticIndex(supabaseAdmin as unknown as SemanticClient, {
      userId: id,
      batches: 20,
      model: DEMO_EMBEDDING_MODEL,
      embed: async (texts) => texts.map(hashEmbedding),
    });
    embedded += result.embedded;
  }
  inserted["semantic_documents"] = embedded;

  return {
    ok: true,
    user_id: users.userId,
    created_user: users.created,
    today,
    inserted,
    ms: Date.now() - started,
  };
}

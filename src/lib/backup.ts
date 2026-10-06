// Backup file validation for Settings → "Pulihkan JSON" (ANALYSIS S12, plan item 1.8).
//
// A backup file is untrusted input: it may have been edited by hand or crafted. Every table has
// an explicit zod schema; unknown columns are dropped, `user_id` is forced to the current user and
// sizes are capped. The restore itself (settings.tsx) additionally never updates a row it does
// not own (see `planUpserts`).
import { z } from "zod";

import { withNoteIndex } from "@/lib/blocks";

export const BACKUP_TABLES = [
  "projects",
  "tasks",
  "notes",
  "milestones",
  "task_dependencies",
  "automations",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS_PER_TABLE = 10_000;

const uuid = z.guid();
// Accept any string Date can parse (Postgres returns "2026-01-01T00:00:00.123456+00:00").
const dateish = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), { error: "Tanggal tidak valid" });
const ts = dateish;
const optTs = ts.nullish();
const optDate = dateish.nullish();
const str = (max: number) => z.string().max(max);
const optStr = (max: number) => z.string().max(max).nullish();
const tags = z.array(z.string().max(100)).max(100);
const json = z.unknown().refine((v) => JSON.stringify(v ?? null).length <= 1_000_000, {
  error: "JSON terlalu besar",
});

// `.strip()` (zod default) drops unknown keys, e.g. columns added by a tampered file.
const schemas = {
  projects: z.object({
    id: uuid,
    name: str(300),
    description: optStr(20_000),
    color: str(50).optional(),
    status: str(50).optional(),
    para_type: str(50).optional(),
    parent_id: uuid.nullish(),
    position: z.number().finite().optional(),
    start_date: optDate,
    due_date: optDate,
    launch_date: optDate,
    created_at: ts.optional(),
    updated_at: ts.optional(),
    deleted_at: optTs,
  }),
  tasks: z.object({
    id: uuid,
    title: str(1000),
    description: optStr(50_000),
    status: str(50).optional(),
    priority: str(50).optional(),
    project_id: uuid.nullish(),
    milestone_id: uuid.nullish(),
    parent_id: uuid.nullish(),
    assignee_id: uuid.nullish(),
    assignee_name: optStr(200),
    due_date: optDate,
    start_date: optDate,
    time_block_end: optDate,
    completed_at: optTs,
    estimate_minutes: z.number().int().min(0).max(1_000_000).optional(),
    position: z.number().finite().optional(),
    recurrence: optStr(200),
    reminded: z.boolean().optional(),
    tags: tags.optional(),
    created_at: ts.optional(),
    updated_at: ts.optional(),
    archived_at: optTs,
    deleted_at: optTs,
  }),
  notes: z.object({
    id: uuid,
    title: str(1000),
    content: str(500_000).optional(),
    blocks: json.optional(),
    properties: json.optional(),
    project_id: uuid.nullish(),
    pinned: z.boolean().optional(),
    position: z.number().finite().optional(),
    status: str(50).optional(),
    tags: tags.optional(),
    created_at: ts.optional(),
    updated_at: ts.optional(),
    archived_at: optTs,
    deleted_at: optTs,
  }),
  milestones: z.object({
    id: uuid,
    project_id: uuid,
    title: str(500),
    description: optStr(20_000),
    done: z.boolean().optional(),
    due_date: optDate,
    created_at: ts.optional(),
  }),
  task_dependencies: z.object({
    id: uuid,
    blocker_id: uuid,
    blocked_id: uuid,
    created_at: ts.optional(),
  }),
  automations: z.object({
    id: uuid,
    name: str(300),
    enabled: z.boolean().optional(),
    trigger: json.optional(),
    conditions: json.optional(),
    actions: json.optional(),
    // Scheduled rules (migration 0023). `next_run_at` is not restored: the rule runs again once
    // it is saved (or toggled) in /automations, which revalidates the cron.
    schedule_cron: str(120).nullish(),
    schedule_tz: str(64).nullish(),
    created_at: ts.optional(),
  }),
} satisfies Record<BackupTable, z.ZodType>;

export type BackupRow = Record<string, unknown> & { id: string; user_id: string };
export type PreparedBackup = Record<BackupTable, BackupRow[]>;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/**
 * Picks the restorable envelope from either format:
 * - Settings export `{version: 1, exported_at, tables}`
 * - n8n / server backup `{version: 1, format: "second-brain-backup", users: [{user_id, tables}]}`
 *   (only the entry of `userId` is used; with a single entry it is used regardless of id so a
 *   backup can be restored into a new account)
 */
export function selectBackupEnvelope(input: unknown, userId: string): unknown {
  if (!input || typeof input !== "object" || !("users" in input)) return input;
  const users = (input as { users: unknown }).users;
  if (!Array.isArray(users)) throw new BackupError("Format backup tidak dikenali");
  const mine = users.find((u) => (u as { user_id?: unknown })?.user_id === userId);
  const entry = mine ?? (users.length === 1 ? users[0] : undefined);
  if (!entry)
    throw new BackupError("Backup ini tidak berisi data akun Anda (pilih file backup per akun)");
  return entry;
}

/**
 * Validates a parsed backup file and returns sanitized rows per table with
 * `user_id = userId`. Throws `BackupError` (Indonesian message) on the first invalid row.
 */
export function prepareBackup(input: unknown, userId: string): PreparedBackup {
  const envelope = z
    .object({ version: z.literal(1), tables: z.record(z.string(), z.unknown()) })
    .safeParse(selectBackupEnvelope(input, userId));
  if (!envelope.success) throw new BackupError("Format backup tidak dikenali");

  const out = {} as PreparedBackup;
  for (const table of BACKUP_TABLES) {
    const raw = envelope.data.tables[table];
    if (raw === undefined) {
      out[table] = [];
      continue;
    }
    if (!Array.isArray(raw)) throw new BackupError(`Tabel ${table} tidak valid`);
    if (raw.length > MAX_ROWS_PER_TABLE)
      throw new BackupError(`Tabel ${table} terlalu besar (maks ${MAX_ROWS_PER_TABLE} baris)`);
    const seen = new Set<string>();
    out[table] = raw.map((row, i) => {
      const parsed = schemas[table].safeParse(row);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join(".") || "baris";
        throw new BackupError(`Baris ${i + 1} di ${table} tidak valid (${field})`);
      }
      const clean = parsed.data as Record<string, unknown> & { id: string };
      if (seen.has(clean.id)) throw new BackupError(`ID ganda di ${table}: ${clean.id}`);
      seen.add(clean.id);
      // Notes: recompute the link index and excerpt (never trusted from the file, migration 0018).
      const indexed =
        table === "notes" ? { ...clean, ...withNoteIndex(clean as { content?: string }) } : clean;
      return { ...indexed, user_id: userId };
    });
  }
  return out;
}

/**
 * Splits rows into updates (ids that already exist and belong to the current user) and inserts
 * (ids not visible to the user). Rows whose id belongs to someone else (e.g. a shared project
 * row) are skipped so a restore never overwrites another person's data. Inserts must be sent
 * with ON CONFLICT DO NOTHING so ids hidden by RLS are skipped as well.
 */
export function planUpserts(
  rows: BackupRow[],
  existing: { id: string; user_id: string }[],
  userId: string,
): { update: BackupRow[]; insert: BackupRow[]; skipped: number } {
  const owner = new Map(existing.map((r) => [r.id, r.user_id]));
  const update: BackupRow[] = [];
  const insert: BackupRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    const o = owner.get(row.id);
    if (o === undefined) insert.push(row);
    else if (o === userId) update.push(row);
    else skipped++;
  }
  return { update, insert, skipped };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

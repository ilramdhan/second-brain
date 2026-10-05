// GET /api/public/n8n/backup — JSON export per user in the same format as Settings → "Unduh
// backup" (src/lib/backup.ts), so each user entry can be restored with "Pulihkan JSON".
// Extra tables (inbox, comments, templates, …) are included for disaster recovery; the Settings
// restore ignores tables it does not know. Secrets (app_user_connections, app_config,
// telegram_link_codes, n8n_events) are never exported.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BACKUP_TABLES } from "@/lib/backup";

export const EXTRA_BACKUP_TABLES = [
  "inbox_items",
  "task_comments",
  "templates",
  "time_entries",
  "canvas_boards",
] as const;
type ExportTable =
  (typeof BACKUP_TABLES)[number] | (typeof EXTRA_BACKUP_TABLES)[number] | "note_versions";

const SOFT_DELETE = new Set<ExportTable>(["projects", "tasks", "notes"]);
const ARCHIVE = new Set<ExportTable>(["tasks", "notes"]);
const PAGE = 1000; // PostgREST max rows per request on Supabase

async function exportTable(table: ExportTable, userId: string, includeAll: boolean) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin.from(table).select("*").eq("user_id", userId);
    if (!includeAll && SOFT_DELETE.has(table)) query = query.is("deleted_at", null);
    if (!includeAll && ARCHIVE.has(table)) query = query.is("archived_at", null);
    const { data, error } = await query.order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`export ${table} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export type UserBackup = {
  version: 1;
  exported_at: string;
  user_id: string;
  email: string | null;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
};

export async function exportUser(
  userId: string,
  email: string | null,
  opts: { includeAll: boolean; versions: boolean },
): Promise<UserBackup> {
  const tables: Record<string, unknown[]> = {};
  const list: ExportTable[] = [...BACKUP_TABLES, ...EXTRA_BACKUP_TABLES];
  if (opts.versions) list.push("note_versions");
  for (const table of list) tables[table] = await exportTable(table, userId, opts.includeAll);
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    user_id: userId,
    email,
    tables,
    counts,
  };
}

/** Users page (auth admin API, newest-first is not guaranteed; stable per page). */
export async function listUsersPage(page: number, perPage: number) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: page + 1, perPage });
  if (error) throw new Error(`list users failed: ${error.message}`);
  return data.users.map((u) => ({ id: u.id, email: u.email ?? null }));
}

export async function userEmail(userId: string) {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data.user ? (data.user.email ?? null) : undefined;
}

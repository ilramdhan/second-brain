// Project member invites (server side of `inviteProjectMember` / `listProjectInvites`).
//
// Flow: the project owner enters an email. The invite row (`project_invites`) is written with the
// owner's RLS client, so the `invites_owner_manage` policy is a second ownership check. When no
// account exists for the email, Supabase Auth creates one and sends its "Invite user" email
// (`auth.admin.inviteUserByEmail`), whose link opens /auth/set-password. When the account already
// exists, the invite is simply kept: `accept_project_invites()` turns it into a membership the
// next time that person signs in. The owner gets the same answer in both cases, so the form cannot
// be used to find out which emails have an account.
//
// The service-role client is used for exactly two things, both scoped to a project the caller was
// already shown by RLS: one `inviteUserByEmail` call for the validated email, and reading that
// project's pending invites for members (RLS only lets the owner read `project_invites`).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { SET_PASSWORD_PATH } from "@/lib/password";
import { assertNotDemo } from "@/server/demo/mode.server";
import { enforceRateLimit, MEMBER_INVITE_RATE_LIMIT } from "@/server/rateLimit.server";

type Db = SupabaseClient<Database>;
type Env = Record<string, string | undefined>;

export const OWNER_ONLY_MESSAGE = "Hanya pemilik proyek yang bisa mengundang anggota.";
export const PROJECT_NOT_FOUND_MESSAGE = "Proyek tidak ditemukan.";

export type InviteResult = {
  /** `member`: the email already belongs to the owner or a member; nothing was changed. */
  status: "invited" | "member";
  /**
   * Set when the invite was saved but Supabase could not send the email (default SMTP limit,
   * SMTP misconfigured). The owner can press "Kirim ulang" later.
   */
  emailError?: "rate_limited" | "failed";
};

export type PendingInvite = { id: string; email: string; created_at: string };

/** Absolute /auth/set-password URL: APP_URL when set, else the request origin. */
export function setPasswordRedirect(env: Env, requestOrigin?: string): string | undefined {
  const base = env["APP_URL"]?.trim() || requestOrigin;
  if (!base) return undefined;
  try {
    const url = new URL(SET_PASSWORD_PATH, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The project as RLS shows it to the caller (owner or member), or null. */
async function visibleProject(db: Db, projectId: string) {
  const { data, error } = await db
    .from("projects")
    .select("id,user_id,name")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("Gagal memuat proyek.");
  return data;
}

type AdminAuth = Pick<Db["auth"]["admin"], "inviteUserByEmail">;

/** True for the GoTrue answer "a user with this email address has already been registered". */
function isExistingUserError(error: {
  code?: string | undefined;
  status?: number | undefined;
  message?: string | undefined;
}) {
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    /already (been )?registered|already exists/i.test(error.message ?? "")
  );
}

export async function inviteMember(args: {
  db: Db;
  admin: AdminAuth;
  userId: string;
  projectId: string;
  email: string;
  redirectTo: string | undefined;
  env?: Env;
}): Promise<InviteResult> {
  const { db, admin, userId, projectId, email, redirectTo, env } = args;
  // The public demo shares one account: inviting would email real people. The database limit for
  // project_invites is 0 there as well (migration 0019).
  assertNotDemo("Undang anggota", env);
  // Every call may send an email, and the default Supabase SMTP allows only a few per hour.
  await enforceRateLimit(db, MEMBER_INVITE_RATE_LIMIT);

  const project = await visibleProject(db, projectId);
  if (!project) throw new Error(PROJECT_NOT_FOUND_MESSAGE);
  if (project.user_id !== userId) throw new Error(OWNER_ONLY_MESSAGE);

  // Already the owner or a member: the owner sees these emails in the team list anyway.
  const { data: people } = await db.rpc("list_project_people", { _project_id: projectId });
  if ((people ?? []).some((p) => p.email?.toLowerCase() === email)) return { status: "member" };

  // Keep an existing invite (resend), create it otherwise. ON CONFLICT DO NOTHING as the owner.
  const { error: insertError } = await db
    .from("project_invites")
    .upsert(
      { project_id: projectId, email, invited_by: userId },
      { onConflict: "project_id,email", ignoreDuplicates: true },
    );
  if (insertError) {
    console.error("project invite insert failed:", insertError.code);
    throw new Error("Gagal menyimpan undangan.");
  }

  // New address: Supabase creates the account and sends the invite email. An unconfirmed account
  // from an earlier invite gets a fresh email; a confirmed one answers "already registered".
  const { error } = await admin.inviteUserByEmail(email, {
    ...(redirectTo ? { redirectTo } : {}),
    data: { invited_project_id: projectId, invited_project_name: project.name.slice(0, 120) },
  });
  if (!error || isExistingUserError(error)) return { status: "invited" };
  if (error.status === 429 || error.code === "over_email_send_rate_limit") {
    return { status: "invited", emailError: "rate_limited" };
  }
  // Never log the address itself.
  console.error("inviteUserByEmail failed:", error.code ?? error.status ?? "unknown");
  return { status: "invited", emailError: "failed" };
}

/**
 * Pending invites of a project for its owner and members. The project lookup runs with the
 * caller's RLS client, so outsiders get an error before the service-role query, which is scoped
 * to that one project.
 */
export async function listInvites(args: {
  db: Db;
  admin: Db;
  projectId: string;
}): Promise<PendingInvite[]> {
  const project = await visibleProject(args.db, args.projectId);
  if (!project) throw new Error(PROJECT_NOT_FOUND_MESSAGE);
  const { data, error } = await args.admin
    .from("project_invites")
    .select("id,email,created_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error("Gagal memuat undangan.");
  return data ?? [];
}

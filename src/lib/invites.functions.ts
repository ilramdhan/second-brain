import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_EMAIL_LENGTH } from "@/lib/password";

function requestOrigin() {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return undefined;
  }
}

export const inviteMemberInput = z.object({
  projectId: z.string().uuid(),
  email: z.string().trim().toLowerCase().max(MAX_EMAIL_LENGTH).pipe(z.email()),
});

/**
 * Invites `email` to a project (owner only). Saves the `project_invites` row and, for an address
 * without an account, has Supabase Auth email an invite link to /auth/set-password. The answer is
 * the same whether or not the address already has an account.
 */
export const inviteProjectMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(inviteMemberInput)
  .handler(async ({ data, context }) => {
    const { assertNotDemo } = await import("@/server/demo/mode.server");
    assertNotDemo("Undang anggota");
    const { inviteMember, setPasswordRedirect } = await import("@/server/invites.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return inviteMember({
      db: context.supabase,
      admin: supabaseAdmin.auth.admin,
      userId: context.userId,
      projectId: data.projectId,
      email: data.email,
      redirectTo: setPasswordRedirect(process.env, requestOrigin()),
    });
  });

/** Pending invites of a project, for its owner and members ("menunggu" in the team tab). */
export const listProjectInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ projectId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { listInvites } = await import("@/server/invites.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return listInvites({ db: context.supabase, admin: supabaseAdmin, projectId: data.projectId });
  });

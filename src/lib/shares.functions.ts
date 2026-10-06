import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SHARE_EXPIRY_OPTIONS, expiryToTimestamp, type ShareRow } from "@/lib/share";

// Public read-only links (Phase 9.5, migration 0024). The token is generated and hashed here so
// the browser never chooses it and the database only ever sees the hash. Revoking, changing the
// expiry and listing go through the RLS client in src/features/shares.

export const SHARE_ROW_COLS =
  "id,resource_type,resource_id,created_at,expires_at,revoked_at,view_count,last_viewed_at,allow_indexing";

const resourceInput = z.object({
  resourceType: z.enum(["note", "project"]),
  resourceId: z.string().uuid(),
});

/**
 * Anonymous read for `/s/$token`. No auth middleware: the token is the credential. The result
 * is a sanitized DTO or `not_found` for every failure (src/server/publicShare.server.ts).
 */
// POST so the token travels in the body, not in a `/_serverFn/...?payload=` URL that ends up in
// access logs.
export const getPublicShare = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().max(128) }))
  .handler(async ({ data }) => {
    const { clientIp } = await import("@/server/demo/ipRateLimit.server");
    const { readPublicShare } = await import("@/server/publicShare.server");
    const result = await readPublicShare(data.token, clientIp(getRequest()));
    // The route turns `not_found` into a 404 (notFound()); the RPC itself always answers 200 so
    // client-side navigations get the result instead of a transport error.
    // Never cached by shared caches: revoking must take effect immediately.
    setResponseHeader("cache-control", "private, no-store");
    return result;
  });

/**
 * Creates the caller's link for a note or project, or rotates the token of their active one
 * (one active link per creator and resource). Returns the raw token once.
 */
export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    resourceInput.extend({
      expiry: z.enum(SHARE_EXPIRY_OPTIONS).default("never"),
    }),
  )
  .handler(async ({ data, context }) => {
    const { enforceRateLimit, SHARE_LINK_RATE_LIMIT } = await import("@/server/rateLimit.server");
    await enforceRateLimit(context.supabase, SHARE_LINK_RATE_LIMIT);
    const { generateShareToken, hashShareToken } = await import("@/server/publicShare.server");
    const token = generateShareToken();
    const token_hash = await hashShareToken(token);
    const expires_at = expiryToTimestamp(data.expiry);

    const { data: existing, error: findError } = await context.supabase
      .from("public_shares")
      .select("id")
      .eq("user_id", context.userId)
      .eq("resource_type", data.resourceType)
      .eq("resource_id", data.resourceId)
      .is("revoked_at", null)
      .maybeSingle();
    if (findError) throw findError;

    const query = existing
      ? context.supabase
          .from("public_shares")
          .update({ token_hash, expires_at })
          .eq("id", existing.id)
      : context.supabase.from("public_shares").insert({
          user_id: context.userId,
          resource_type: data.resourceType,
          resource_id: data.resourceId,
          token_hash,
          expires_at,
        });
    const { data: row, error } = await query.select(SHARE_ROW_COLS).single();
    if (error) throw error;
    return { token, share: row as ShareRow };
  });

/** New token for an existing active link; the old URL stops working at once. */
export const regenerateShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { enforceRateLimit, SHARE_LINK_RATE_LIMIT } = await import("@/server/rateLimit.server");
    await enforceRateLimit(context.supabase, SHARE_LINK_RATE_LIMIT);
    const { generateShareToken, hashShareToken } = await import("@/server/publicShare.server");
    const token = generateShareToken();
    const { data: row, error } = await context.supabase
      .from("public_shares")
      .update({ token_hash: await hashShareToken(token) })
      .eq("id", data.id)
      .is("revoked_at", null)
      .select(SHARE_ROW_COLS)
      .single();
    if (error) throw error;
    return { token, share: row as ShareRow };
  });

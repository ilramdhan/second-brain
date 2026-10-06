import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { SHARE_COLS, sharesQuery } from "@/features/shares/api";
import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";
import {
  expiryToTimestamp,
  type ShareExpiry,
  type ShareResourceType,
  type ShareRow,
} from "@/lib/share";
import { createShareLink, regenerateShareLink } from "@/lib/shares.functions";

export function useShares() {
  return useQuery(sharesQuery);
}

/** The caller's active link for one note or project, if any. */
export function useShareFor(resourceType: ShareResourceType, resourceId: string) {
  const query = useShares();
  const share =
    query.data?.find((s) => s.resource_type === resourceType && s.resource_id === resourceId) ??
    null;
  return { ...query, share };
}

/**
 * Whether the caller may publish this note/project (`can_share_resource`, migration 0024): the
 * note's creator or its project owner, the project's owner. Only asked when there is no link yet.
 */
export function useCanShare(resourceType: ShareResourceType, resourceId: string, enabled = true) {
  return useQuery({
    queryKey: [...qk.shares, "can", resourceType, resourceId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_share_resource", {
        _resource_type: resourceType,
        _resource_id: resourceId,
      });
      if (error) throw error;
      return data === true;
    },
  });
}

/**
 * Create, regenerate, re-time and revoke public links. Create/regenerate go through server
 * functions (the token is generated and hashed on the server and returned once); the rest are
 * RLS writes on the caller's own rows. Each write updates the `qk.shares` cache.
 */
export function useShareActions() {
  const qc = useQueryClient();
  const create = useServerFn(createShareLink);
  const regenerate = useServerFn(regenerateShareLink);

  const upsert = (row: ShareRow) =>
    qc.setQueryData<ShareRow[]>(qk.shares, (old) => [
      row,
      ...(old ?? []).filter((s) => s.id !== row.id),
    ]);
  const drop = (id: string) =>
    qc.setQueryData<ShareRow[]>(qk.shares, (old) => (old ?? []).filter((s) => s.id !== id));

  return {
    async create(resourceType: ShareResourceType, resourceId: string, expiry: ShareExpiry) {
      const result = await create({ data: { resourceType, resourceId, expiry } });
      upsert(result.share);
      return result;
    },
    async regenerate(id: string) {
      const result = await regenerate({ data: { id } });
      upsert(result.share);
      return result;
    },
    async setExpiry(id: string, expiry: ShareExpiry) {
      const { data, error } = await supabase
        .from("public_shares")
        .update({ expires_at: expiryToTimestamp(expiry) })
        .eq("id", id)
        .select(SHARE_COLS)
        .single();
      if (error) throw error;
      upsert(data);
      return data;
    },
    async revoke(id: string) {
      const { error } = await supabase
        .from("public_shares")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      drop(id);
    },
  };
}

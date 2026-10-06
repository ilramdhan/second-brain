import { queryOptions } from "@tanstack/react-query";

import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";
import type { ShareRow } from "@/lib/share";

/** Owner-visible columns of `public_shares` (never `token_hash`). */
export const SHARE_COLS =
  "id,resource_type,resource_id,created_at,expires_at,revoked_at,view_count,last_viewed_at,allow_indexing";

/** The caller's active (not revoked) public links; RLS returns only their own rows. */
export const sharesQuery = queryOptions({
  queryKey: qk.shares,
  queryFn: async (): Promise<ShareRow[]> => {
    const { data, error } = await supabase
      .from("public_shares")
      .select(SHARE_COLS)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});

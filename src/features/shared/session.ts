import { queryOptions, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export async function getUid() {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Sesi berakhir, silakan masuk lagi");
  return id;
}

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async () => (await supabase.auth.getSession()).data.session?.user ?? null,
  staleTime: Infinity,
});
export function useMe() {
  return useQuery(meQuery);
}

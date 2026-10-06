import { queryOptions } from "@tanstack/react-query";

import type { Person } from "@/features/projects/types";
import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";

export const PROJECT_COLS =
  "id,user_id,parent_id,name,description,color,para_type,status,start_date,due_date,launch_date,position,created_at,updated_at";

export const projectsQuery = queryOptions({
  queryKey: qk.projects,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLS)
      .is("deleted_at", null)
      .order("position")
      .order("name");
    if (error) throw error;
    return data;
  },
});

/** Owner and members of a project (`list_project_people` RPC). */
export async function fetchProjectPeople(projectId: string) {
  const { data, error } = await supabase.rpc("list_project_people", {
    _project_id: projectId,
  });
  if (error) throw error;
  return (data ?? []) as Person[];
}

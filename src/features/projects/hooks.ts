import { useQuery } from "@tanstack/react-query";

import { fetchProjectPeople, projectsQuery } from "@/features/projects/api";
import type { Project } from "@/features/projects/types";
import { useCrud } from "@/features/shared/crud";
import { qk } from "@/features/shared/query-keys";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export function useProjects() {
  return useQuery(projectsQuery);
}

export function usePeople(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["people", projectId],
    enabled: !!projectId,
    queryFn: () => fetchProjectPeople(projectId!),
  });
}

export const useProjectActions = () =>
  useCrud<Project, TablesInsert<"projects">, TablesUpdate<"projects">>("projects", qk.projects);

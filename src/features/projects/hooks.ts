import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { fetchProjectPeople, projectsQuery } from "@/features/projects/api";
import type { Project } from "@/features/projects/types";
import { useCrud } from "@/features/shared/crud";
import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { inviteProjectMember, listProjectInvites } from "@/lib/invites.functions";

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

/** Query key of a project's pending invites. */
export const invitesKey = (projectId: string | null | undefined) => ["invites", projectId] as const;

/**
 * Pending invites of a project ("menunggu"), for the owner and members. Served by the
 * `listProjectInvites` server function, because RLS lets only the owner read `project_invites`.
 */
export function useProjectInvites(projectId: string | null | undefined) {
  const list = useServerFn(listProjectInvites);
  return useQuery({
    queryKey: invitesKey(projectId),
    enabled: !!projectId,
    queryFn: () => list({ data: { projectId: projectId! } }),
  });
}

/**
 * Owner actions on invites: `invite` (also used to resend: the row is kept and Supabase sends a
 * fresh email when the account has not accepted yet) and `revoke` (deletes the row through RLS).
 */
export function useInviteActions(projectId: string) {
  const qc = useQueryClient();
  const send = useServerFn(inviteProjectMember);
  const refresh = () => qc.invalidateQueries({ queryKey: invitesKey(projectId) });
  const invite = useMutation({
    mutationFn: (email: string) => send({ data: { projectId, email } }),
    onSettled: refresh,
  });
  const revoke = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from("project_invites")
        .delete()
        .eq("id", inviteId)
        .eq("project_id", projectId);
      if (error) throw error;
    },
    onSettled: refresh,
  });
  return { invite, revoke };
}

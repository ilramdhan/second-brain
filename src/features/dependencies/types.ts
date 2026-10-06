import type { Tables } from "@/integrations/supabase/types";

export type Dependency = Pick<Tables<"task_dependencies">, "id" | "blocker_id" | "blocked_id">;

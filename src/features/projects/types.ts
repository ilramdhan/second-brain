import type { Tables } from "@/integrations/supabase/types";

export type Project = Omit<Tables<"projects">, "deleted_at">;
export type Person = { user_id: string; display_name: string | null; email: string; role: string };

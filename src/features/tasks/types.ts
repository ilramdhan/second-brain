import type { Tables } from "@/integrations/supabase/types";

export type Task = Omit<
  Tables<"tasks">,
  "deleted_at" | "archived_at" | "reminded" | "google_event_id" | "google_etag" | "google_synced_at"
>;

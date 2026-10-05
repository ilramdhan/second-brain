import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export async function logActivity(
  action: string,
  entityType: string,
  entityId?: string,
  metadata: Record<string, Json | undefined> = {},
  source = "app",
) {
  const safe = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  ) as Record<string, Json>;
  const args: {
    _action: string;
    _entity_type: string;
    _entity_id?: string;
    _metadata: Json;
    _source: string;
  } = {
    _action: action,
    _entity_type: entityType,
    _metadata: safe,
    _source: source,
  };
  if (entityId) args._entity_id = entityId;
  const { error } = await supabase.rpc("log_activity", args);
  if (error) console.error("Activity logging failed", error.message);
}

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TaskSnapshot } from "@/lib/automation-types";

const snapshot = z.object({
  status: z.string().nullish(),
  priority: z.string().nullish(),
  assignee_name: z.string().nullish(),
  assignee_id: z.string().nullish(),
  due_date: z.string().nullish(),
});

function requestOrigin() {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return null;
  }
}

export const runAutomations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        event: z.enum(["created", "updated"]),
        taskId: z.string().uuid(),
        before: snapshot.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { runAutomationRules } = await import("@/server/automationEngine.server");
    return runAutomationRules(
      context.supabase,
      context.userId,
      { event: data.event, taskId: data.taskId, before: data.before as TaskSnapshot | undefined },
      requestOrigin(),
    );
  });

/** Notifies the people on tasks that just became unblocked (Telegram, best-effort). */
export const notifyUnblocked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ taskIds: z.array(z.string().uuid()).max(50), blockerTitle: z.string().max(300) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: tasks } = await context.supabase
      .from("tasks")
      .select("id,title,user_id,assignee_id")
      .in("id", data.taskIds);
    if (!tasks?.length) return { sent: 0 };
    const recipients = [...new Set(tasks.flatMap((t) => [t.assignee_id ?? t.user_id]))];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id,telegram_chat_id")
      .in("id", recipients);
    const { sendTelegram } = await import("@/lib/telegram.server");
    let sent = 0;
    for (const t of tasks) {
      const chat = profs?.find((p) => p.id === (t.assignee_id ?? t.user_id))?.telegram_chat_id;
      if (!chat) continue;
      const err = await sendTelegram(
        chat,
        `🔓 "${t.title}" sudah bisa dikerjakan — "${data.blockerTitle}" selesai.`,
      );
      if (!err) sent++;
    }
    return { sent };
  });

// Note rule engine (Phase 9.4): `note_created`, `note_updated` and `note_tagged` rules. Called by
// `runAutomations` (browser, RLS client) after useNoteActions writes and by server-side note
// writers (inbox processing, n8n `createNote`) with the service-role client acting for `userId`.
// Every query is scoped to `userId`, and actions write directly, so they never trigger rules
// again (a tag added by a rule does not fire `note_tagged`, a task it creates runs no task rules).
import type { SupabaseClient } from "@supabase/supabase-js";

import { failureStep, serializeRunDetail, type RunStep } from "@/lib/automation-run-detail";
import type { Database, Tables } from "@/integrations/supabase/types";
import {
  addedTags,
  isNoteTrigger,
  NOTE_UPDATED_COOLDOWN_MS,
  type Condition,
  type NoteSnapshot,
  type Trigger,
} from "@/lib/automation-types";

import {
  appUrl,
  createTaskFromAction,
  fillTemplate,
  parseAction,
  projectAccessible,
  telegramToUser,
} from "./automationActions.server";

type Note = Pick<
  Tables<"notes">,
  "id" | "title" | "tags" | "project_id" | "excerpt" | "user_id" | "deleted_at" | "archived_at"
>;

export type NoteAutomationEvent = {
  event: "created" | "updated";
  noteId: string;
  /** Title/tags/project before an update (absent for created). */
  before?: NoteSnapshot | undefined;
};

/** Pure: does the trigger fire for this note event? */
export function noteTriggerMatches(
  t: Trigger,
  data: NoteAutomationEvent,
  note: Pick<Note, "tags">,
) {
  if (t.type === "note_created") return data.event === "created";
  if (t.type === "note_updated") return data.event === "updated";
  if (t.type !== "note_tagged") return false;
  // A created note "adds" every tag it starts with; an update needs the previous tags.
  if (data.event === "updated" && !data.before?.tags) return false;
  const added = addedTags(data.event === "created" ? [] : data.before?.tags, note.tags ?? []);
  if (!added.length) return false;
  const want = t.to?.replace(/^#/, "").trim().toLowerCase();
  return !want || added.includes(want);
}

/** Pure: tag / title / project conditions on a note (case-insensitive, trimmed). */
export function noteConditionMatches(
  c: Condition,
  note: Pick<Note, "tags" | "title" | "project_id">,
) {
  const v = c.value.trim().toLowerCase();
  if (c.field === "tag") {
    const tag = v.replace(/^#/, "");
    const tags = (note.tags ?? []).map((x) => x.toLowerCase());
    const has = c.op === "contains" ? tags.some((x) => x.includes(tag)) : tags.includes(tag);
    return c.op === "neq" ? !has : has;
  }
  if (c.field !== "title" && c.field !== "project_id") return false;
  const actual = String(note[c.field] ?? "").toLowerCase();
  if (c.op === "eq") return actual === v;
  if (c.op === "neq") return actual !== v;
  return actual.includes(v);
}

export async function runNoteAutomationRules(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: NoteAutomationEvent,
  origin: string | null,
  now = new Date(),
): Promise<{ ran: number; changed: boolean }> {
  const { data: rules } = await supabase
    .from("automations")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true);
  const noteRules = (rules ?? []).filter((r) =>
    isNoteTrigger((r.trigger as unknown as Trigger | null)?.type),
  );
  if (!noteRules.length) return { ran: 0, changed: false };
  const { data: found } = await supabase
    .from("notes")
    .select("id,title,tags,project_id,excerpt,user_id,deleted_at,archived_at")
    .eq("id", data.noteId)
    .maybeSingle();
  if (!found || found.deleted_at || found.archived_at) return { ran: 0, changed: false };
  let note: Note = found;
  // Triggers see the note as the user's write left it, never the result of earlier rules' actions
  // (a tag added by rule A must not fire rule B's note_tagged: actions never re-trigger rules).
  // Conditions see the current state, like the task engine.
  const atEvent: Note = found;

  const { isDemoMode } = await import("@/server/demo/mode.server");
  const demo = isDemoMode();
  const { appTimezone } = await import("@/server/n8n/time.server");
  const tz = appTimezone();
  let ran = 0;
  let changed = false;

  for (const rule of noteRules) {
    const trigger = rule.trigger as unknown as Trigger;
    const conditions = (rule.conditions as unknown as Condition[]) ?? [];
    if (!noteTriggerMatches(trigger, data, atEvent)) continue;
    if (!conditions.every((c) => noteConditionMatches(c, note))) continue;
    if (trigger.type === "note_updated") {
      // The editor autosaves every few seconds; fire at most once per note per cooldown.
      const since = new Date(now.getTime() - NOTE_UPDATED_COOLDOWN_MS).toISOString();
      const { data: recent } = await supabase
        .from("automation_runs")
        .select("id")
        .eq("automation_id", rule.id)
        .eq("note_id", note.id)
        .gte("created_at", since)
        .limit(1);
      if (recent?.length) continue;
    }

    let projectName = "";
    if (note.project_id) {
      const { data: p } = await supabase
        .from("projects")
        .select("name")
        .eq("id", note.project_id)
        .maybeSingle();
      projectName = p?.name ?? "";
    }
    const values = () => ({
      title: note.title,
      tags: (note.tags ?? []).map((t) => `#${t}`).join(" ") || "-",
      project: projectName || "-",
      rule: rule.name,
    });
    const noteUrl = appUrl(origin, `/notes/${note.id}`);

    const log: RunStep[] = [];
    let ok = true;
    for (const raw of (rule.actions as unknown[]) ?? []) {
      const a = parseAction(raw);
      try {
        if (!a) throw new Error("aksi tidak valid");
        if (a.type === "add_tag") {
          const tag = a.value.replace(/^#/, "").trim().toLowerCase();
          if (!tag) throw new Error("tag kosong");
          if ((note.tags ?? []).some((t) => t.toLowerCase() === tag)) {
            log.push({ code: "tagExists", params: { tag } });
            continue;
          }
          const tags = [...(note.tags ?? []), tag];
          const { error } = await supabase
            .from("notes")
            .update({ tags, updated_at: now.toISOString() })
            .eq("id", note.id);
          if (error) throw new Error(error.message);
          note = { ...note, tags };
          changed = true;
          log.push({ code: "addTag", params: { tag } });
        } else if (a.type === "link_project") {
          const project = await projectAccessible(supabase, userId, a.project_id);
          if (!project) throw new Error("Proyek tidak ditemukan");
          if (note.project_id === project.id) {
            log.push({ code: "alreadyInProject" });
            continue;
          }
          const { error } = await supabase
            .from("notes")
            .update({ project_id: project.id, updated_at: now.toISOString() })
            .eq("id", note.id);
          if (error) throw new Error(error.message);
          note = { ...note, project_id: project.id };
          projectName = project.name;
          changed = true;
          log.push({ code: "linkProject", params: { project: project.name } });
        } else if (a.type === "create_task") {
          const task = await createTaskFromAction(supabase, userId, a, {
            values: values(),
            tz,
            now,
            projectId: note.project_id,
            description: noteUrl ? `Dari catatan: ${noteUrl}` : `Dari catatan "${note.title}"`,
          });
          changed = true;
          log.push({ code: "createTask", params: { title: task.title } });
        } else if ((a.type === "telegram" || a.type === "webhook") && demo) {
          log.push({ code: "skippedDemo", params: { channel: a.type } });
        } else if (a.type === "telegram") {
          await telegramToUser(supabase, userId, fillTemplate(a.text, values()));
          log.push({ code: "telegram" });
        } else if (a.type === "webhook") {
          const { safeWebhookPost } = await import("@/server/ssrf.server");
          const text = `[${rule.name}] Catatan "${note.title}"`;
          // Minimal payload: no note body, owner or member ids.
          await safeWebhookPost(a.url, {
            text,
            content: text,
            rule: rule.name,
            event: trigger.type,
            project: projectName,
            note: {
              id: note.id,
              title: note.title,
              tags: note.tags ?? [],
              project_id: note.project_id,
              url: noteUrl,
            },
          });
          log.push({ code: "webhook" });
        } else {
          log.push({ code: "notApplicable", params: { action: a.type, scope: "note" } });
        }
      } catch (e) {
        ok = false;
        log.push(failureStep(e));
      }
    }
    ran++;
    await supabase.from("automation_runs").insert({
      user_id: userId,
      automation_id: rule.id,
      note_id: note.id,
      ok,
      detail: serializeRunDetail("note", note.title, log),
    });
    await supabase
      .from("automations")
      .update({ run_count: rule.run_count + 1, last_run_at: now.toISOString() })
      .eq("id", rule.id);
  }
  return { ran, changed };
}

// i18n keys for the fields a capture filled (client-safe). Resolve them with `fieldLabels(t, …)`
// in the active locale; the server only returns field ids.
import { format, messages, type MessageKey, type MessageVars } from "@/lib/i18n";

type T = (key: MessageKey, vars?: MessageVars) => string;

/** Indonesian `t`, the default for callers that are not locale-aware. */
const tId: T = (key, vars) => format(messages.id[key], vars);

// Task fields (mirrors FilledField in src/server/taskExtract.server.ts).
export const FIELD_LABEL: Record<string, MessageKey> = {
  description: "wsFieldDescription",
  status: "wsFieldStatus",
  priority: "wsFieldPriority",
  project: "wsFieldProject",
  start: "wsFieldStart",
  due: "wsFieldDue",
  estimate: "wsFieldEstimate",
  assignee: "wsFieldAssignee",
  tags: "wsFieldTags",
  dependencies: "wsFieldDependencies",
  comments: "wsFieldComments",
  recurrence: "wsFieldRecurrence",
};

// Note fields (mirrors NoteFilledField in src/server/noteExtract.server.ts).
export const NOTE_FIELD_LABEL: Record<string, MessageKey> = {
  content: "wsFieldContent",
  status: "wsFieldStatus",
  project: "wsFieldProject",
  tags: "wsFieldTags",
  links: "wsFieldLinks",
  pinned: "wsFieldPinned",
  properties: "wsFieldProperties",
};

// The "Isi dari teks" project / template forms (ProjectFilledField and TemplateFilledField in
// src/server/formPrefill.server.ts).
export const PROJECT_FIELD_LABEL: Record<string, MessageKey> = {
  description: "wsFieldDescription",
  para: "wsFieldPara",
  status: "wsFieldStatus",
  color: "wsFieldColor",
  parent: "wsFieldParent",
  start: "wsFieldStart",
  due: "wsFieldDue",
  launch: "wsFieldLaunch",
  members: "wsFieldMembers",
};

export const TEMPLATE_FIELD_LABEL: Record<string, MessageKey> = {
  kind: "wsFieldKind",
  title: "wsFieldTitle",
  body: "wsFieldBody",
  tags: "wsFieldTags",
  priority: "wsFieldPriority",
  estimate: "wsFieldEstimate",
};

/** A key map above resolved to labels in the active locale. */
export function fieldLabels(t: T, keys: Record<string, MessageKey>): Record<string, string> {
  return Object.fromEntries(Object.entries(keys).map(([field, key]) => [field, t(key)]));
}

/** "proyek, tag" for the filled field ids (unknown ids are shown as-is). */
export function filledFieldsText(t: T, keys: Record<string, MessageKey>, filled: string[]) {
  return filled.map((f) => (keys[f] ? t(keys[f]) : f)).join(", ");
}

export type FillResult = {
  via: "ai" | "regex";
  filled: string[];
  dropped: string[];
};

/** "Diisi AI: proyek, tag · Diabaikan: … · Periksa lalu simpan." */
export function fillSummary(
  r: FillResult,
  labels: Record<string, string>,
  extra: string[] = [],
  t: T = tId,
) {
  const fields = r.filled.map((f) => labels[f] ?? f).join(", ");
  return [
    `${t(r.via === "ai" ? "wsFillSummaryAi" : "wsFillSummaryLocal")}${fields ? `: ${fields}` : ""}`,
    r.dropped.length ? t("wsFillSummaryDropped", { items: r.dropped.join("; ") }) : "",
    ...extra,
    t("wsFillSummaryReview"),
  ]
    .filter(Boolean)
    .join(" · ");
}

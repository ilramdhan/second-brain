// Coded automation run details (`automation_runs.detail`). The three engines (task rules, note
// rules, scheduled rules) log every action as a step code + params instead of Indonesian text; the
// row stores the JSON (`serializeRunDetail`, no migration: `detail` stays a text column) and the
// run history renders it in the UI language (`formatRunDetail`). Rows written before this change
// hold plain text and are shown as is.
//
// Params never carry secrets: no webhook URL, Telegram text/token or note body. Error messages are
// mapped to reason codes where known (`failureStep`); anything else keeps its (short) message.
import { ACTION_TYPES, DIGEST_KINDS, SCOPE_LABELS, type RuleScope } from "@/lib/automation-types";
import { CronError } from "@/lib/cron";
import { format, messages, type MessageKey, type MessageVars } from "@/lib/i18n";
import { optionLabel } from "@/lib/option-labels";

export type RunKind = RuleScope;

/** Step codes, one per thing an engine can log. Each maps to an i18n key (`STEP_KEYS`). */
export type RunStepCode =
  | "setField" // { field, value }
  | "addTag" // { tag }
  | "tagExists" // { tag }
  | "shiftDue" // { days }
  | "shiftDueNoDate"
  | "comment"
  | "telegram"
  | "webhook"
  | "skippedDemo" // { channel }
  | "notApplicable" // { action, scope }
  | "linkProject" // { project }
  | "alreadyInProject"
  | "createTask" // { title }
  | "moveOverdue" // { count, status }
  | "digestEmpty" // { kind }
  | "digestSent" // { kind, channel }
  | "scheduleStopped"
  | "failed" // { reason, ...reason vars } or { message }
  | "more"; // { count } steps cut to fit the column

export type RunParams = Record<string, string | number>;
export type RunStep = { code: RunStepCode; params?: RunParams };
export type RunDetail = { v: 1; kind: RunKind; subject: string; steps: RunStep[] };

export const RUN_DETAIL_MAX = 500;
const TEXT_MAX = 120;

const STEP_KEYS: Record<RunStepCode, MessageKey> = {
  setField: "autoRunSetField",
  addTag: "autoRunAddTag",
  tagExists: "autoRunTagExists",
  shiftDue: "autoRunShiftDue",
  shiftDueNoDate: "autoRunShiftDueNoDate",
  comment: "autoRunComment",
  telegram: "autoRunTelegram",
  webhook: "autoRunWebhook",
  skippedDemo: "autoRunSkippedDemo",
  notApplicable: "autoRunNotApplicable",
  linkProject: "autoRunLinkProject",
  alreadyInProject: "autoRunAlreadyInProject",
  createTask: "autoRunCreateTask",
  moveOverdue: "autoRunMoveOverdue",
  digestEmpty: "autoRunDigestEmpty",
  digestSent: "autoRunDigestSent",
  scheduleStopped: "autoRunScheduleStopped",
  failed: "autoRunFailed",
  more: "autoRunMore",
};

/** Failure reasons (`failed` step, `params.reason`). `cron` carries a `CronError` code instead. */
export type RunFailReason =
  | "projectNotFound"
  | "taskCreateFailed"
  | "invalidAction"
  | "emptyTag"
  | "telegramNotLinked"
  | "telegramNotConfigured"
  | "telegramUnreachable"
  | "telegramHttp" // { status }
  | "webhookUrlEmpty"
  | "webhookUnsafe"
  | "webhookTimeout"
  | "webhookUnreachable"
  | "webhookRedirect"
  | "webhookHttp"; // { status }

const REASON_KEYS: Record<RunFailReason, MessageKey> = {
  projectNotFound: "autoRunErrProjectNotFound",
  taskCreateFailed: "autoRunErrTaskCreate",
  invalidAction: "autoRunErrInvalidAction",
  emptyTag: "autoRunErrEmptyTag",
  telegramNotLinked: "autoRunErrTelegramNotLinked",
  telegramNotConfigured: "autoRunErrTelegramNotConfigured",
  telegramUnreachable: "autoRunErrTelegramUnreachable",
  telegramHttp: "autoRunErrTelegramHttp",
  webhookUrlEmpty: "autoRunErrWebhookUrlEmpty",
  webhookUnsafe: "autoRunErrWebhookUnsafe",
  webhookTimeout: "autoRunErrWebhookTimeout",
  webhookUnreachable: "autoRunErrWebhookUnreachable",
  webhookRedirect: "autoRunErrWebhookRedirect",
  webhookHttp: "autoRunErrWebhookHttp",
};

/**
 * Known (Indonesian) error messages thrown by the action helpers, Telegram and the SSRF guard →
 * reason codes. Order matters: specific patterns first.
 */
const REASON_PATTERNS: [RegExp, RunFailReason][] = [
  [/^Proyek tidak ditemukan$/, "projectNotFound"],
  [/^Gagal membuat tugas$/, "taskCreateFailed"],
  [/^aksi tidak valid$/, "invalidAction"],
  [/^tag kosong$/, "emptyTag"],
  [/^Akun Telegram belum ditautkan$/, "telegramNotLinked"],
  [/^Bot Telegram belum dikonfigurasi/, "telegramNotConfigured"],
  [/^Telegram tidak dapat dihubungi$/, "telegramUnreachable"],
  [/^Telegram gagal \[(\d{3})\]$/, "telegramHttp"],
  [/^URL webhook kosong$/, "webhookUrlEmpty"],
  [/^Webhook timeout/, "webhookTimeout"],
  [/^Webhook tidak dapat dihubungi$/, "webhookUnreachable"],
  [/^Webhook redirect tidak diizinkan$/, "webhookRedirect"],
  [/^Webhook (\d{3})$/, "webhookHttp"],
  [
    /^(?:Alamat webhook|Webhook harus https|Webhook tidak boleh|Port webhook|Host webhook)/,
    "webhookUnsafe",
  ],
];

const clip = (s: string, max = TEXT_MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** `failed` step for a caught error: a reason code when known, else the clipped message. */
export function failureStep(error: unknown): RunStep {
  if (error instanceof CronError) {
    const vars: RunParams = {};
    for (const [k, v] of Object.entries(error.vars)) vars[k] = typeof v === "string" ? clip(v) : v;
    return { code: "failed", params: { ...vars, reason: "cron", cron: error.code } };
  }
  const message = error instanceof Error ? error.message : "error";
  for (const [re, reason] of REASON_PATTERNS) {
    const m = re.exec(message);
    if (m) return { code: "failed", params: m[1] ? { reason, status: Number(m[1]) } : { reason } };
  }
  return { code: "failed", params: { message: clip(message) } };
}

/**
 * JSON for `automation_runs.detail`, at most `max` characters and always valid JSON: long text
 * params are clipped, and trailing steps that do not fit are replaced by one `more` step.
 */
export function serializeRunDetail(
  kind: RunKind,
  subject: string,
  steps: readonly RunStep[],
  max = RUN_DETAIL_MAX,
): string {
  const clean = steps.map((s): RunStep => {
    if (!s.params) return { code: s.code };
    const params: RunParams = {};
    for (const [k, v] of Object.entries(s.params)) params[k] = typeof v === "string" ? clip(v) : v;
    return { code: s.code, params };
  });
  const build = (list: RunStep[]) =>
    JSON.stringify({ v: 1, kind, subject: clip(subject), steps: list } satisfies RunDetail);
  let out = build(clean);
  for (let keep = clean.length - 1; out.length > max && keep >= 0; keep--) {
    out = build([
      ...clean.slice(0, keep),
      { code: "more", params: { count: clean.length - keep } },
    ]);
  }
  return out;
}

const KINDS: readonly RunKind[] = ["task", "note", "schedule"];
const isParams = (p: unknown): p is RunParams =>
  !!p &&
  typeof p === "object" &&
  !Array.isArray(p) &&
  Object.values(p).every((v) => typeof v === "string" || typeof v === "number");

/** The coded detail of a run row, or null for legacy plain text / anything malformed. */
export function parseRunDetail(raw: string | null | undefined): RunDetail | null {
  if (!raw || raw[0] !== "{") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d["v"] !== 1 || typeof d["subject"] !== "string" || !Array.isArray(d["steps"])) return null;
  if (!KINDS.includes(d["kind"] as RunKind)) return null;
  const steps: RunStep[] = [];
  for (const s of d["steps"] as unknown[]) {
    if (!s || typeof s !== "object") return null;
    const { code, params } = s as { code?: unknown; params?: unknown };
    if (typeof code !== "string") return null;
    if (params !== undefined && !isParams(params)) return null;
    steps.push(params ? { code: code as RunStepCode, params } : { code: code as RunStepCode });
  }
  return { v: 1, kind: d["kind"] as RunKind, subject: d["subject"], steps };
}

type Translate = (key: MessageKey, vars?: MessageVars) => string;

const FIELD_KEYS: Record<string, MessageKey> = {
  status: "autoFieldStatus",
  priority: "autoFieldPriority",
  assignee_name: "autoFieldAssignee",
};
const CHANNEL_KEYS: Record<string, MessageKey> = {
  telegram: "autoRunChannelTelegram",
  webhook: "autoRunChannelWebhook",
};

const isKey = (k: unknown): k is MessageKey => typeof k === "string" && k in messages.id;
const str = (v: string | number | undefined) => (v === undefined ? "" : String(v));

function reasonText(t: Translate, p: RunParams): string {
  if (p["reason"] === "cron" && typeof p["cron"] === "string" && p["cron"].startsWith("cronErr")) {
    const vars: MessageVars = { ...p };
    // Like `cronErrorText`: `{field}` holds a field key, translated with the message.
    if (typeof vars["field"] === "string" && isKey(vars["field"])) vars["field"] = t(vars["field"]);
    if (isKey(p["cron"])) return t(p["cron"], vars);
  }
  const key = REASON_KEYS[p["reason"] as RunFailReason];
  if (key) return t(key, { status: str(p["status"]) });
  return str(p["message"]) || "error";
}

function stepText(t: Translate, step: RunStep): string {
  const p = step.params ?? {};
  const key = STEP_KEYS[step.code];
  if (!key) return step.code; // a newer code than this client knows
  switch (step.code) {
    case "setField": {
      const field = str(p["field"]);
      const value = str(p["value"]);
      const fieldKey = FIELD_KEYS[field];
      return t(key, {
        field: fieldKey ? t(fieldKey) : field,
        value:
          field === "status" || field === "priority" ? optionLabel(t, field, value) : value || "-",
      });
    }
    case "skippedDemo":
    case "digestSent":
    case "digestEmpty": {
      const channel = str(p["channel"]);
      const kindKey = DIGEST_KINDS.find((k) => k.id === p["kind"])?.labelKey;
      return t(key, {
        channel: CHANNEL_KEYS[channel] ? t(CHANNEL_KEYS[channel]) : channel,
        kind: kindKey ? t(kindKey) : str(p["kind"]),
      });
    }
    case "notApplicable": {
      const actionKey = ACTION_TYPES.find((a) => a.id === p["action"])?.labelKey;
      const scopeKey = SCOPE_LABELS[p["scope"] as RuleScope];
      return t(key, {
        action: actionKey ? t(actionKey) : str(p["action"]),
        scope: scopeKey ? t(scopeKey) : str(p["scope"]),
      });
    }
    case "moveOverdue":
      return t(key, { count: str(p["count"]), status: optionLabel(t, "status", str(p["status"])) });
    case "failed":
      return t(key, { reason: reasonText(t, p) });
    default:
      return t(key, p);
  }
}

/**
 * Text of a run's `detail` in the language of `t`: coded details are translated, legacy plain-text
 * rows (and anything that is not a valid coded detail) are returned unchanged.
 */
export function formatRunDetail(t: Translate, detail: string | null | undefined): string {
  const d = parseRunDetail(detail);
  if (!d) return detail ?? "";
  const steps = d.steps.length
    ? d.steps.map((s) => stepText(t, s)).join("; ")
    : t("autoRunNoAction");
  return `${d.kind === "schedule" ? "⏰ " : ""}${d.subject} → ${steps}`;
}

/** Indonesian text of a coded detail (server-side responses such as the n8n tick summary). */
export function runDetailTextId(detail: string): string {
  return formatRunDetail((key, vars) => format(messages.id[key], vars), detail);
}

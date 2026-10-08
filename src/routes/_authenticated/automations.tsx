import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, CheckCircle2, Plus, Trash2, Workflow, XCircle } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/PageHeader";
import { Field } from "@/components/common/TagInput";
import { Button, ButtonGroup, ResponsiveButton, pressableFocus } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import {
  ACTION_TYPES,
  ACTIONS_BY_SCOPE,
  CONDITION_FIELDS,
  CONDITION_FIELDS_BY_SCOPE,
  DIGEST_KINDS,
  SCOPE_LABELS,
  scopeOf,
  TRIGGERS,
  type Action,
  type Condition,
  type RuleScope,
  type Trigger,
} from "@/lib/automation-types";
import { describeCron, isValidCron } from "@/lib/cron";
import {
  conditionValueLabel,
  scheduleStatus,
  scheduleTriggerLabel,
} from "@/lib/automation-display";
import { DEFAULT_ZONE, SchedulePicker } from "@/components/automations/SchedulePicker";
import { useAutomationActions, useAutomations, useProjects, type Automation } from "@/lib/data";
import type { Json } from "@/integrations/supabase/types";
import { PageContainer } from "@/components/common/PageContainer";
import { automationsQuery, preloadQueries, projectsQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { isDemo } from "@/lib/app-mode";
import { usePreferences, type Locale, type MessageKey } from "@/lib/preferences";
import { pageHead } from "@/lib/page-head";
import { PRIORITY, TASK_STATUS } from "@/lib/constants";
import { optionLabel, translatedOptions } from "@/lib/option-labels";
import { useConfirm } from "@/components/common/confirm-context";

/** Action types that reach outside the app; switched off on the public demo. */
const DEMO_OFF_ACTIONS = new Set<string>(["telegram", "webhook"]);

export const Route = createFileRoute("/_authenticated/automations")({
  head: (ctx) =>
    pageHead(ctx, {
      title: "metaAutomationsTitle",
      desc: "metaAutomationsDesc",
      ogDesc: "metaAutomationsOgDesc",
    }),
  loader: ({ context }) => preloadQueries(context.queryClient, automationsQuery, projectsQuery),
  component: AutomationsPage,
  errorComponent: RouteError,
});

const ANY = "any";
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;
type Template = {
  name: string;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  schedule_cron?: string;
};
/** Example rules in the UI language (their texts are stored as typed when the rule is saved). */
const templates = (t: Translate): Template[] => [
  {
    name: t("autoTplReviewName"),
    trigger: { type: "status_changed", to: "review" },
    conditions: [{ field: "priority", op: "eq", value: "high" }],
    actions: [
      { type: "set_field", field: "assignee_name", value: "Manager" },
      { type: "telegram", text: t("autoTplReviewTelegram") },
    ],
  },
  {
    name: t("autoTplUrgentName"),
    trigger: { type: "task_created" },
    conditions: [{ field: "tag", op: "eq", value: "urgent" }],
    actions: [
      { type: "set_field", field: "priority", value: "high" },
      { type: "comment", text: t("autoTplUrgentComment") },
    ],
  },
  {
    name: t("autoTplDoneName"),
    trigger: { type: "status_changed", to: "done" },
    conditions: [],
    actions: [{ type: "comment", text: t("autoTplDoneComment") }],
  },
  {
    name: t("autoTplWeeklyName"),
    trigger: { type: "schedule" },
    schedule_cron: "0 8 * * 1",
    conditions: [],
    actions: [{ type: "create_task", title: t("autoTplWeeklyTitle"), due_in_days: 0 }],
  },
  {
    name: t("autoTplMeetingName"),
    trigger: { type: "note_tagged", to: "rapat" },
    conditions: [],
    actions: [{ type: "create_task", title: t("autoTplMeetingTitle"), due_in_days: 2 }],
  },
];

/** Label of an i18n-keyed option list (`TRIGGERS`, `ACTION_TYPES`, …); the raw id if unknown. */
function keyedLabel(
  t: Translate,
  list: readonly { id: string; labelKey: MessageKey }[],
  id: string,
): string {
  const key = list.find((x) => x.id === id)?.labelKey;
  return key ? t(key) : id;
}

function describeTrigger(
  tr: Trigger,
  rule: Pick<Automation, "schedule_cron" | "schedule_tz">,
  t: Translate,
  locale: Locale,
) {
  if (tr.type === "schedule") return scheduleTriggerLabel(rule, locale);
  const base = keyedLabel(t, TRIGGERS, tr.type);
  if (!tr.to) return base;
  if (tr.type === "note_tagged") return `${base} #${tr.to}`;
  return `${base} → ${optionLabel(t, tr.type === "status_changed" ? "status" : "priority", tr.to)}`;
}

function AutomationsPage() {
  const { t, locale, dateFns } = usePreferences();
  const { data: rules = [] } = useAutomations();
  const { data: projects = [] } = useProjects();
  const actions = useAutomationActions();
  const [edit, setEdit] = useState<{ open: boolean; rule: Partial<Automation> | null }>({
    open: false,
    rule: null,
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["automation_runs", rules.map((r) => r.run_count).join()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  return (
    <PageContainer>
      <PageHeader title={t("automations")} subtitle={t("autoSubtitle")} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <ButtonGroup>
          {templates(t).map((tpl) => (
            <Button
              key={tpl.name}
              variant="secondary"
              size="sm"
              onClick={() =>
                setEdit({
                  open: true,
                  rule: {
                    name: tpl.name,
                    schedule_cron: tpl.schedule_cron ?? null,
                    trigger: tpl.trigger as unknown as Json,
                    conditions: tpl.conditions as unknown as Json,
                    actions: tpl.actions as unknown as Json,
                  },
                })
              }
            >
              {tpl.name}
            </Button>
          ))}
        </ButtonGroup>
        <ResponsiveButton
          onClick={() => setEdit({ open: true, rule: null })}
          icon={<Plus />}
          label={t("autoAddRule")}
        />
      </div>

      <ul className="space-y-2">
        {rules.map((r) => {
          const acts = (r.actions as unknown as Action[]) ?? [];
          const conds = (r.conditions as unknown as Condition[]) ?? [];
          return (
            <li key={r.id} className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {/* eslint-disable-next-line no-restricted-syntax -- exception: clickable rule row (opens the editor) */}
              <button
                type="button"
                className={cn("min-w-0 flex-1 rounded-md text-left", pressableFocus)}
                onClick={() => setEdit({ open: true, rule: r })}
              >
                <p className="text-sm font-medium">{r.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded-full bg-accent px-2 py-0.5 text-accent-foreground">
                    {describeTrigger(r.trigger as unknown as Trigger, r, t, locale)}
                  </span>
                  {conds.map((c, i) => (
                    <span key={i} className="rounded-full bg-secondary px-2 py-0.5">
                      {keyedLabel(t, CONDITION_FIELDS, c.field)}{" "}
                      {c.op === "eq" ? "=" : c.op === "neq" ? "≠" : "∋"}{" "}
                      {conditionValueLabel(c, projects, locale)}
                    </span>
                  ))}
                  <ArrowRight className="h-3 w-3" />
                  {acts.map((a, i) => (
                    <span key={i} className="rounded-full bg-secondary px-2 py-0.5">
                      {keyedLabel(t, ACTION_TYPES, a.type)}
                    </span>
                  ))}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("autoRunCount", { count: r.run_count })}{" "}
                  {r.last_run_at &&
                    t("autoLastRun", {
                      when: formatDistanceToNow(new Date(r.last_run_at), {
                        addSuffix: true,
                        locale: dateFns,
                      }),
                    })}
                  {(r.trigger as unknown as Trigger)?.type === "schedule" &&
                    scheduleStatus(r, locale)}
                </p>
              </button>
              <Switch
                checked={r.enabled}
                onCheckedChange={(v) => actions.update(r.id, { enabled: v })}
                aria-label={t("autoEnableRule")}
              />
            </li>
          );
        })}
        {rules.length === 0 && (
          <li className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("autoEmpty")}
          </li>
        )}
      </ul>

      <h2 className="mb-2 mt-8 text-sm font-semibold">{t("autoHistory")}</h2>
      <ul className="space-y-1">
        {runs.map((r) => (
          <li
            key={r.id}
            className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent/40"
          >
            {r.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            )}
            <span className="min-w-0 flex-1 break-words">{r.detail}</span>
            <span className="shrink-0 text-muted-foreground">
              {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: dateFns })}
            </span>
          </li>
        ))}
        {runs.length === 0 && (
          <li className="text-xs text-muted-foreground">{t("autoHistoryEmpty")}</li>
        )}
      </ul>

      <Dialog open={edit.open} onOpenChange={(o) => setEdit((e) => ({ ...e, open: o }))}>
        <DialogContent className="sm:max-w-2xl">
          {edit.open && (
            <RuleForm
              key={edit.rule?.id ?? edit.rule?.name ?? "new"}
              rule={edit.rule}
              onClose={() => setEdit({ open: false, rule: null })}
            />
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

const NONE = "none";
const ACTION_DEFAULTS: Record<Action["type"], Action> = {
  set_field: { type: "set_field", field: "assignee_name", value: "" },
  add_tag: { type: "add_tag", value: "" },
  shift_due: { type: "shift_due", days: 1 },
  comment: { type: "comment", text: "" },
  telegram: { type: "telegram", text: "" },
  webhook: { type: "webhook", url: "" },
  link_project: { type: "link_project", project_id: "" },
  create_task: { type: "create_task", title: "", due_in_days: null },
  move_overdue: { type: "move_overdue", project_id: null, status: "todo" },
  digest: { type: "digest", kind: "overdue", channel: "telegram" },
};
const FIRST_TRIGGER: Record<RuleScope, Trigger> = {
  task: { type: "status_changed", to: "review" },
  note: { type: "note_created" },
  schedule: { type: "schedule" },
};
const TEMPLATE_VARS: Record<RuleScope, string> = {
  task: "{{title}} {{status}} {{priority}} {{project}} {{assignee}} {{due}}",
  note: "{{title}} {{tags}} {{project}} {{rule}}",
  schedule: "{{date}} {{weekday}} {{rule}}",
};

function webhookUrlOf(a: Action): string | null {
  if (a.type === "webhook") return a.url;
  if (a.type === "digest" && a.channel === "webhook") return a.url ?? "";
  return null;
}

function RuleForm({ rule, onClose }: { rule: Partial<Automation> | null; onClose: () => void }) {
  const { t, locale } = usePreferences();
  const confirm = useConfirm();
  const actions = useAutomationActions();
  const { data: projects = [] } = useProjects();
  const demo = isDemo();
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<Trigger>(
    (rule?.trigger as unknown as Trigger) ?? FIRST_TRIGGER.task,
  );
  const [conds, setConds] = useState<Condition[]>(
    (rule?.conditions as unknown as Condition[]) ?? [],
  );
  const [acts, setActs] = useState<Action[]>(
    (rule?.actions as unknown as Action[]) ?? [{ type: "comment", text: "" }],
  );
  const [cron, setCron] = useState(rule?.schedule_cron ?? "0 8 * * 1");
  const [tz, setTz] = useState(rule?.schedule_tz ?? DEFAULT_ZONE);
  const scope = scopeOf(trigger.type);
  const tdef = TRIGGERS.find((t) => t.id === trigger.type);
  const allowedActions = ACTIONS_BY_SCOPE[scope];
  const allowedFields = CONDITION_FIELDS_BY_SCOPE[scope];

  function changeScope(next: RuleScope) {
    if (next === scope) return;
    setTrigger(FIRST_TRIGGER[next]);
    setConds([]);
    setActs([ACTION_DEFAULTS[ACTIONS_BY_SCOPE[next][0]!]]);
  }

  async function save() {
    if (!name.trim()) {
      toast.error(t("autoErrNameRequired"));
      return;
    }
    if (!acts.length) {
      toast.error(t("autoErrNoAction"));
      return;
    }
    if (scope === "schedule" && !isValidCron(cron)) {
      toast.error(t("autoErrInvalidSchedule", { detail: describeCron(cron, locale) }));
      return;
    }
    for (const a of acts) {
      if (!allowedActions.includes(a.type)) {
        toast.error(t("autoErrActionNotAllowed", { action: keyedLabel(t, ACTION_TYPES, a.type) }));
        return;
      }
      const url = webhookUrlOf(a);
      if (url !== null) {
        try {
          if (new URL(url).protocol !== "https:") throw 0;
        } catch {
          toast.error(t("autoErrWebhookHttps"));
          return;
        }
      }
      if (a.type === "create_task" && !a.title.trim()) {
        toast.error(t("autoErrTaskTitle"));
        return;
      }
      if (a.type === "link_project" && !a.project_id) {
        toast.error(t("autoErrPickProject"));
        return;
      }
    }
    const payload = {
      name: name.trim().slice(0, 120),
      trigger: trigger as unknown as Json,
      conditions: (scope === "schedule" ? [] : conds) as unknown as Json,
      actions: acts as unknown as Json,
      schedule_cron: scope === "schedule" ? cron.trim() : null,
      schedule_tz: scope === "schedule" ? tz : null,
      // The server sets next_run_at for schedules (scheduleAutomation); others never have one.
      ...(scope === "schedule" ? {} : { next_run_at: null }),
    };
    if (rule?.id) await actions.update(rule.id, payload);
    else await actions.create(payload);
    toast.success(t("autoSaved"));
    onClose();
  }
  async function remove() {
    if (!rule?.id || !(await confirm({ title: t("autoConfirmDelete"), destructive: true }))) return;
    await actions.remove(rule.id);
    onClose();
  }
  const setAct = (i: number, a: Action) => setActs(acts.map((x, j) => (j === i ? a : x)));
  const projectOpts = projects.map((p) => ({ id: p.id, label: p.name }));
  const statusOpts = translatedOptions(t, "status", TASK_STATUS);
  const priorityOpts = translatedOptions(t, "priority", PRIORITY);

  const optionSelect = (
    label: string,
    value: string,
    options: readonly { id: string; label: string }[],
    onChange: (v: string) => void,
  ) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-9">
        <SelectValue placeholder={t("autoSelectPlaceholder")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const projectSelect = (
    label: string,
    value: string | null | undefined,
    onChange: (v: string | null) => void,
    noneLabel: string,
  ) =>
    optionSelect(label, value || NONE, [{ id: NONE, label: noneLabel }, ...projectOpts], (v) =>
      onChange(v === NONE ? null : v),
    );

  const valueInput = (field: string, value: string, onChange: (v: string) => void) => {
    const opts =
      field === "priority"
        ? priorityOpts
        : field === "status"
          ? statusOpts
          : field === "project_id"
            ? projectOpts
            : null;
    if (opts) return optionSelect(t("autoValue"), value, opts, onChange);
    return (
      <Input
        className="h-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("autoValue")}
        aria-label={t("autoValue")}
      />
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rule?.id ? t("autoEditRule") : t("autoNewRule")}</DialogTitle>
        <DialogDescription>
          {scope === "schedule" ? t("autoDescSchedule") : t("autoDescEvent")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("autoRuleName")}
          aria-label={t("autoRuleName")}
          className="h-11 font-medium"
        />

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("autoStepIf")}
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select value={scope} onValueChange={(v) => changeScope(v as RuleScope)}>
              <SelectTrigger aria-label={t("autoRuleType")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SCOPE_LABELS) as RuleScope[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(SCOPE_LABELS[s])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scope !== "schedule" && (
              <Select
                value={trigger.type}
                onValueChange={(v) => setTrigger({ type: v as Trigger["type"] })}
              >
                <SelectTrigger aria-label={t("autoTrigger")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGERS.filter((x) => x.scope === scope).map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {t(x.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {tdef?.hasTo === "tag" && (
              <Input
                className="h-9"
                value={trigger.to ?? ""}
                maxLength={60}
                onChange={(e) =>
                  setTrigger({ ...trigger, to: e.target.value.replace(/^#/, "") || undefined })
                }
                placeholder={t("autoTriggerTagPlaceholder")}
                aria-label={t("autoTriggerTag")}
              />
            )}
            {(tdef?.hasTo === "status" || tdef?.hasTo === "priority") && (
              <Select
                value={trigger.to ?? ANY}
                onValueChange={(v) => setTrigger({ ...trigger, to: v === ANY ? undefined : v })}
              >
                <SelectTrigger aria-label={t("autoTriggerValue")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("autoBecomesAny")}</SelectItem>
                  {(tdef.hasTo === "status" ? statusOpts : priorityOpts).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {t("autoBecomes", { value: o.label })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {scope === "schedule" && (
            <SchedulePicker
              cron={cron}
              tz={tz}
              onChange={(c, z) => {
                setCron(c);
                setTz(z);
              }}
            />
          )}
          {scope === "schedule" && demo && (
            <p className="text-[11px] text-muted-foreground">{t("autoDemoSchedule")}</p>
          )}
          {trigger.type === "note_updated" && (
            <p className="text-[11px] text-muted-foreground">{t("autoNoteUpdatedHint")}</p>
          )}
        </section>

        {scope !== "schedule" && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("autoStepConditions")}
            </h3>
            {conds.map((c, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]"
              >
                <Select
                  value={c.field}
                  onValueChange={(v) =>
                    setConds(
                      conds.map((x, j) =>
                        j === i ? { ...x, field: v as Condition["field"], value: "" } : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger aria-label={t("autoConditionField")} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_FIELDS.filter((f) => allowedFields.includes(f.id)).map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {t(f.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={c.op}
                  onValueChange={(v) =>
                    setConds(
                      conds.map((x, j) => (j === i ? { ...x, op: v as Condition["op"] } : x)),
                    )
                  }
                >
                  <SelectTrigger aria-label={t("autoOperator")} className="h-9 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eq">{t("autoOpEq")}</SelectItem>
                    <SelectItem value="neq">{t("autoOpNeq")}</SelectItem>
                    <SelectItem value="contains">{t("autoOpContains")}</SelectItem>
                  </SelectContent>
                </Select>
                {valueInput(c.field, c.value, (v) =>
                  setConds(conds.map((x, j) => (j === i ? { ...x, value: v } : x))),
                )}
                <Button
                  variant="tertiary"
                  size="icon"
                  onClick={() => setConds(conds.filter((_, j) => j !== i))}
                  aria-label={t("autoRemoveCondition")}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setConds([
                  ...conds,
                  scope === "note"
                    ? { field: "tag", op: "eq", value: "" }
                    : { field: "priority", op: "eq", value: "high" },
                ])
              }
            >
              <Plus /> {t("autoAddCondition")}
            </Button>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {scope === "schedule" ? t("autoStepThenSchedule") : t("autoStepThen")}
          </h3>
          {acts.map((a, i) => (
            <div key={i} className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <Select
                  value={a.type}
                  onValueChange={(v) => setAct(i, ACTION_DEFAULTS[v as Action["type"]])}
                >
                  <SelectTrigger aria-label={t("autoActionType")} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.filter((x) => allowedActions.includes(x.id)).map((x) => {
                      // Radix SelectItem cannot host DemoDisabled's focusable wrapper, so the
                      // reason is part of the (disabled, still announced) option text.
                      const off = demo && DEMO_OFF_ACTIONS.has(x.id);
                      const label = t(x.labelKey);
                      return (
                        <SelectItem key={x.id} value={x.id} disabled={off}>
                          {off ? `${label} (${t("demoDisabled")})` : label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  variant="tertiary"
                  size="icon"
                  onClick={() => setActs(acts.filter((_, j) => j !== i))}
                  aria-label={t("autoRemoveAction")}
                >
                  <Trash2 />
                </Button>
              </div>
              {a.type === "set_field" && (
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={a.field}
                    onValueChange={(v) =>
                      setAct(i, { ...a, field: v as typeof a.field, value: "" })
                    }
                  >
                    <SelectTrigger aria-label={t("autoFieldToChange")} className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="assignee_name">{t("autoFieldAssignee")}</SelectItem>
                      <SelectItem value="priority">{t("autoFieldPriority")}</SelectItem>
                      <SelectItem value="status">{t("autoFieldStatus")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {valueInput(a.field, a.value, (v) => setAct(i, { ...a, value: v }))}
                </div>
              )}
              {a.type === "add_tag" && (
                <Input
                  className="h-9"
                  value={a.value}
                  maxLength={60}
                  onChange={(e) => setAct(i, { ...a, value: e.target.value })}
                  placeholder={t("autoTagNamePlaceholder")}
                  aria-label={t("autoTagName")}
                />
              )}
              {a.type === "shift_due" && (
                <Field label={t("autoShiftDays")}>
                  <Input
                    className="h-9"
                    type="number"
                    value={a.days}
                    onChange={(e) => setAct(i, { ...a, days: Number(e.target.value) || 0 })}
                  />
                </Field>
              )}
              {(a.type === "comment" || a.type === "telegram") && (
                <Input
                  className="h-9"
                  value={a.text}
                  maxLength={2000}
                  onChange={(e) => setAct(i, { ...a, text: e.target.value })}
                  placeholder={t("autoTextPlaceholder", { vars: TEMPLATE_VARS[scope] })}
                  aria-label={t("autoMessageText")}
                />
              )}
              {a.type === "webhook" && (
                <Input
                  className="h-9"
                  value={a.url}
                  onChange={(e) => setAct(i, { ...a, url: e.target.value })}
                  placeholder={t("autoWebhookPlaceholder")}
                  aria-label={t("autoWebhookUrl")}
                />
              )}
              {a.type === "link_project" &&
                optionSelect(t("autoFieldProject"), a.project_id, projectOpts, (v) =>
                  setAct(i, { ...a, project_id: v }),
                )}
              {a.type === "create_task" && (
                <div className="space-y-2">
                  <Input
                    className="h-9"
                    value={a.title}
                    maxLength={200}
                    onChange={(e) => setAct(i, { ...a, title: e.target.value })}
                    placeholder={t("autoTaskTitlePlaceholder", { vars: TEMPLATE_VARS[scope] })}
                    aria-label={t("autoTaskTitle")}
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {optionSelect(
                      t("autoFieldPriority"),
                      a.priority ?? "medium",
                      priorityOpts,
                      (v) => setAct(i, { ...a, priority: v as "high" | "medium" | "low" }),
                    )}
                    {projectSelect(
                      t("autoTaskProject"),
                      a.project_id,
                      (v) => setAct(i, { ...a, project_id: v }),
                      scope === "note" ? t("autoNoteProject") : t("autoNoProject"),
                    )}
                    <Input
                      className="h-9"
                      type="number"
                      min={0}
                      max={365}
                      value={a.due_in_days ?? ""}
                      onChange={(e) =>
                        setAct(i, {
                          ...a,
                          due_in_days:
                            e.target.value === ""
                              ? null
                              : Math.min(365, Math.max(0, Number(e.target.value) || 0)),
                        })
                      }
                      placeholder={t("autoDueDaysPlaceholder")}
                      aria-label={t("autoDueDaysLabel")}
                    />
                  </div>
                </div>
              )}
              {a.type === "move_overdue" && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {projectSelect(
                    t("autoFieldProject"),
                    a.project_id,
                    (v) => setAct(i, { ...a, project_id: v }),
                    t("autoMyTasksAllProjects"),
                  )}
                  {optionSelect(
                    t("autoTargetStatus"),
                    a.status,
                    statusOpts.filter((s) => s.id !== "done"),
                    (v) => setAct(i, { ...a, status: v as typeof a.status }),
                  )}
                </div>
              )}
              {a.type === "digest" && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {optionSelect(
                    t("autoDigestKind"),
                    a.kind,
                    DIGEST_KINDS.map((d) => ({ id: d.id, label: t(d.labelKey) })),
                    (v) => setAct(i, { ...a, kind: v as typeof a.kind }),
                  )}
                  {optionSelect(
                    t("autoSendVia"),
                    a.channel,
                    [
                      { id: "telegram", label: "Telegram" },
                      { id: "webhook", label: "Webhook" },
                    ],
                    (v) => setAct(i, { ...a, channel: v as typeof a.channel }),
                  )}
                  {a.channel === "webhook" && (
                    <Input
                      className="h-9 sm:col-span-2"
                      value={a.url ?? ""}
                      onChange={(e) => setAct(i, { ...a, url: e.target.value })}
                      placeholder="https://…"
                      aria-label={t("autoDigestWebhookUrl")}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setActs([...acts, ACTION_DEFAULTS[allowedActions[0]!]])}
          >
            <Plus /> {t("autoAddAction")}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {demo
              ? t("autoHintDemo")
              : scope === "schedule"
                ? t("autoHintSchedule")
                : t("autoHintEvent")}
          </p>
        </section>
      </div>
      <DialogFooter>
        {rule?.id && (
          <Button
            variant="tertiary"
            onClick={remove}
            className="text-destructive hover:text-destructive sm:mr-auto"
          >
            <Trash2 /> {t("autoDelete")}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t("autoCancel")}
        </Button>
        <Button onClick={save}>{t("autoSave")}</Button>
      </DialogFooter>
    </>
  );
}

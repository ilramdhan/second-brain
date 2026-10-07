import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { ArrowRight, CheckCircle2, Plus, Trash2, Workflow, XCircle } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/PageHeader";
import { Field } from "@/components/common/TagInput";
import { Button } from "@/components/ui/button";
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
import { labelOf, PRIORITY, TASK_STATUS } from "@/lib/constants";
import { useAutomationActions, useAutomations, useProjects, type Automation } from "@/lib/data";
import type { Json } from "@/integrations/supabase/types";
import { PageContainer } from "@/components/common/PageContainer";
import { automationsQuery, preloadQueries, projectsQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { DEMO_DISABLED_MESSAGE, isDemo } from "@/lib/app-mode";

/** Action types that reach outside the app; switched off on the public demo. */
const DEMO_OFF_ACTIONS = new Set<string>(["telegram", "webhook"]);

export const Route = createFileRoute("/_authenticated/automations")({
  head: () => ({
    meta: [
      { title: "Otomasi — Second Brain" },
      {
        name: "description",
        content:
          "Buat aturan jika-ini-maka-itu untuk tugas dan catatan, atau aturan terjadwal (cron): ubah tugas, buat tugas, kirim ringkasan, Telegram atau webhook.",
      },
      { property: "og:title", content: "Otomasi — Second Brain" },
      { property: "og:description", content: "Mesin aturan otomatis untuk tugas Anda." },
    ],
  }),
  loader: ({ context }) => preloadQueries(context.queryClient, automationsQuery, projectsQuery),
  component: AutomationsPage,
  errorComponent: RouteError,
});

const ANY = "any";
type Template = {
  name: string;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  schedule_cron?: string;
};
const TEMPLATES: Template[] = [
  {
    name: "Review prioritas tinggi → Manager",
    trigger: { type: "status_changed", to: "review" },
    conditions: [{ field: "priority", op: "eq", value: "high" }],
    actions: [
      { type: "set_field", field: "assignee_name", value: "Manager" },
      { type: "telegram", text: "🔍 Siap direview: {{title}} ({{project}})" },
    ],
  },
  {
    name: "Tugas #urgent → prioritas tinggi",
    trigger: { type: "task_created" },
    conditions: [{ field: "tag", op: "eq", value: "urgent" }],
    actions: [
      { type: "set_field", field: "priority", value: "high" },
      { type: "comment", text: "Ditandai mendesak otomatis." },
    ],
  },
  {
    name: "Selesai → catat di log",
    trigger: { type: "status_changed", to: "done" },
    conditions: [],
    actions: [{ type: "comment", text: "✅ Selesai: {{title}}" }],
  },
  {
    name: "Senin pagi → tugas weekly review",
    trigger: { type: "schedule" },
    schedule_cron: "0 8 * * 1",
    conditions: [],
    actions: [{ type: "create_task", title: "Weekly review {{date}}", due_in_days: 0 }],
  },
  {
    name: "Catatan #rapat → buat tugas tindak lanjut",
    trigger: { type: "note_tagged", to: "rapat" },
    conditions: [],
    actions: [{ type: "create_task", title: "Tindak lanjut: {{title}}", due_in_days: 2 }],
  },
];

function describeTrigger(t: Trigger, rule: Pick<Automation, "schedule_cron" | "schedule_tz">) {
  if (t.type === "schedule") return scheduleTriggerLabel(rule);
  const base = TRIGGERS.find((x) => x.id === t.type)?.label ?? t.type;
  if (!t.to) return base;
  if (t.type === "note_tagged") return `${base} #${t.to}`;
  return `${base} → ${t.type === "status_changed" ? labelOf(TASK_STATUS, t.to) : labelOf(PRIORITY, t.to)}`;
}

function AutomationsPage() {
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
    <PageContainer size="narrow">
      <PageHeader
        title="Otomasi"
        subtitle="Jika sesuatu terjadi pada tugas atau catatan, atau pada jadwal tertentu, aplikasi menjalankan aksinya untuk Anda."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <Button
              key={t.name}
              variant="outline"
              size="sm"
              onClick={() =>
                setEdit({
                  open: true,
                  rule: {
                    name: t.name,
                    schedule_cron: t.schedule_cron ?? null,
                    trigger: t.trigger as unknown as Json,
                    conditions: t.conditions as unknown as Json,
                    actions: t.actions as unknown as Json,
                  },
                })
              }
            >
              {t.name}
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={() => setEdit({ open: true, rule: null })}>
          <Plus /> Aturan
        </Button>
      </div>

      <ul className="space-y-2">
        {rules.map((r) => {
          const acts = (r.actions as unknown as Action[]) ?? [];
          const conds = (r.conditions as unknown as Condition[]) ?? [];
          return (
            <li key={r.id} className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => setEdit({ open: true, rule: r })}
              >
                <p className="text-sm font-medium">{r.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded-full bg-accent px-2 py-0.5 text-accent-foreground">
                    {describeTrigger(r.trigger as unknown as Trigger, r)}
                  </span>
                  {conds.map((c, i) => (
                    <span key={i} className="rounded-full bg-secondary px-2 py-0.5">
                      {labelOf(CONDITION_FIELDS, c.field)}{" "}
                      {c.op === "eq" ? "=" : c.op === "neq" ? "≠" : "∋"}{" "}
                      {conditionValueLabel(c, projects)}
                    </span>
                  ))}
                  <ArrowRight className="h-3 w-3" />
                  {acts.map((a, i) => (
                    <span key={i} className="rounded-full bg-secondary px-2 py-0.5">
                      {labelOf(ACTION_TYPES, a.type)}
                    </span>
                  ))}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Dijalankan {r.run_count}×{" "}
                  {r.last_run_at &&
                    `· terakhir ${formatDistanceToNow(new Date(r.last_run_at), { addSuffix: true, locale: localeId })}`}
                  {(r.trigger as unknown as Trigger)?.type === "schedule" && scheduleStatus(r)}
                </p>
              </button>
              <Switch
                checked={r.enabled}
                onCheckedChange={(v) => actions.update(r.id, { enabled: v })}
                aria-label="Aktifkan aturan"
              />
            </li>
          );
        })}
        {rules.length === 0 && (
          <li className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Belum ada aturan. Mulai dari contoh di atas atau buat sendiri.
          </li>
        )}
      </ul>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Riwayat terbaru</h2>
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
              {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: localeId })}
            </span>
          </li>
        ))}
        {runs.length === 0 && (
          <li className="text-xs text-muted-foreground">Belum ada yang dijalankan.</li>
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
const PLACEHOLDERS: Record<RuleScope, string> = {
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
      toast.error("Nama aturan wajib diisi");
      return;
    }
    if (!acts.length) {
      toast.error("Tambahkan minimal satu aksi");
      return;
    }
    if (scope === "schedule" && !isValidCron(cron)) {
      toast.error(`Jadwal tidak valid: ${describeCron(cron)}`);
      return;
    }
    for (const a of acts) {
      if (!allowedActions.includes(a.type)) {
        toast.error(`Aksi "${labelOf(ACTION_TYPES, a.type)}" tidak berlaku di sini`);
        return;
      }
      const url = webhookUrlOf(a);
      if (url !== null) {
        try {
          if (new URL(url).protocol !== "https:") throw 0;
        } catch {
          toast.error("Alamat webhook harus diawali https://");
          return;
        }
      }
      if (a.type === "create_task" && !a.title.trim()) {
        toast.error("Judul tugas wajib diisi");
        return;
      }
      if (a.type === "link_project" && !a.project_id) {
        toast.error("Pilih proyek yang ditautkan");
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
    toast.success("Aturan disimpan");
    onClose();
  }
  async function remove() {
    if (!rule?.id || !confirm("Hapus aturan ini?")) return;
    await actions.remove(rule.id);
    onClose();
  }
  const setAct = (i: number, a: Action) => setActs(acts.map((x, j) => (j === i ? a : x)));
  const projectOpts = projects.map((p) => ({ id: p.id, label: p.name }));

  const optionSelect = (
    label: string,
    value: string,
    options: readonly { id: string; label: string }[],
    onChange: (v: string) => void,
  ) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-9">
        <SelectValue placeholder="Pilih…" />
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
        ? PRIORITY
        : field === "status"
          ? TASK_STATUS
          : field === "project_id"
            ? projectOpts
            : null;
    if (opts) return optionSelect("Nilai", value, opts, onChange);
    return (
      <Input
        className="h-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Nilai"
        aria-label="Nilai"
      />
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rule?.id ? "Ubah aturan" : "Aturan baru"}</DialogTitle>
        <DialogDescription>
          {scope === "schedule"
            ? "Pada jadwal yang ditentukan, aksi dijalankan berurutan."
            : "Jika pemicu terjadi dan semua syarat cocok, aksi dijalankan berurutan."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama aturan"
          aria-label="Nama aturan"
          className="h-11 font-medium"
        />

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            1. Jika
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select value={scope} onValueChange={(v) => changeScope(v as RuleScope)}>
              <SelectTrigger aria-label="Jenis aturan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SCOPE_LABELS) as RuleScope[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SCOPE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scope !== "schedule" && (
              <Select
                value={trigger.type}
                onValueChange={(v) => setTrigger({ type: v as Trigger["type"] })}
              >
                <SelectTrigger aria-label="Pemicu">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGERS.filter((t) => t.scope === scope).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
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
                placeholder="tag (kosong = tag apa saja)"
                aria-label="Tag pemicu"
              />
            )}
            {(tdef?.hasTo === "status" || tdef?.hasTo === "priority") && (
              <Select
                value={trigger.to ?? ANY}
                onValueChange={(v) => setTrigger({ ...trigger, to: v === ANY ? undefined : v })}
              >
                <SelectTrigger aria-label="Nilai pemicu">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Menjadi apa saja</SelectItem>
                  {(tdef.hasTo === "status" ? TASK_STATUS : PRIORITY).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      Menjadi {o.label}
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
            <p className="text-[11px] text-muted-foreground">
              Mode demo: aturan terjadwal bisa dibuat, tetapi tidak pernah dijalankan.
            </p>
          )}
          {trigger.type === "note_updated" && (
            <p className="text-[11px] text-muted-foreground">
              Catatan tersimpan otomatis saat diketik, jadi aturan ini berjalan paling banyak sekali
              per 30 menit untuk catatan yang sama.
            </p>
          )}
        </section>

        {scope !== "schedule" && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              2. Dan syarat (opsional)
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
                  <SelectTrigger aria-label="Kolom syarat" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_FIELDS.filter((f) => allowedFields.includes(f.id)).map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.label}
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
                  <SelectTrigger aria-label="Operator" className="h-9 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eq">sama</SelectItem>
                    <SelectItem value="neq">bukan</SelectItem>
                    <SelectItem value="contains">memuat</SelectItem>
                  </SelectContent>
                </Select>
                {valueInput(c.field, c.value, (v) =>
                  setConds(conds.map((x, j) => (j === i ? { ...x, value: v } : x))),
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConds(conds.filter((_, j) => j !== i))}
                  aria-label="Hapus syarat"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
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
              <Plus /> Syarat
            </Button>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {scope === "schedule" ? "2. Maka" : "3. Maka"}
          </h3>
          {acts.map((a, i) => (
            <div key={i} className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <Select
                  value={a.type}
                  onValueChange={(v) => setAct(i, ACTION_DEFAULTS[v as Action["type"]])}
                >
                  <SelectTrigger aria-label="Jenis aksi" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.filter((t) => allowedActions.includes(t.id)).map((t) => {
                      // Radix SelectItem cannot host DemoDisabled's focusable wrapper, so the
                      // reason is part of the (disabled, still announced) option text.
                      const off = demo && DEMO_OFF_ACTIONS.has(t.id);
                      return (
                        <SelectItem key={t.id} value={t.id} disabled={off}>
                          {off ? `${t.label} (${DEMO_DISABLED_MESSAGE})` : t.label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setActs(acts.filter((_, j) => j !== i))}
                  aria-label="Hapus aksi"
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
                    <SelectTrigger aria-label="Kolom yang diubah" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="assignee_name">Penanggung jawab</SelectItem>
                      <SelectItem value="priority">Prioritas</SelectItem>
                      <SelectItem value="status">Status</SelectItem>
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
                  placeholder="nama-tag"
                  aria-label="Nama tag"
                />
              )}
              {a.type === "shift_due" && (
                <Field label="Geser tenggat (hari, boleh negatif)">
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
                  placeholder={`Teks. Bisa pakai ${PLACEHOLDERS[scope]}`}
                  aria-label="Teks pesan"
                />
              )}
              {a.type === "webhook" && (
                <Input
                  className="h-9"
                  value={a.url}
                  onChange={(e) => setAct(i, { ...a, url: e.target.value })}
                  placeholder="https://hooks.slack.com/… atau URL n8n/Discord"
                  aria-label="URL webhook"
                />
              )}
              {a.type === "link_project" &&
                optionSelect("Proyek", a.project_id, projectOpts, (v) =>
                  setAct(i, { ...a, project_id: v }),
                )}
              {a.type === "create_task" && (
                <div className="space-y-2">
                  <Input
                    className="h-9"
                    value={a.title}
                    maxLength={200}
                    onChange={(e) => setAct(i, { ...a, title: e.target.value })}
                    placeholder={`Judul tugas. Bisa pakai ${PLACEHOLDERS[scope]}`}
                    aria-label="Judul tugas"
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {optionSelect("Prioritas", a.priority ?? "medium", PRIORITY, (v) =>
                      setAct(i, { ...a, priority: v as "high" | "medium" | "low" }),
                    )}
                    {projectSelect(
                      "Proyek tugas",
                      a.project_id,
                      (v) => setAct(i, { ...a, project_id: v }),
                      scope === "note" ? "Proyek catatan" : "Tanpa proyek",
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
                      placeholder="Tenggat +hari (opsional)"
                      aria-label="Tenggat, hari setelah dijalankan"
                    />
                  </div>
                </div>
              )}
              {a.type === "move_overdue" && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {projectSelect(
                    "Proyek",
                    a.project_id,
                    (v) => setAct(i, { ...a, project_id: v }),
                    "Tugas saya (semua proyek)",
                  )}
                  {optionSelect(
                    "Status tujuan",
                    a.status,
                    TASK_STATUS.filter((s) => s.id !== "done"),
                    (v) => setAct(i, { ...a, status: v as typeof a.status }),
                  )}
                </div>
              )}
              {a.type === "digest" && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {optionSelect("Jenis ringkasan", a.kind, DIGEST_KINDS, (v) =>
                    setAct(i, { ...a, kind: v as typeof a.kind }),
                  )}
                  {optionSelect(
                    "Kirim lewat",
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
                      aria-label="URL webhook ringkasan"
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActs([...acts, ACTION_DEFAULTS[allowedActions[0]!]])}
          >
            <Plus /> Aksi
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {demo
              ? "Mode demo: aksi Telegram dan webhook dimatikan; aturan yang sudah memakainya tetap jalan tanpa mengirim apa pun."
              : scope === "schedule"
                ? "Pindahkan tugas terlambat tidak pernah menandai selesai. Ringkasan sama dengan digest Telegram harian."
                : "Telegram terkirim ke akun yang ditautkan di Pengaturan. Webhook mengirim data ringkas (JSON), cocok untuk Slack/Discord."}
          </p>
        </section>
      </div>
      <DialogFooter>
        {rule?.id && (
          <Button
            variant="ghost"
            onClick={remove}
            className="text-destructive hover:text-destructive sm:mr-auto"
          >
            <Trash2 /> Hapus
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button onClick={save}>Simpan</Button>
      </DialogFooter>
    </>
  );
}

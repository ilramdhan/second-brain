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
  CONDITION_FIELDS,
  TRIGGERS,
  type Action,
  type Condition,
  type Trigger,
} from "@/lib/automation-types";
import { labelOf, PRIORITY, TASK_STATUS } from "@/lib/constants";
import { useAutomationActions, useAutomations, useProjects, type Automation } from "@/lib/data";
import type { Json } from "@/integrations/supabase/types";
import { PageContainer } from "@/components/common/PageContainer";
import { automationsQuery, preloadQueries, projectsQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";

export const Route = createFileRoute("/_authenticated/automations")({
  head: () => ({
    meta: [
      { title: "Otomasi — Second Brain" },
      {
        name: "description",
        content:
          "Buat aturan jika-ini-maka-itu: ubah tugas, tambah komentar, kirim Telegram atau webhook secara otomatis.",
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
const TEMPLATES: { name: string; trigger: Trigger; conditions: Condition[]; actions: Action[] }[] =
  [
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
  ];

function describeTrigger(t: Trigger) {
  const base = TRIGGERS.find((x) => x.id === t.type)?.label ?? t.type;
  if (!t.to) return base;
  return `${base} → ${t.type === "status_changed" ? labelOf(TASK_STATUS, t.to) : labelOf(PRIORITY, t.to)}`;
}

function AutomationsPage() {
  const { data: rules = [] } = useAutomations();
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
        subtitle="Jika sesuatu terjadi pada tugas, aplikasi menjalankan aksinya untuk Anda."
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
                    {describeTrigger(r.trigger as unknown as Trigger)}
                  </span>
                  {conds.map((c, i) => (
                    <span key={i} className="rounded-full bg-secondary px-2 py-0.5">
                      {labelOf(CONDITION_FIELDS, c.field)}{" "}
                      {c.op === "eq" ? "=" : c.op === "neq" ? "≠" : "∋"} {c.value}
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
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
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

function RuleForm({ rule, onClose }: { rule: Partial<Automation> | null; onClose: () => void }) {
  const actions = useAutomationActions();
  const { data: projects = [] } = useProjects();
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<Trigger>(
    (rule?.trigger as unknown as Trigger) ?? { type: "status_changed", to: "review" },
  );
  const [conds, setConds] = useState<Condition[]>(
    (rule?.conditions as unknown as Condition[]) ?? [],
  );
  const [acts, setActs] = useState<Action[]>(
    (rule?.actions as unknown as Action[]) ?? [{ type: "comment", text: "" }],
  );
  const tdef = TRIGGERS.find((t) => t.id === trigger.type);

  async function save() {
    if (!name.trim()) {
      toast.error("Nama aturan wajib diisi");
      return;
    }
    if (!acts.length) {
      toast.error("Tambahkan minimal satu aksi");
      return;
    }
    for (const a of acts) {
      if (a.type === "webhook") {
        try {
          if (new URL(a.url).protocol !== "https:") throw 0;
        } catch {
          toast.error("Alamat webhook harus diawali https://");
          return;
        }
      }
    }
    const payload = {
      name: name.trim().slice(0, 120),
      trigger: trigger as unknown as Json,
      conditions: conds as unknown as Json,
      actions: acts as unknown as Json,
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

  const valueInput = (field: string, value: string, onChange: (v: string) => void) => {
    const opts =
      field === "priority"
        ? PRIORITY
        : field === "status"
          ? TASK_STATUS
          : field === "project_id"
            ? projects.map((p) => ({ id: p.id, label: p.name }))
            : null;
    if (opts)
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Pilih…" />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    return (
      <Input
        className="h-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Nilai"
      />
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rule?.id ? "Ubah aturan" : "Aturan baru"}</DialogTitle>
        <DialogDescription>
          Jika pemicu terjadi dan semua syarat cocok, aksi dijalankan berurutan.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama aturan"
          className="h-11 font-medium"
        />

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            1. Jika
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              value={trigger.type}
              onValueChange={(v) => setTrigger({ type: v as Trigger["type"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGERS.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tdef?.hasTo && (
              <Select
                value={trigger.to ?? ANY}
                onValueChange={(v) => setTrigger({ ...trigger, to: v === ANY ? undefined : v })}
              >
                <SelectTrigger>
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
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            2. Dan syarat (opsional)
          </h3>
          {conds.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
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
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_FIELDS.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={c.op}
                onValueChange={(v) =>
                  setConds(conds.map((x, j) => (j === i ? { ...x, op: v as Condition["op"] } : x)))
                }
              >
                <SelectTrigger className="h-9 w-24">
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
            onClick={() => setConds([...conds, { field: "priority", op: "eq", value: "high" }])}
          >
            <Plus /> Syarat
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            3. Maka
          </h3>
          {acts.map((a, i) => (
            <div key={i} className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <Select
                  value={a.type}
                  onValueChange={(v) => {
                    const t = v as Action["type"];
                    setAct(
                      i,
                      t === "set_field"
                        ? { type: t, field: "assignee_name", value: "" }
                        : t === "add_tag"
                          ? { type: t, value: "" }
                          : t === "shift_due"
                            ? { type: t, days: 1 }
                            : t === "webhook"
                              ? { type: t, url: "" }
                              : { type: t, text: "" },
                    );
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
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
                    <SelectTrigger className="h-9">
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
                  onChange={(e) => setAct(i, { ...a, value: e.target.value })}
                  placeholder="nama-tag"
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
                  onChange={(e) => setAct(i, { ...a, text: e.target.value })}
                  placeholder="Teks. Bisa pakai {{title}} {{status}} {{priority}} {{project}} {{assignee}} {{due}}"
                />
              )}
              {a.type === "webhook" && (
                <Input
                  className="h-9"
                  value={a.url}
                  onChange={(e) => setAct(i, { ...a, url: e.target.value })}
                  placeholder="https://hooks.slack.com/… atau URL n8n/Discord"
                />
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActs([...acts, { type: "comment", text: "" }])}
          >
            <Plus /> Aksi
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Telegram terkirim ke akun yang ditautkan di Pengaturan. Webhook mengirim data tugas
            (JSON) beserta teks ringkas, cocok untuk Slack/Discord.
          </p>
        </section>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-4">
        {rule?.id ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={remove}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={save}>Simpan</Button>
        </div>
      </div>
    </>
  );
}

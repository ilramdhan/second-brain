import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Field, TagInput } from "@/components/common/TagInput";
import { DemoExamples } from "@/components/demo/DemoExamples";
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
import { Textarea } from "@/components/ui/textarea";
import { isDemo } from "@/lib/app-mode";
import { draftNoteFromText } from "@/lib/capture.functions";
import { NOTE_FIELD_LABEL } from "@/lib/capture-fields";
import { NOTE_STATUS } from "@/lib/constants";
import { useNoteActions, useProjects } from "@/lib/data";
import { DEMO_NOTE_CAPTURE_EXAMPLES } from "@/lib/demo-examples";
import { toastError } from "@/lib/errors";
import { draftToForm, emptyNoteForm, formToInsert, type NoteForm } from "@/lib/note-prefill";
import { useI18n } from "@/lib/preferences";

const NONE = "none";
const MAX_TEXT = 4000;

/**
 * "Catatan dari teks": paste or describe a note, AI (or the local parser) fills title, content,
 * status, project, tags, pin and properties, the user reviews every field and saves. Nothing is
 * written before "Simpan catatan" (useNoteActions.create → index columns + note rules).
 */
export function NoteFromTextDialog({
  open,
  onOpenChange,
  projectId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {open && <NoteFromTextForm projectId={projectId} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NoteFromTextForm({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const demo = isDemo();
  const { data: projects = [] } = useProjects();
  const { create } = useNoteActions();
  const navigate = useNavigate();
  const draftFn = useServerFn(draftNoteFromText);
  const [text, setText] = useState(() => (demo ? DEMO_NOTE_CAPTURE_EXAMPLES[0]!.text : ""));
  const [form, setForm] = useState<NoteForm>(() => emptyNoteForm(projectId));
  const [filling, setFilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const set = <K extends keyof NoteForm>(key: K, value: NoteForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function fill() {
    if (!text.trim()) return;
    setFilling(true);
    try {
      const r = await draftFn({ data: { text: text.slice(0, MAX_TEXT) } });
      setForm(draftToForm(r.draft, projectId));
      const fields = r.filled.map((f) => NOTE_FIELD_LABEL[f] ?? f).join(", ");
      setSummary(
        [
          `${t(r.via === "ai" ? "noteFilledByAi" : "noteFilledByParser")}${fields ? `: ${fields}` : ""}`,
          r.dropped.length ? t("noteDropped", { items: r.dropped.join("; ") }) : "",
          t("noteReviewThenSave"),
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (err) {
      toastError(err, t("noteFillFailed"));
    } finally {
      setFilling(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const row = await create(formToInsert(form));
      if (!row) return;
      toast.success(t("noteCreated"));
      onClose();
      void navigate({ to: "/notes/$noteId", params: { noteId: row.id } });
    } catch (err) {
      toastError(err, t("noteSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("noteFromTextTitle")}</DialogTitle>
        <DialogDescription>{t("noteFromTextDescription")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_TEXT}
          rows={4}
          placeholder={t("noteFromTextPlaceholder")}
          aria-label={t("noteFromTextSourceLabel")}
        />
        <DemoExamples
          examples={DEMO_NOTE_CAPTURE_EXAMPLES}
          selected={DEMO_NOTE_CAPTURE_EXAMPLES.find((e) => e.text === text)?.key ?? null}
          onPick={(e) => setText(e.text)}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={fill}
          disabled={filling || !text.trim()}
        >
          {filling ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {t("noteFromTextFill")}
        </Button>
        {summary && (
          <p role="status" className="text-xs text-muted-foreground">
            {summary}
          </p>
        )}

        <div className="space-y-3 border-t pt-3">
          <Input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={t("noteTitle")}
            aria-label={t("noteTitle")}
            className="h-10 font-medium"
          />
          <Textarea
            value={form.content}
            onChange={(e) => set("content", e.target.value)}
            rows={8}
            placeholder={t("noteContentPlaceholder")}
            aria-label={t("noteContentLabel")}
            className="font-mono text-xs"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("noteStatus")}>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_STATUS.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("noteProject")}>
              <Select
                value={form.projectId ?? NONE}
                onValueChange={(v) => set("projectId", v === NONE ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noteNoProject")}</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("noteTag")}</span>
            <TagInput value={form.tags} onChange={(tags) => set("tags", tags)} />
          </div>
          {form.properties.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("noteProperties")}
              </span>
              {form.properties.map(([k, v], i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <Input
                    value={k}
                    aria-label={t("notePropertyName")}
                    onChange={(e) =>
                      set(
                        "properties",
                        form.properties.map((p, j) => (j === i ? [e.target.value, p[1]] : p)),
                      )
                    }
                  />
                  <Input
                    value={v}
                    aria-label={t("notePropertyValueOf", { name: k })}
                    onChange={(e) =>
                      set(
                        "properties",
                        form.properties.map((p, j) => (j === i ? [p[0], e.target.value] : p)),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.pinned} onCheckedChange={(v) => set("pinned", v)} />
            {t("notePin")}
          </label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("noteCancel")}
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {t("noteSave")}
        </Button>
      </DialogFooter>
    </>
  );
}

/** "Catatan dari teks" trigger + dialog in one (graph page header). */
export function NoteFromTextButton({ projectId = null }: { projectId?: string | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Sparkles /> {t("noteFromTextTitle")}
      </Button>
      <NoteFromTextDialog open={open} onOpenChange={setOpen} projectId={projectId} />
    </>
  );
}

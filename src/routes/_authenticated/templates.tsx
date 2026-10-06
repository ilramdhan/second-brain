import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckSquare, Plus, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { PRIORITY } from "@/lib/constants";
import { getUid, useNoteActions } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { toastError } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({
    meta: [
      { title: "Template — Second Brain" },
      { name: "description", content: "Template tugas dan catatan yang bisa dipakai ulang." },
      { property: "og:title", content: "Template — Second Brain" },
      {
        property: "og:description",
        content: "Template tugas dan catatan yang bisa dipakai ulang.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TemplatesPage,
  errorComponent: RouteError,
});

type Payload = {
  title?: string;
  body?: string;
  priority?: string;
  tags?: string[];
  estimate?: number;
};

function TemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { newTask } = useTaskDialog();
  const notes = useNoteActions();
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("templates").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });

  async function use(t: (typeof data)[number]) {
    const p = (t.payload ?? {}) as Payload;
    if (t.kind === "task")
      newTask({
        title: p.title ?? t.name,
        description: p.body ?? null,
        priority: p.priority ?? "medium",
        tags: p.tags ?? [],
        estimate_minutes: p.estimate ?? 25,
      });
    else {
      const body = p.body ?? "";
      const blocks = body
        .split("\n")
        .map((text) => ({ id: crypto.randomUUID(), type: "paragraph", text }));
      const row = await notes.create({
        title: p.title ?? t.name,
        content: body,
        tags: p.tags ?? [],
        blocks,
      });
      if (row) navigate({ to: "/notes/$noteId", params: { noteId: row.id } });
    }
  }
  async function remove(id: string) {
    if (!confirm("Hapus template ini?")) return;
    await supabase.from("templates").delete().eq("id", id);
    void qc.invalidateQueries({ queryKey: ["templates"] });
  }

  return (
    <PageContainer>
      <PageHeader
        title="Template"
        subtitle="Simpan pola tugas dan catatan yang sering dipakai, seperti notulen meeting atau daftar belanja."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Template
          </Button>
        }
      />
      {data.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          Belum ada template.
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void seed("note", "Notulen meeting", {
                  title: "Notulen: ",
                  body: "Peserta:\nAgenda:\nKeputusan:\nAction item:\nCatatan lain:",
                  tags: ["meeting"],
                })
              }
            >
              + Notulen meeting
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void seed("task", "Perbaiki bug", {
                  title: "Fix: ",
                  body: "Langkah reproduksi:\nHasil yang diharapkan:\nHasil aktual:",
                  priority: "high",
                  tags: ["bug"],
                  estimate: 50,
                })
              }
            >
              + Laporan bug
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => {
            const p = (t.payload ?? {}) as Payload;
            const Icon = t.kind === "task" ? CheckSquare : StickyNote;
            return (
              <article key={t.id} className="flex flex-col rounded-md border bg-card p-4">
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold">{t.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t.kind === "task" ? "Tugas" : "Catatan"}
                      {p.tags?.length ? ` · ${p.tags.map((x) => `#${x}`).join(" ")}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(t.id)}
                    aria-label="Hapus template"
                  >
                    <Trash2 />
                  </Button>
                </div>
                {p.body && (
                  <p className="mt-2 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">
                    {p.body}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-auto self-start pt-0"
                  style={{ marginTop: 12 }}
                  onClick={() => use(t)}
                >
                  Gunakan
                </Button>
              </article>
            );
          })}
        </div>
      )}
      <TemplateDialog
        open={open}
        onOpenChange={setOpen}
        onSave={async (kind, name, payload) => {
          await seed(kind, name, payload);
          setOpen(false);
        }}
      />
    </PageContainer>
  );

  async function seed(kind: "task" | "note", name: string, payload: Payload) {
    const user_id = await getUid();
    const { error } = await supabase.from("templates").insert({ user_id, kind, name, payload });
    if (error) toastError(error);
    else toast.success("Template disimpan");
    void qc.invalidateQueries({ queryKey: ["templates"] });
  }
}

function TemplateDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (kind: "task" | "note", name: string, p: Payload) => Promise<void>;
}) {
  const [kind, setKind] = useState<"task" | "note">("task");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("medium");
  const [tags, setTags] = useState("");
  const [estimate, setEstimate] = useState(25);
  async function save() {
    if (!name.trim()) {
      toast.error("Beri nama template");
      return;
    }
    await onSave(kind, name.trim(), {
      title,
      body,
      tags: tags
        .split(/[,\s]+/)
        .map((x) => x.replace(/^#/, ""))
        .filter(Boolean),
      ...(kind === "task" ? { priority, estimate } : {}),
    });
    setName("");
    setTitle("");
    setBody("");
    setTags("");
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Template baru</DialogTitle>
          <DialogDescription>
            Isi yang akan otomatis terisi saat template dipakai.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as "task" | "note")}>
              <SelectTrigger aria-label="Jenis template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task">Tugas</SelectItem>
                <SelectItem value="note">Catatan</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama template"
              aria-label="Nama template"
            />
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Judul awal (opsional)"
            aria-label="Judul awal"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={kind === "task" ? "Deskripsi / checklist" : "Isi catatan"}
            rows={6}
            className="min-h-32"
            aria-label={kind === "task" ? "Deskripsi tugas" : "Isi catatan"}
          />
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tag, pisahkan dengan koma"
            aria-label="Tag"
          />
          {kind === "task" && (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-2">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger aria-label="Prioritas">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={5}
                step={5}
                value={estimate}
                onChange={(e) => setEstimate(Number(e.target.value))}
                aria-label="Estimasi menit"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={save}>Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

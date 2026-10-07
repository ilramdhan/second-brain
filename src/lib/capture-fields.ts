// Indonesian labels for the task fields a capture filled (client-safe; mirrors FilledField in
// src/server/taskExtract.server.ts).
export const FIELD_LABEL: Record<string, string> = {
  description: "deskripsi",
  status: "status",
  priority: "prioritas",
  project: "proyek",
  start: "mulai",
  due: "tenggat",
  estimate: "estimasi",
  assignee: "penanggung jawab",
  tags: "tag",
  dependencies: "dependensi",
  comments: "komentar",
  recurrence: "pengulangan",
};

// Labels for the note fields a capture filled (mirrors NoteFilledField in
// src/server/noteExtract.server.ts).
export const NOTE_FIELD_LABEL: Record<string, string> = {
  content: "isi",
  status: "status",
  project: "proyek",
  tags: "tag",
  links: "tautan",
  pinned: "disematkan",
  properties: "properti",
};

// Labels for the "Isi dari teks" project / template forms (ProjectFilledField and
// TemplateFilledField in src/server/formPrefill.server.ts).
export const PROJECT_FIELD_LABEL: Record<string, string> = {
  description: "deskripsi",
  para: "kategori PARA",
  status: "status",
  color: "warna",
  parent: "induk",
  start: "mulai",
  due: "tenggat",
  launch: "launch date",
  members: "anggota",
};

export const TEMPLATE_FIELD_LABEL: Record<string, string> = {
  kind: "jenis",
  title: "judul awal",
  body: "isi",
  tags: "tag",
  priority: "prioritas",
  estimate: "estimasi",
};

export type FillResult = {
  via: "ai" | "regex";
  filled: string[];
  dropped: string[];
};

/** "Diisi AI: proyek, tag · Diabaikan: … · Periksa lalu simpan." */
export function fillSummary(r: FillResult, labels: Record<string, string>, extra: string[] = []) {
  const fields = r.filled.map((f) => labels[f] ?? f).join(", ");
  return [
    `${r.via === "ai" ? "Diisi AI" : "Diisi parser lokal"}${fields ? `: ${fields}` : ""}`,
    r.dropped.length ? `Diabaikan: ${r.dropped.join("; ")}` : "",
    ...extra,
    "Periksa lalu simpan.",
  ]
    .filter(Boolean)
    .join(" · ");
}

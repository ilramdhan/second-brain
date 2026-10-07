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

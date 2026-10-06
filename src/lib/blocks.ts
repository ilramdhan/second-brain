import type { Note, NoteBlocks, NoteSummary, Task } from "@/lib/data";

export type BlockType =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "todo"
  | "bullet"
  | "numbered"
  | "quote"
  | "code"
  | "divider"
  | "query"
  | "embed";
export type Block = { id: string; type: BlockType; text: string; checked?: boolean };

export const BLOCK_TYPES: { id: BlockType; label: string; hint: string; keys: string[] }[] = [
  { id: "p", label: "Teks", hint: "Paragraf biasa", keys: ["text", "teks", "p"] },
  { id: "h1", label: "Judul 1", hint: "#", keys: ["h1", "heading", "judul"] },
  { id: "h2", label: "Judul 2", hint: "##", keys: ["h2", "heading2", "subjudul"] },
  { id: "h3", label: "Judul 3", hint: "###", keys: ["h3"] },
  { id: "todo", label: "To-do", hint: "[] checkbox", keys: ["todo", "checkbox", "tugas"] },
  { id: "bullet", label: "Daftar", hint: "- poin", keys: ["bullet", "list", "daftar"] },
  { id: "numbered", label: "Daftar bernomor", hint: "1.", keys: ["numbered", "nomor"] },
  { id: "quote", label: "Kutipan", hint: ">", keys: ["quote", "kutipan"] },
  { id: "code", label: "Kode", hint: "```", keys: ["code", "kode"] },
  { id: "divider", label: "Pemisah", hint: "---", keys: ["divider", "garis", "hr"] },
  {
    id: "query",
    label: "Query / tabel dinamis",
    hint: "TABLE … FROM #tag WHERE …",
    keys: ["query", "table", "database", "dataview"],
  },
  {
    id: "embed",
    label: "Sematkan blok",
    hint: "cermin blok lain",
    keys: ["embed", "ref", "sematkan"],
  },
];

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Markdown-shortcut prefixes typed at the start of a block. */
export function shortcut(
  text: string,
): { type: BlockType; text: string; checked?: boolean } | null {
  // Checked todos first: "- [x] t" (what toMarkdown writes) would otherwise hit the bullet rule.
  const done = /^(?:[-*]\s?|\s)?\[x\]\s/i.exec(text);
  if (done) return { type: "todo", text: text.slice(done[0].length), checked: true };
  const rules: [RegExp, BlockType][] = [
    [/^###\s/, "h3"],
    [/^##\s/, "h2"],
    [/^#\s/, "h1"],
    [/^\[\s?\]\s/, "todo"],
    [/^[-*]\s\[\s?\]\s/, "todo"],
    [/^[-*]\s/, "bullet"],
    [/^1[.)]\s/, "numbered"],
    [/^>\s/, "quote"],
    [/^```$/, "code"],
    [/^---$/, "divider"],
  ];
  for (const [re, type] of rules) if (re.test(text)) return { type, text: text.replace(re, "") };
  return null;
}

function fromLine(line: string): Block {
  const m = /\s\^([a-z0-9]{6,10})$/.exec(line);
  const id = m ? m[1]! : newId();
  const text = m ? line.slice(0, m.index) : line;
  const q = /^\{\{query (.*)\}\}$/.exec(text);
  if (q) return { id, type: "query", text: q[1]! };
  const e = /^\{\{embed \(\((\w+)\)\)\}\}$/.exec(text);
  if (e) return { id, type: "embed", text: e[1]! };
  const s = shortcut(text);
  return s ? { id, ...s } : { id, type: "p", text };
}

/** Normalises stored blocks; converts legacy plain-text content into blocks. */
export function loadBlocks(note: Pick<Note, "blocks" | "content">): Block[] {
  const raw = Array.isArray(note.blocks) ? (note.blocks as unknown as Block[]) : [];
  if (raw.length) return raw.map((b) => (b.type === "p" ? { ...fromLine(b.text), id: b.id } : b));
  const lines = (note.content ?? "").split("\n").filter((l) => l.trim());
  return lines.length ? lines.map(fromLine) : [{ id: newId(), type: "p", text: "" }];
}

export function toMarkdown(blocks: Block[]): string {
  let n = 0;
  return blocks
    .map((b) => {
      n = b.type === "numbered" ? n + 1 : 0;
      const t = b.text;
      switch (b.type) {
        case "h1":
          return `# ${t}`;
        case "h2":
          return `## ${t}`;
        case "h3":
          return `### ${t}`;
        case "todo":
          return `- [${b.checked ? "x" : " "}] ${t}`;
        case "bullet":
          return `- ${t}`;
        case "numbered":
          return `${n}. ${t}`;
        case "quote":
          return `> ${t}`;
        case "code":
          return "```\n" + t + "\n```";
        case "divider":
          return "---";
        case "query":
          return `{{query ${t}}}`;
        case "embed":
          return `{{embed ((${t}))}}`;
        default:
          return t;
      }
    })
    .join("\n");
}

/* ---------- links ---------- */
export const WIKI_RE = /\[\[([^\]\n]+?)\]\]/g;
export const REF_RE = /\(\(([a-z0-9]{6,10})\)\)/g;

export function linksOf(blocks: Block[]) {
  const titles = new Set<string>();
  const refs = new Set<string>();
  for (const b of blocks) {
    for (const m of b.text.matchAll(WIKI_RE)) titles.add(m[1]!.split("|")[0]!.trim().toLowerCase());
    for (const m of b.text.matchAll(REF_RE)) refs.add(m[1]!);
    if (b.type === "embed") refs.add(b.text);
  }
  return { titles, refs };
}

/** Length of `notes.excerpt`, in characters (code points, like Postgres `left()`). */
export const EXCERPT_LENGTH = 200;

/** First EXCERPT_LENGTH characters of the markdown mirror, for list previews. */
export function excerptOf(content: string): string {
  const chars = Array.from(content);
  return chars.length <= EXCERPT_LENGTH ? content : chars.slice(0, EXCERPT_LENGTH).join("");
}

/**
 * Derived columns stored next to `blocks` on every save (migration 0018): the lower-cased
 * `[[titles]]` this note links to, the block ids it references or embeds, and the list excerpt.
 * Backlinks are then a GIN-indexed `links @> {title}` / `refs && {ids}` query in Postgres.
 */
export function noteIndexFields(blocks: Block[], content = toMarkdown(blocks)) {
  const { titles, refs } = linksOf(blocks);
  return { links: [...titles], refs: [...refs], excerpt: excerptOf(content) };
}

/**
 * Adds `content` (if missing), `links`, `refs` and `excerpt` to a note insert/update that
 * writes `blocks` or `content`. Other patches (pin, status, tags...) are returned unchanged.
 */
export function withNoteIndex<T extends { blocks?: unknown; content?: string }>(
  row: T,
): T & { content?: string; links?: string[]; refs?: string[]; excerpt?: string } {
  if (!("blocks" in row) && !("content" in row)) return row;
  const blocks = loadBlocks({
    blocks: (row.blocks ?? []) as Note["blocks"],
    content: row.content ?? "",
  });
  const content = row.content ?? toMarkdown(blocks);
  return { ...row, content, ...noteIndexFields(blocks, content) };
}

type IndexedNote = Pick<NoteBlocks, "id" | "title" | "blocks" | "content">;
export type BlockIndex = Map<string, { note: IndexedNote; block: Block }>;
// One index per notes array: the note page, the block editor and the graph all receive the same
// `useNoteBlocks()` array, so the index is built once per fetch instead of once per component.
const blockIndexCache = new WeakMap<readonly IndexedNote[], BlockIndex>();
export function indexBlocks(notes: readonly IndexedNote[]): BlockIndex {
  const cached = blockIndexCache.get(notes);
  if (cached) return cached;
  const idx: BlockIndex = new Map();
  for (const n of notes) for (const b of loadBlocks(n)) idx.set(b.id, { note: n, block: b });
  blockIndexCache.set(notes, idx);
  return idx;
}

/** Edges note→note from [[wikilinks]] and ((block refs)). */
export function noteGraph(notes: IndexedNote[]) {
  const byTitle = new Map(notes.map((n) => [n.title.trim().toLowerCase(), n]));
  const idx = indexBlocks(notes);
  const edges: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    const { titles, refs } = linksOf(loadBlocks(n));
    const targets = [
      ...[...titles].map((t) => byTitle.get(t)?.id),
      ...[...refs].map((r) => idx.get(r)?.note.id),
    ];
    for (const t of targets) {
      if (!t || t === n.id) continue;
      const k = `${n.id}>${t}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ source: n.id, target: t });
    }
  }
  return edges;
}

/* ---------- inline query engine ---------- */
export type QueryResult = {
  mode: "table" | "list";
  source: "notes" | "tasks";
  columns: string[];
  rows: { id: string; title: string; values: Record<string, unknown> }[];
  error?: string;
};

type Cond = { field: string; op: string; value: string };

function fieldOf(
  item: Record<string, unknown>,
  props: Record<string, unknown>,
  f: string,
): unknown {
  if (f in props) return props[f];
  if (f === "created") return item["created_at"];
  if (f === "updated") return item["updated_at"];
  if (f === "due") return item["due_date"];
  return item[f];
}

function cmp(a: unknown, op: string, b: string) {
  if (Array.isArray(a)) {
    const has = a.map((x) => String(x).toLowerCase()).includes(b.toLowerCase().replace(/^#/, ""));
    return op === "!=" ? !has : has;
  }
  const na = Number(a),
    nb = Number(b);
  const numeric =
    a !== null && a !== undefined && a !== "" && !Number.isNaN(na) && !Number.isNaN(nb);
  const sa = String(a ?? "").toLowerCase(),
    sb = b.toLowerCase();
  switch (op) {
    case ">":
      return numeric ? na > nb : sa > sb;
    case "<":
      return numeric ? na < nb : sa < sb;
    case ">=":
      return numeric ? na >= nb : sa >= sb;
    case "<=":
      return numeric ? na <= nb : sa <= sb;
    case "!=":
      return numeric ? na !== nb : sa !== sb;
    case "contains":
      return sa.includes(sb);
    default:
      return numeric ? na === nb : sa === sb;
  }
}

/**
 * Syntax (Dataview-like):
 *   TABLE rating, genre FROM #buku WHERE rating > 4 AND genre = fiksi SORT rating DESC LIMIT 10
 *   LIST FROM "Nama Proyek" | FROM tasks WHERE status != done
 */
export function runQuery(
  q: string,
  notes: NoteSummary[],
  tasks: Task[],
  projects: { id: string; name: string }[],
): QueryResult {
  const src = q.trim();
  const m =
    /^(TABLE|LIST)\b\s*(.*?)\s*(?:\bFROM\s+(.+?))?\s*(?:\bWHERE\s+(.+?))?\s*(?:\bSORT\s+(\w+)(?:\s+(ASC|DESC))?)?\s*(?:\bLIMIT\s+(\d+))?\s*$/i.exec(
      src,
    );
  if (!m)
    return {
      mode: "list",
      source: "notes",
      columns: [],
      rows: [],
      error: "Format: TABLE kolom1, kolom2 FROM #tag WHERE kolom > 3 SORT kolom DESC",
    };
  const mode = m[1]!.toLowerCase() as "table" | "list";
  const columns =
    mode === "table"
      ? m[2]!
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
  const from = (m[3] ?? "").trim();
  const where: Cond[] = (m[4] ?? "")
    .split(/\s+AND\s+/i)
    .filter(Boolean)
    .map((c) => {
      const x = /^(\w+)\s*(>=|<=|!=|>|<|=|contains)\s*"?(.*?)"?$/i.exec(c.trim());
      return x
        ? { field: x[1]!, op: x[2]!.toLowerCase(), value: x[3]! }
        : { field: "", op: "", value: "" };
    });
  if (where.some((w) => !w.field))
    return { mode, source: "notes", columns, rows: [], error: "Syarat WHERE tidak dikenali" };

  const isTasks = /^tasks?$/i.test(from) || /^tugas$/i.test(from);
  let items: {
    id: string;
    title: string;
    item: Record<string, unknown>;
    props: Record<string, unknown>;
  }[] = isTasks
    ? tasks
        .filter((t) => !t.parent_id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          item: t as unknown as Record<string, unknown>,
          props: {},
        }))
    : notes.map((n) => ({
        id: n.id,
        title: n.title,
        item: n as unknown as Record<string, unknown>,
        props: (n.properties as Record<string, unknown>) ?? {},
      }));

  if (!isTasks && from) {
    for (const part of from.split(/\s+OR\s+/i).length > 1 ? [from] : [from]) {
      const ors = part.split(/\s+OR\s+/i).map((s) => s.trim());
      items = items.filter(({ item }) =>
        ors.some((o) => {
          if (o.startsWith("#"))
            return ((item["tags"] as string[]) ?? [])
              .map((t) => t.toLowerCase())
              .includes(o.slice(1).toLowerCase());
          const name = o.replace(/^"|"$/g, "").toLowerCase();
          const p = projects.find((x) => x.name.toLowerCase() === name);
          return p ? item["project_id"] === p.id : false;
        }),
      );
    }
  }
  items = items.filter(({ item, props }) =>
    where.every((w) => cmp(fieldOf(item, props, w.field), w.op, w.value)),
  );
  if (m[5]) {
    const f = m[5];
    const dir = (m[6] ?? "ASC").toUpperCase() === "DESC" ? -1 : 1;
    items.sort((a, b) => {
      const va = fieldOf(a.item, a.props, f),
        vb = fieldOf(b.item, b.props, f);
      const na = Number(va),
        nb = Number(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
    });
  }
  if (m[7]) items = items.slice(0, Number(m[7]));
  return {
    mode,
    source: isTasks ? "tasks" : "notes",
    columns,
    rows: items.map(({ id, title, item, props }) => ({
      id,
      title,
      values: Object.fromEntries(columns.map((c) => [c, fieldOf(item, props, c)])),
    })),
  };
}

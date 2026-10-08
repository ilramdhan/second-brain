// Seed data for the public demo (Phase 10). Pure: `buildDemoSeed` returns plain rows and never
// touches the database, so it is unit-tested (seed-data.test.ts) and inserted by
// seed.server.ts (`resetDemo`) through the service role.
//
// Design rules:
//   * Every authenticated page has something to show: today, inbox, tasks (list, kanban,
//     calendar, timeline), projects (+ members, milestones), notes (links, refs, queries,
//     backlinks, graph), canvas, automations (+ run history), reports (8 weeks of focus time
//     and completed work, burndown per project/milestone), habits (6 weeks of check-ins),
//     templates, archive + trash and the activity log.
//   * Dates are relative to the reset day (`today`, a calendar date in APP_TIMEZONE), so the
//     demo never shows stale deadlines. Times of day are local (default Asia/Jakarta).
//   * Ids are deterministic (a hash of the demo user id and a stable key), so a reset produces
//     the same ids every day and tests can assert on them. Block ids are hashes too.
//   * Every table's rows have the same keys: PostgREST bulk inserts use the union of keys and
//     would turn a missing key into NULL instead of the column default.
//   * Inbox items, the meeting notes and the project names come from src/lib/demo-examples.ts,
//     so the simulated AI (src/server/demo/ai-fixtures.server.ts) answers them with its polished
//     fixtures.
//   * Notes go through `toMarkdown` / `noteIndexFields` like every other note writer (0018).
import { createHash } from "node:crypto";

import type { Json, TablesInsert } from "@/integrations/supabase/types";
import { noteIndexFields, shortcut, toMarkdown, type Block, type BlockType } from "@/lib/blocks";
import { serializeRunDetail, type RunStep } from "@/lib/automation-run-detail";
import { nextRun } from "@/lib/cron";
import {
  DEMO_BRAIN_DUMP_EXAMPLES,
  DEMO_INBOX_ITEMS,
  DEMO_MEETING_EXAMPLES,
  DEMO_MEETING_NOTE,
  DEMO_PARAPHRASE_EXAMPLES,
  DEMO_PROJECT_NAMES,
} from "@/lib/demo-examples";

export const DEMO_DISPLAY_NAME = "Demo";

/** Extra demo-only accounts shown as project members (they never sign in). */
export const DEMO_TEAMMATES = [
  { key: "rina", name: "Rina", email: "rina.demo@example.com" },
  { key: "budi", name: "Budi", email: "budi.demo@example.com" },
] as const;
export type DemoTeammateKey = (typeof DEMO_TEAMMATES)[number]["key"];

export type DemoSeedInput = {
  userId: string;
  /** Reset day, `YYYY-MM-DD` in `tz`. */
  today: string;
  /** IANA zone for times of day (default Asia/Jakarta). */
  tz?: string;
  /** Auth user ids of the demo teammates; without them the seed has no project members. */
  teammates?: Partial<Record<DemoTeammateKey, string>>;
};

export type DemoSeed = {
  profile: { display_name: string; telegram_chat_id: null; telegram_username: null };
  projects: TablesInsert<"projects">[];
  project_members: TablesInsert<"project_members">[];
  milestones: TablesInsert<"milestones">[];
  tasks: TablesInsert<"tasks">[];
  task_dependencies: TablesInsert<"task_dependencies">[];
  task_comments: TablesInsert<"task_comments">[];
  time_entries: TablesInsert<"time_entries">[];
  habits: TablesInsert<"habits">[];
  habit_logs: TablesInsert<"habit_logs">[];
  notes: TablesInsert<"notes">[];
  note_versions: TablesInsert<"note_versions">[];
  inbox_items: TablesInsert<"inbox_items">[];
  templates: TablesInsert<"templates">[];
  automations: TablesInsert<"automations">[];
  automation_runs: TablesInsert<"automation_runs">[];
  canvas_boards: TablesInsert<"canvas_boards">[];
  canvas_nodes: TablesInsert<"canvas_nodes">[];
  canvas_edges: TablesInsert<"canvas_edges">[];
  activity_logs: TablesInsert<"activity_logs">[];
};

export type DemoSeedTable = Exclude<keyof DemoSeed, "profile">;

/**
 * Insert order (parents before children). `activity_logs` comes last: the reset deletes the
 * audit rows the inserts themselves produce and then writes this curated history.
 */
export const DEMO_SEED_INSERT_ORDER: readonly DemoSeedTable[] = [
  "projects",
  "project_members",
  "milestones",
  "tasks",
  "task_dependencies",
  "task_comments",
  "time_entries",
  "habits",
  "habit_logs",
  "notes",
  "note_versions",
  "inbox_items",
  "templates",
  "automations",
  "automation_runs",
  "canvas_boards",
  "canvas_nodes",
  "canvas_edges",
  "activity_logs",
];

/* ---------------- ids and dates ---------------- */

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Deterministic uuid (RFC 4122 layout, version nibble 5) from sha256 of the user id and `key`. */
export function demoUuid(userId: string, key: string): string {
  const h = hash(`second-brain-demo:${userId}:${key}`);
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Deterministic block id (8 hex chars, matches REF_RE). */
export const demoBlockId = (key: string) => hash(`second-brain-demo-block:${key}`).slice(0, 8);

function offsetMs(instant: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function clock(today: string, tz: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) throw new Error(`demo seed: invalid date "${today}" (expected YYYY-MM-DD)`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  /** Calendar date `days` from today. */
  const day = (days: number) => new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
  /** ISO instant of local `hh:mm` on the day `days` from today. */
  const at = (days: number, hh = 17, mm = 0) => {
    const wall = Date.UTC(y, mo - 1, d + days, hh, mm);
    return new Date(wall - offsetMs(wall, tz)).toISOString();
  };
  /** Weekday of today, 0 = Sunday. */
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { day, at, weekday };
}

/* ---------------- notes ---------------- */

type BlockSpec = string | { type: BlockType; text: string; checked?: boolean; key?: string };

/**
 * Builds blocks with stable ids. Strings use the editor's markdown shortcuts ("- ", "## ",
 * "[ ] ", "[x] "...); objects give the type explicitly and may name the block (`key`) so other
 * notes can reference it with `((id))`.
 */
function blocks(noteKey: string, specs: BlockSpec[]): Block[] {
  return specs.map((spec, i) => {
    const id = demoBlockId(
      typeof spec === "string" || !spec.key ? `${noteKey}#${i}` : `ref:${spec.key}`,
    );
    if (typeof spec !== "string") {
      return spec.checked === undefined
        ? { id, type: spec.type, text: spec.text }
        : { id, type: spec.type, text: spec.text, checked: spec.checked };
    }
    const s = shortcut(spec);
    if (!s) return { id, type: "p", text: spec };
    return s.checked === undefined
      ? { id, type: s.type, text: s.text }
      : { id, type: s.type, text: s.text, checked: s.checked };
  });
}

/** Block id of a named block (`{ key }` in a BlockSpec). */
export const refId = (key: string) => demoBlockId(`ref:${key}`);

/* ---------------- builder ---------------- */

export function buildDemoSeed(input: DemoSeedInput): DemoSeed {
  const { userId } = input;
  const tz = input.tz ?? "Asia/Jakarta";
  const { day, at, weekday } = clock(input.today, tz);
  const id = (key: string) => demoUuid(userId, key);
  const mate = (key: DemoTeammateKey) => input.teammates?.[key] ?? null;
  const [KASIR, WEBSITE] = DEMO_PROJECT_NAMES;

  /* projects */
  type ProjectSpec = {
    key: string;
    name: string;
    description: string;
    color: string;
    para_type: "project" | "area" | "resource" | "archive";
    status: "planning" | "active" | "on_hold" | "done";
    start?: number;
    due?: number;
    launch?: number;
    parent?: string;
    deleted?: number;
    created: number;
  };
  const projectSpecs: ProjectSpec[] = [
    {
      key: "kasir",
      name: KASIR,
      description: "Aplikasi kasir (POS) untuk toko: transaksi, struk, stok dan laporan.",
      color: "blue",
      para_type: "project",
      status: "active",
      start: -24,
      due: 21,
      launch: 28,
      created: -30,
    },
    {
      key: "website",
      name: WEBSITE,
      description: "Toko online: katalog, checkout cepat di HP dan blog promo.",
      color: "teal",
      para_type: "project",
      status: "active",
      start: -14,
      due: 35,
      created: -20,
    },
    {
      key: "kampanye",
      name: "Kampanye Akhir Bulan",
      description: "Sub-proyek Website Toko: promo, artikel blog dan banner.",
      color: "violet",
      para_type: "project",
      status: "planning",
      start: 3,
      due: 24,
      parent: "website",
      created: -6,
    },
    {
      key: "renovasi",
      name: "Renovasi Dapur",
      description: "Ditunda sampai anggaran kuartal depan cair.",
      color: "rose",
      para_type: "project",
      status: "on_hold",
      start: 20,
      due: 75,
      created: -40,
    },
    {
      key: "sehat",
      name: "Kesehatan & Olahraga",
      description: "Area berkelanjutan: olahraga rutin, tidur cukup, cek kesehatan.",
      color: "green",
      para_type: "area",
      status: "active",
      created: -60,
    },
    {
      key: "belajar",
      name: "Belajar TypeScript",
      description: "Referensi dan catatan belajar.",
      color: "amber",
      para_type: "resource",
      status: "active",
      created: -50,
    },
    {
      key: "v1",
      name: "Rilis Kasir v1",
      description: "Selesai dan diarsipkan.",
      color: "slate",
      para_type: "archive",
      status: "done",
      start: -120,
      due: -70,
      launch: -70,
      created: -130,
    },
    {
      key: "batal",
      name: "Aplikasi Absensi (batal)",
      description: "Dibatalkan; ada di tempat sampah.",
      color: "slate",
      para_type: "project",
      status: "planning",
      deleted: -5,
      created: -45,
    },
  ];
  const projects: TablesInsert<"projects">[] = projectSpecs.map((p, i) => ({
    id: id(`project:${p.key}`),
    user_id: userId,
    name: p.name,
    description: p.description,
    color: p.color,
    para_type: p.para_type,
    status: p.status,
    start_date: p.start === undefined ? null : day(p.start),
    due_date: p.due === undefined ? null : day(p.due),
    launch_date: p.launch === undefined ? null : day(p.launch),
    parent_id: p.parent ? id(`project:${p.parent}`) : null,
    position: i,
    deleted_at: p.deleted === undefined ? null : at(p.deleted, 10),
    created_at: at(p.created, 9),
    updated_at: at(Math.max(p.created, -2), 9),
  }));
  const project = (key: string) => id(`project:${key}`);

  /* members (only when the teammate accounts exist) */
  const memberSpecs: [string, DemoTeammateKey][] = [
    ["kasir", "rina"],
    ["kasir", "budi"],
    ["website", "rina"],
  ];
  const project_members: TablesInsert<"project_members">[] = memberSpecs.flatMap(([p, m]) => {
    const uid = mate(m);
    return uid
      ? [
          {
            id: id(`member:${p}:${m}`),
            project_id: project(p),
            user_id: uid,
            role: "member",
            created_at: at(-12, 10),
          },
        ]
      : [];
  });

  /* milestones */
  const milestoneSpecs = [
    { key: "beta", p: "kasir", title: "Beta internal", due: -6, done: true },
    { key: "laporan", p: "kasir", title: "Laporan harian siap", due: 4, done: false },
    { key: "v2", p: "kasir", title: "Rilis v2 ke toko pilot", due: 18, done: false },
    { key: "checkout", p: "website", title: "Checkout < 2 detik di HP", due: 10, done: false },
    { key: "promo", p: "kampanye", title: "Promo tayang", due: 24, done: false },
  ];
  const milestones: TablesInsert<"milestones">[] = milestoneSpecs.map((m) => ({
    id: id(`milestone:${m.key}`),
    user_id: userId,
    project_id: project(m.p),
    title: m.title,
    description: null,
    due_date: day(m.due),
    done: m.done,
    created_at: at(-20, 9),
  }));
  const milestone = (key: string) => id(`milestone:${key}`);

  /* tasks */
  type TaskSpec = {
    key: string;
    title: string;
    description?: string;
    status?: "todo" | "in_progress" | "review" | "done";
    priority?: "high" | "medium" | "low";
    project?: string;
    milestone?: string;
    parent?: string;
    tags?: string[];
    /** Start day offset (and optional local hour/minute). */
    start?: number;
    startTime?: [number, number];
    /** Due day offset (and optional local hour/minute; default 17:00). */
    due?: number;
    dueTime?: [number, number];
    /** Local end time of a time block on the start day. */
    blockEnd?: [number, number];
    estimate?: number;
    recurrence?: "daily" | "weekly" | "monthly";
    assignee?: DemoTeammateKey | "me";
    completed?: number;
    archived?: number;
    deleted?: number;
    created?: number;
  };
  const nextSunday = (7 - weekday) % 7 || 7;
  const taskSpecs: TaskSpec[] = [
    // Aplikasi Kasir: kanban in every column, a dependency chain, subtasks.
    {
      key: "bug-struk",
      title: "Perbaiki bug struk tidak tercetak di printer Bluetooth",
      description:
        "Terjadi di printer 58 mm setelah idle > 5 menit. Lihat catatan [[Printer Bluetooth ESC/POS]].",
      status: "in_progress",
      priority: "high",
      project: "kasir",
      milestone: "v2",
      tags: ["bug", "printer"],
      start: -2,
      due: 1,
      estimate: 120,
      assignee: "budi",
    },
    {
      key: "bug-struk-log",
      title: "Kumpulkan log koneksi printer",
      status: "done",
      priority: "high",
      project: "kasir",
      parent: "bug-struk",
      tags: ["bug"],
      due: -1,
      completed: -1,
      estimate: 30,
    },
    {
      key: "bug-struk-retry",
      title: "Tambah reconnect otomatis",
      status: "todo",
      priority: "high",
      project: "kasir",
      parent: "bug-struk",
      tags: ["bug"],
      due: 1,
      estimate: 60,
    },
    {
      key: "skema-laporan",
      title: "Desain skema database laporan",
      status: "done",
      priority: "medium",
      project: "kasir",
      milestone: "laporan",
      tags: ["laporan", "database"],
      start: -10,
      due: -6,
      completed: -6,
      estimate: 90,
    },
    {
      key: "api-laporan",
      title: "API laporan penjualan harian",
      description: "Total transaksi, omzet dan produk terlaris per hari.",
      status: "in_progress",
      priority: "medium",
      project: "kasir",
      milestone: "laporan",
      tags: ["laporan", "fitur"],
      start: -5,
      due: 2,
      estimate: 240,
      assignee: "me",
    },
    {
      key: "ui-laporan",
      title: "Halaman laporan penjualan harian",
      status: "todo",
      priority: "medium",
      project: "kasir",
      milestone: "laporan",
      tags: ["laporan", "fitur"],
      start: 2,
      due: 4,
      estimate: 180,
      assignee: "rina",
    },
    {
      key: "qa-laporan",
      title: "QA laporan harian",
      status: "todo",
      priority: "low",
      project: "kasir",
      milestone: "laporan",
      tags: ["qa"],
      start: 4,
      due: 5,
      estimate: 60,
    },
    {
      key: "export-stok",
      title: "Export data stok ke Excel",
      description: "Permintaan Rina: unduh daftar stok untuk rekap gudang.",
      status: "review",
      priority: "medium",
      project: "kasir",
      tags: ["fitur", "follow-up"],
      start: -3,
      due: 0,
      estimate: 90,
      assignee: "rina",
    },
    {
      key: "rilis-pilot",
      title: "Rilis v2 ke toko pilot",
      status: "todo",
      priority: "high",
      project: "kasir",
      milestone: "v2",
      tags: ["rilis"],
      start: 16,
      due: 18,
      estimate: 120,
    },
    {
      key: "qris",
      title: "Riset integrasi pembayaran QRIS",
      status: "todo",
      priority: "low",
      project: "kasir",
      tags: ["riset", "pembayaran"],
      start: 8,
      due: 14,
      estimate: 120,
    },
    {
      key: "demo-klien",
      title: "Demo aplikasi kasir ke klien",
      status: "todo",
      priority: "high",
      project: "kasir",
      tags: ["meeting"],
      due: 6,
      dueTime: [10, 0],
      estimate: 60,
    },
    {
      key: "beta-checklist",
      title: "Checklist beta internal",
      status: "done",
      priority: "medium",
      project: "kasir",
      milestone: "beta",
      tags: ["rilis"],
      start: -9,
      due: -6,
      completed: -7,
    },
    // Website Toko
    {
      key: "audit-lighthouse",
      title: "Audit Lighthouse halaman checkout",
      status: "done",
      priority: "medium",
      project: "website",
      milestone: "checkout",
      tags: ["performa"],
      start: -8,
      due: -4,
      completed: -4,
    },
    {
      key: "kompres-gambar",
      title: "Kompres gambar halaman checkout ke WebP",
      description: "Lihat [[Kompres gambar WebP]].",
      status: "in_progress",
      priority: "high",
      project: "website",
      milestone: "checkout",
      tags: ["performa"],
      start: -3,
      due: 3,
      estimate: 120,
      assignee: "rina",
    },
    {
      key: "lazy-load",
      title: "Lazy-load gambar katalog",
      status: "todo",
      priority: "medium",
      project: "website",
      milestone: "checkout",
      tags: ["performa"],
      start: 3,
      due: 8,
      estimate: 90,
    },
    {
      key: "seo",
      title: "Perbaiki meta description produk",
      status: "review",
      priority: "low",
      project: "website",
      tags: ["seo"],
      due: 2,
      estimate: 45,
    },
    {
      key: "ssl",
      title: "Perpanjang sertifikat domain",
      status: "todo",
      priority: "high",
      project: "website",
      tags: ["ops"],
      due: -2,
      estimate: 15,
    },
    // Kampanye (sub-project)
    {
      key: "artikel-promo",
      title: "Tulis artikel blog promo akhir bulan",
      status: "todo",
      priority: "medium",
      project: "kampanye",
      milestone: "promo",
      tags: ["konten"],
      start: 5,
      due: 12,
      estimate: 120,
    },
    {
      key: "banner",
      title: "Desain banner promo",
      status: "todo",
      priority: "medium",
      project: "kampanye",
      milestone: "promo",
      tags: ["desain"],
      start: 10,
      due: 16,
      estimate: 90,
      assignee: "rina",
    },
    {
      key: "jadwal-sosmed",
      title: "Jadwalkan posting media sosial",
      status: "todo",
      priority: "low",
      project: "kampanye",
      tags: ["konten"],
      start: 17,
      due: 23,
    },
    // Renovasi (on hold)
    {
      key: "ukur-dapur",
      title: "Ukur ulang dapur dan buat sketsa",
      status: "todo",
      priority: "low",
      project: "renovasi",
      tags: ["rumah"],
      start: 21,
      due: 28,
    },
    // Kesehatan: recurring tasks and a time block today.
    {
      key: "olahraga",
      title: "Olahraga pagi 30 menit",
      status: "todo",
      priority: "medium",
      project: "sehat",
      tags: ["rutin"],
      start: 0,
      startTime: [6, 0],
      blockEnd: [6, 30],
      due: 0,
      dueTime: [6, 30],
      estimate: 30,
      recurrence: "daily",
    },
    {
      key: "review-mingguan",
      title: "Review mingguan",
      description: "Tutup inbox, cek kalender minggu depan, pilih 3 prioritas.",
      status: "todo",
      priority: "medium",
      tags: ["rutin", "review"],
      due: nextSunday,
      dueTime: [18, 0],
      estimate: 45,
      recurrence: "weekly",
    },
    {
      key: "listrik",
      title: "Bayar tagihan listrik",
      status: "todo",
      priority: "medium",
      tags: ["tagihan", "rutin"],
      due: 9,
      estimate: 10,
      recurrence: "monthly",
    },
    {
      key: "cek-kesehatan",
      title: "Jadwalkan cek kesehatan tahunan",
      status: "todo",
      priority: "low",
      project: "sehat",
      tags: ["kesehatan"],
      due: 12,
    },
    // Today and overdue (personal, no project)
    {
      key: "fokus-api",
      title: "Blok fokus: kerjakan API laporan",
      status: "todo",
      priority: "high",
      project: "kasir",
      tags: ["fokus"],
      start: 0,
      startTime: [9, 0],
      blockEnd: [11, 0],
      due: 0,
      dueTime: [11, 0],
      estimate: 120,
    },
    {
      key: "proposal",
      title: "Kirim proposal ke klien",
      status: "todo",
      priority: "high",
      tags: ["klien"],
      due: 0,
      dueTime: [15, 0],
      estimate: 30,
    },
    {
      key: "garansi",
      title: "Follow up vendor printer soal garansi",
      status: "todo",
      priority: "medium",
      project: "kasir",
      tags: ["follow-up", "printer"],
      due: -1,
      estimate: 15,
    },
    {
      key: "kopi",
      title: "Beli kopi buat kantor",
      status: "todo",
      priority: "low",
      tags: ["belanja"],
      due: 1,
      dueTime: [12, 0],
    },
    {
      key: "servis-motor",
      title: "Servis motor",
      status: "todo",
      priority: "low",
      tags: ["rumah", "fleksibel"],
      due: 7,
    },
    {
      key: "ts-generics",
      title: "Selesaikan bab generics",
      status: "in_progress",
      priority: "low",
      project: "belajar",
      tags: ["belajar"],
      start: -4,
      due: 10,
    },
    {
      key: "ide-offline",
      title: "Ide: mode offline saat internet putus",
      status: "todo",
      priority: "low",
      project: "kasir",
      tags: ["ide"],
    },
    // Done over the last 8 weeks ("Selesai 7 hari", reports, project progress).
    ...[-2, -3, -5, -9, -12, -16, -20, -25, -31, -37, -43, -50].map((d, i): TaskSpec => ({
      key: `done-${i}`,
      title: [
        "Rapikan backlog sebelum sprint planning",
        "Update dependency aplikasi kasir",
        "Balas email supplier",
        "Perbaiki validasi form checkout",
        "Siapkan data dummy untuk demo",
        "Dokumentasikan alur retur barang",
        "Ganti ikon PWA",
        "Migrasi server ke region Jakarta",
        "Buat mockup halaman laporan",
        "Tes printer thermal 80 mm",
        "Rekap stok gudang bulanan",
        "Rilis kasir v1.4",
      ][i]!,
      status: "done",
      priority: (["medium", "low", "high"] as const)[i % 3]!,
      ...(i % 6 === 2
        ? {}
        : { project: ["kasir", "website", "", "website", "kasir", "kasir"][i % 6]! }),
      tags: [["sprint"], ["maintenance"], [], ["bug"], ["demo"], ["dokumentasi"]][i % 6]!,
      due: d,
      completed: d,
      estimate: 30 + (i % 4) * 30,
      created: d - 6,
    })),
    // More finished work for throughput and the burndown of Aplikasi Kasir / Website Toko:
    // 2-3 per week over the last 8 weeks, with estimates, created a few days before.
    ...[-1, -4, -6, -8, -11, -13, -15, -18, -22, -24, -27, -29, -33, -36, -40, -45, -48, -53].map(
      (d, i): TaskSpec => ({
        key: `done-extra-${i}`,
        title: [
          "Review PR modul diskon",
          "Rapikan query laporan penjualan",
          "Tulis tes untuk struk",
          "Optimasi gambar katalog",
          "Perbaiki layout keranjang di HP",
          "Tambah filter kategori produk",
          "Sinkronkan stok antar cabang",
          "Update kebijakan privasi toko",
          "Siapkan template email pesanan",
          "Benahi pencarian produk",
          "Tambah metode bayar QRIS",
          "Uji beban checkout",
          "Desain ulang halaman produk",
          "Cetak ulang label rak",
          "Setel backup database harian",
          "Buat halaman FAQ",
          "Integrasi kurir lokal",
          "Rapikan skema tabel transaksi",
        ][i]!,
        status: "done",
        priority: (["medium", "high", "low"] as const)[i % 3]!,
        project: i % 2 === 0 ? "kasir" : "website",
        ...(i % 2 === 0 && d > -20 ? { milestone: "v2" } : {}),
        tags: [],
        due: d,
        completed: d,
        estimate: 30 + (i % 3) * 45,
        created: d - 3 - (i % 5),
      }),
    ),
    // Archive and trash (< 30 days, so the 30-day purge keeps them).
    {
      key: "arsip-1",
      title: "Survey harga printer thermal",
      status: "done",
      priority: "low",
      project: "kasir",
      tags: ["riset"],
      due: -15,
      completed: -15,
      archived: -8,
    },
    {
      key: "arsip-2",
      title: "Bandingkan hosting toko online",
      status: "done",
      priority: "medium",
      project: "website",
      tags: ["riset"],
      due: -18,
      completed: -18,
      archived: -11,
    },
    {
      key: "trash-1",
      title: "Tugas duplikat: export Excel",
      status: "todo",
      priority: "medium",
      project: "kasir",
      tags: [],
      deleted: -2,
    },
    {
      key: "trash-2",
      title: "Cari vendor stiker (tidak jadi)",
      status: "todo",
      priority: "low",
      tags: [],
      deleted: -9,
    },
  ];
  const task = (key: string) => id(`task:${key}`);
  const tasks: TablesInsert<"tasks">[] = taskSpecs.map((t, i) => {
    const assigneeId =
      t.assignee === "me" ? userId : t.assignee ? (mate(t.assignee) ?? null) : null;
    const assigneeName =
      t.assignee === "me"
        ? DEMO_DISPLAY_NAME
        : t.assignee
          ? (DEMO_TEAMMATES.find((m) => m.key === t.assignee)?.name ?? null)
          : null;
    const created = t.created ?? Math.min(t.start ?? 0, t.due ?? 0, -1) - 2;
    return {
      id: task(t.key),
      user_id: userId,
      project_id: t.project ? project(t.project) : null,
      parent_id: t.parent ? task(t.parent) : null,
      milestone_id: t.milestone ? milestone(t.milestone) : null,
      title: t.title,
      description: t.description ?? null,
      status: t.status ?? "todo",
      priority: t.priority ?? "medium",
      tags: t.tags ?? [],
      assignee_id: assigneeId,
      assignee_name: assigneeName,
      start_date: t.start === undefined ? null : at(t.start, ...(t.startTime ?? [9, 0])),
      due_date: t.due === undefined ? null : at(t.due, ...(t.dueTime ?? [17, 0])),
      time_block_end:
        t.blockEnd && t.start !== undefined ? at(t.start, t.blockEnd[0], t.blockEnd[1]) : null,
      estimate_minutes: t.estimate ?? 25,
      recurrence: t.recurrence ?? null,
      position: i,
      completed_at: t.completed === undefined ? null : at(t.completed, 16, 30),
      archived_at: t.archived === undefined ? null : at(t.archived, 11),
      deleted_at: t.deleted === undefined ? null : at(t.deleted, 14),
      reminded: false,
      google_event_id: null,
      created_at: at(created, 8, 30),
      updated_at: at(Math.min(-1, t.completed ?? -1), 18),
    };
  });

  /* dependencies (blocker → blocked) */
  const depSpecs: [string, string][] = [
    ["skema-laporan", "api-laporan"],
    ["api-laporan", "ui-laporan"],
    ["ui-laporan", "qa-laporan"],
    ["bug-struk", "rilis-pilot"],
    ["qa-laporan", "rilis-pilot"],
    ["audit-lighthouse", "kompres-gambar"],
    ["kompres-gambar", "lazy-load"],
    ["artikel-promo", "jadwal-sosmed"],
  ];
  const task_dependencies: TablesInsert<"task_dependencies">[] = depSpecs.map(([a, b]) => ({
    id: id(`dep:${a}>${b}`),
    user_id: userId,
    blocker_id: task(a),
    blocked_id: task(b),
    created_at: at(-7, 10),
  }));

  /* comments (teammates when they exist, else the demo user) */
  const commentSpecs: [string, DemoTeammateKey | "me", number, string][] = [
    ["bug-struk", "budi", -2, "Bisa direproduksi di printer 58 mm, belum di 80 mm."],
    ["bug-struk", "me", -1, "Log koneksi sudah terkumpul, lanjut reconnect otomatis."],
    ["export-stok", "rina", -1, "Kolom SKU dan lokasi rak ikut di-export ya."],
    ["export-stok", "me", 0, "Siap, sudah ditambah. Tolong dicek di review."],
    ["kompres-gambar", "rina", -1, "Ukuran halaman turun dari 3,2 MB ke 900 KB."],
    ["api-laporan", "me", -2, "Endpoint sudah jalan, tinggal filter per kasir."],
  ];
  const task_comments: TablesInsert<"task_comments">[] = commentSpecs.map(
    ([t, who, d, content], i) => ({
      id: id(`comment:${i}`),
      task_id: task(t),
      user_id: who === "me" ? userId : (mate(who) ?? userId),
      content,
      created_at: at(d, 10 + i),
    }),
  );

  /* focus time: 8 weeks for the reports page */
  const focusTasks = [
    "api-laporan",
    "bug-struk",
    "kompres-gambar",
    "skema-laporan",
    "ts-generics",
    "export-stok",
  ];
  const time_entries: TablesInsert<"time_entries">[] = [];
  for (let d = -55; d <= 0; d++) {
    // Weekdays only, plus a few gaps so the chart is not flat.
    const wd = (((weekday + d) % 7) + 7) % 7;
    if (wd === 0 || wd === 6 || d % 5 === 0) continue;
    const sessions = d > -7 ? 2 : 1;
    for (let s = 0; s < sessions; s++) {
      const n = time_entries.length;
      const key = focusTasks[n % focusTasks.length]!;
      const minutes = 25 + ((n * 17) % 4) * 15;
      const spec = taskSpecs.find((t) => t.key === key);
      const start = at(d, 9 + s * 4, (n * 7) % 30);
      time_entries.push({
        id: id(`time:${d}:${s}`),
        user_id: userId,
        task_id: task(key),
        project_id: spec?.project ? project(spec.project) : null,
        mode: "focus",
        started_at: start,
        ended_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
        duration_seconds: minutes * 60,
        created_at: start,
      });
    }
  }

  /* habits: a few routines with ~6 weeks of check-ins (streaks, week grid, consistency) */
  type HabitSpec = {
    key: string;
    name: string;
    color: string;
    project?: string;
    schedule_type: "daily" | "weekdays" | "weekly";
    weekdays_mask?: number;
    times_per_week?: number;
    target?: number;
    created: number;
    /** Whether the habit was done `d` days from today (d <= 0), and how many times. */
    done: (d: number, wd: number) => number;
  };
  const habitSpecs: HabitSpec[] = [
    {
      key: "jalan",
      name: "Jalan kaki 20 menit",
      color: "green",
      project: "sehat",
      schedule_type: "daily",
      created: -45,
      // Mostly done, a few misses, a running streak of the last 9 days.
      done: (d) => (d > -9 || (d * 7) % 5 !== 0 ? 1 : 0),
    },
    {
      key: "air",
      name: "Minum 8 gelas air",
      color: "blue",
      project: "sehat",
      schedule_type: "daily",
      target: 8,
      created: -40,
      // Most days 8, every fifth day short (6); today in progress (5).
      done: (d) => (d === 0 ? 5 : -d % 5 === 4 ? 6 : 8),
    },
    {
      key: "baca",
      name: "Baca 10 halaman",
      color: "violet",
      project: "belajar",
      schedule_type: "weekdays",
      weekdays_mask: 0b0011111,
      created: -42,
      done: (d, wd) => (wd < 5 && (-d % 4 !== 3 || d > -6) ? 1 : 0),
    },
    {
      key: "gym",
      name: "Latihan kekuatan",
      color: "amber",
      project: "sehat",
      schedule_type: "weekly",
      times_per_week: 3,
      created: -44,
      // Mon / Wed / Fri, one short week three weeks ago.
      done: (d, wd) =>
        (wd === 0 || wd === 2 || wd === 4) && !(d < -14 && d > -22 && wd === 4) ? 1 : 0,
    },
    {
      key: "jurnal",
      name: "Jurnal syukur",
      color: "rose",
      schedule_type: "daily",
      created: -12,
      done: (d) => (d === 0 ? 0 : -d % 6 === 5 ? 0 : 1),
    },
  ];
  const habits: TablesInsert<"habits">[] = habitSpecs.map((h, i) => ({
    id: id(`habit:${h.key}`),
    user_id: userId,
    project_id: h.project ? project(h.project) : null,
    name: h.name,
    description: null,
    color: h.color,
    icon: null,
    schedule_type: h.schedule_type,
    weekdays_mask: h.weekdays_mask ?? 127,
    times_per_week: h.times_per_week ?? 3,
    target: h.target ?? 1,
    position: i,
    created_at: at(h.created, 7),
    updated_at: at(h.created, 7),
    archived_at: null,
    deleted_at: null,
  }));
  const habit_logs: TablesInsert<"habit_logs">[] = [];
  for (const h of habitSpecs) {
    for (let d = h.created; d <= 0; d++) {
      const wd = (((weekday + d - 1) % 7) + 7) % 7; // ISO weekday, 0 = Monday
      const count = h.done(d, wd);
      if (count <= 0) continue;
      habit_logs.push({
        id: id(`habit-log:${h.key}:${d}`),
        habit_id: id(`habit:${h.key}`),
        user_id: userId,
        date: day(d),
        count,
        note: null,
        created_at: at(d, 20),
        updated_at: at(d, 20),
      });
    }
  }

  /* notes */
  type NoteSpec = {
    key: string;
    title: string;
    project?: string;
    status: "idea" | "draft" | "final";
    tags: string[];
    pinned?: boolean;
    properties?: Record<string, Json>;
    blocks: BlockSpec[];
    created: number;
    updated?: number;
    archived?: number;
    deleted?: number;
  };
  const noteSpecs: NoteSpec[] = [
    {
      key: "welcome",
      title: "Selamat datang di demo",
      status: "final",
      tags: ["mulai"],
      pinned: true,
      created: -30,
      updated: 0,
      blocks: [
        "# Selamat datang di Second Brain",
        "Ini akun demo bersama: semua data direset setiap hari pukul 00.00 WIB. Silakan klik, ubah dan hapus apa saja.",
        "## Coba ini",
        "[ ] Buka Inbox dan klik **Proses dengan AI** pada brain dump",
        "[ ] Tekan Q untuk tugas cepat, misalnya: rapat tim besok jam 10 #meeting",
        "[ ] Geser kartu di Kanban, lalu lihat Timeline dan Kalender",
        "[x] Baca catatan [[Aplikasi Kasir — spesifikasi]]",
        "## Catatan terhubung",
        "- Notulen: [[Weekly sync tim produk]] dan [[Retro sprint 12]]",
        "- Ide: [[Ide fitur]] · bacaan: [[Bacaan 2026]]",
        "- Blok yang disematkan dari spesifikasi:",
        { type: "embed", text: refId("spec-struk") },
        "## Tugas terbuka terdekat",
        { type: "query", text: "LIST FROM tasks WHERE status != done SORT due ASC LIMIT 6" },
      ],
    },
    {
      key: "spec",
      title: "Aplikasi Kasir — spesifikasi",
      project: "kasir",
      status: "final",
      tags: ["spesifikasi", "kasir"],
      created: -28,
      updated: -2,
      blocks: [
        "## Tujuan",
        "Kasir untuk toko kecil yang tetap jalan saat internet putus.",
        "## Fitur inti",
        { type: "bullet", text: "Transaksi cepat dengan barcode dan pencarian produk" },
        {
          type: "bullet",
          text: "Struk dicetak lewat printer Bluetooth ESC/POS (58 mm dan 80 mm)",
          key: "spec-struk",
        },
        {
          type: "bullet",
          text: "Laporan penjualan harian: transaksi, omzet, produk terlaris",
          key: "spec-laporan",
        },
        "- Detail printer: [[Printer Bluetooth ESC/POS]] · laporan: [[Laporan penjualan harian]]",
        "## Di luar cakupan v2",
        "- Pembayaran QRIS (riset dulu) dan [[Mode offline]]",
      ],
    },
    {
      key: "meeting",
      title: DEMO_MEETING_NOTE.title,
      project: "kasir",
      status: "draft",
      tags: ["meeting"],
      created: -1,
      // The raw text of the weekly example: "Buat notulen" answers it with the polished fixture.
      blocks: DEMO_MEETING_NOTE.content.split("\n"),
    },
    {
      key: "retro",
      title: "Retro sprint 12",
      project: "kasir",
      status: "draft",
      tags: ["meeting", "retro"],
      created: -8,
      blocks: DEMO_MEETING_EXAMPLES[1]!.text.split("\n"),
    },
    {
      key: "printer",
      title: "Printer Bluetooth ESC/POS",
      project: "belajar",
      status: "draft",
      tags: ["riset", "printer"],
      created: -12,
      updated: -2,
      blocks: [
        "Dipakai oleh [[Aplikasi Kasir — spesifikasi]]: ((" + refId("spec-struk") + "))",
        "## Temuan",
        {
          type: "bullet",
          text: "Koneksi putus setelah printer idle sekitar 5 menit",
          key: "printer-idle",
        },
        "- Perintah `ESC @` me-reset printer sebelum mencetak",
        "## Contoh",
        { type: "code", text: "const INIT = Uint8Array.of(0x1b, 0x40); // ESC @" },
      ],
    },
    {
      key: "laporan",
      title: "Laporan penjualan harian",
      project: "kasir",
      status: "draft",
      tags: ["kasir", "laporan"],
      created: -9,
      updated: -1,
      blocks: [
        "Rincian dari ((" + refId("spec-laporan") + "))",
        "[x] Skema tabel ringkasan harian",
        "[ ] Endpoint API per tanggal dan per kasir",
        "[ ] Halaman laporan + export",
        "## Tugas proyek",
        { type: "query", text: `TABLE status, priority FROM tasks WHERE tags = laporan` },
      ],
    },
    {
      key: "webp",
      title: "Kompres gambar WebP",
      project: "website",
      status: "final",
      tags: ["performa", "web"],
      created: -6,
      blocks: [
        "Langkah yang dipakai untuk [[Website Toko — checklist performa]]:",
        { type: "code", text: "npx sharp-cli -i 'img/*.jpg' -o out/ -f webp -q 75" },
        "> Hasil: 3,2 MB → 900 KB di halaman checkout.",
      ],
    },
    {
      key: "perf",
      title: "Website Toko — checklist performa",
      project: "website",
      status: "draft",
      tags: ["performa", "web"],
      created: -10,
      updated: -1,
      blocks: [
        "[x] Audit Lighthouse halaman checkout",
        "[ ] Kompres gambar ke WebP (lihat [[Kompres gambar WebP]])",
        "[ ] Lazy-load gambar katalog",
        "[ ] Cache aset statis 1 tahun",
        "---",
        "Target: checkout di bawah 2 detik di HP kelas menengah.",
      ],
    },
    {
      key: "ide",
      title: "Ide fitur",
      status: "idea",
      tags: ["ide"],
      created: -15,
      updated: -3,
      blocks: [
        "1. [[Mode offline]] untuk kasir",
        "1. Notifikasi stok menipis lewat Telegram",
        "1. Program poin pelanggan",
        "Masalah yang mendasari: ((" + refId("printer-idle") + "))",
      ],
    },
    {
      key: "offline",
      title: "Mode offline",
      project: "kasir",
      status: "idea",
      tags: ["ide", "kasir"],
      created: -14,
      blocks: [
        "Transaksi dicatat lokal (IndexedDB), lalu disinkronkan saat online.",
        "- Konflik stok: server menang, kasir dapat peringatan",
        "- Berawal dari [[Ide fitur]]; dampak ke [[Aplikasi Kasir — spesifikasi]]",
      ],
    },
    {
      key: "bacaan",
      title: "Bacaan 2026",
      project: "belajar",
      status: "draft",
      tags: ["baca"],
      created: -40,
      updated: -4,
      blocks: [
        "Buku yang sedang dan sudah dibaca (catatan bertag #buku):",
        { type: "query", text: "TABLE penulis, rating, status FROM #buku SORT rating DESC" },
        "Favorit sejauh ini: [[Building a Second Brain]]",
      ],
    },
    ...(
      [
        ["Atomic Habits", "James Clear", 5, "selesai", "Kebiasaan kecil, sistem > tujuan."],
        ["Deep Work", "Cal Newport", 4, "selesai", "Blok fokus panjang tanpa notifikasi."],
        [
          "Building a Second Brain",
          "Tiago Forte",
          5,
          "dibaca",
          "Metode PARA dan CODE; dasar demo ini.",
        ],
      ] as const
    ).map(([title, penulis, rating, status, summary], i): NoteSpec => ({
      key: `buku-${i}`,
      title,
      project: "belajar",
      status: "final",
      tags: ["buku"],
      properties: { penulis, rating, status },
      created: -35 + i * 5,
      blocks: [
        summary,
        i === 2
          ? "Lihat juga [[Selamat datang di demo]] dan [[Bacaan 2026]]"
          : "Masuk daftar [[Bacaan 2026]]",
      ],
    })),
    {
      key: "jurnal",
      title: "Jurnal mingguan",
      project: "sehat",
      status: "draft",
      tags: ["jurnal", "review"],
      created: -7,
      updated: 0,
      blocks: [
        "## Minggu ini",
        "- Olahraga 4 dari 7 hari",
        "- Fokus terbesar: laporan harian, lihat [[Laporan penjualan harian]]",
        "## Kebiasaan",
        "Prinsip dari [[Atomic Habits]]: mulai dari yang kecil.",
        { type: "quote", text: "You do not rise to the level of your goals. — James Clear" },
      ],
    },
    // Archive and trash.
    {
      key: "arsip",
      title: "Catatan rapat vendor lama",
      project: "v1",
      status: "final",
      tags: ["meeting"],
      created: -80,
      archived: -9,
      blocks: ["Vendor printer lama tidak lagi dipakai sejak rilis v1."],
    },
    {
      key: "trash",
      title: "Draf yang dibuang",
      status: "idea",
      tags: [],
      created: -6,
      deleted: -3,
      blocks: ["Draf ide yang tidak jadi dipakai."],
    },
  ];
  const note = (key: string) => id(`note:${key}`);
  const notes: TablesInsert<"notes">[] = noteSpecs.map((n, i) => {
    const b = blocks(n.key, n.blocks);
    const content = toMarkdown(b);
    return {
      id: note(n.key),
      user_id: userId,
      project_id: n.project ? project(n.project) : null,
      title: n.title,
      blocks: b as unknown as Json,
      content,
      ...noteIndexFields(b, content),
      status: n.status,
      tags: n.tags,
      pinned: n.pinned ?? false,
      position: i,
      properties: (n.properties ?? {}) as Json,
      archived_at: n.archived === undefined ? null : at(n.archived, 12),
      deleted_at: n.deleted === undefined ? null : at(n.deleted, 15),
      created_at: at(n.created, 10),
      updated_at: at(n.updated ?? n.created, n.updated === 0 ? 7 : 16),
    };
  });

  /* version history for one note (the editor's "Riwayat versi") */
  const specNote = notes.find((n) => n.id === note("spec"))!;
  const specBlocks = specNote.blocks as unknown as Block[];
  const note_versions: TablesInsert<"note_versions">[] = [3, 2, 1].map((v) => {
    const b = specBlocks.slice(0, specBlocks.length - (4 - v) * 2);
    return {
      id: id(`version:spec:${v}`),
      note_id: specNote.id!,
      user_id: userId,
      version_number: v,
      title: specNote.title,
      blocks: b as unknown as Json,
      content: toMarkdown(b),
      created_at: at(-28 + v * 8, 15),
    };
  });

  /* inbox: the AI examples + a paraphrased item + processed history */
  const paraphrased = DEMO_PARAPHRASE_EXAMPLES[1]!;
  const inboxSpecs: {
    key: string;
    content: string;
    source: string;
    status: "pending" | "processed";
    ai_summary: string | null;
    created: [number, number, number];
  }[] = [
    ...DEMO_INBOX_ITEMS.map((item, i) => ({
      key: `example-${i}`,
      content: item.content,
      source: item.source,
      status: "pending" as const,
      ai_summary: null,
      created: [0, 7 - i, 10 * i] as [number, number, number],
    })),
    {
      key: "website-dump",
      content: DEMO_BRAIN_DUMP_EXAMPLES[2]!.text,
      source: "manual",
      status: "pending",
      ai_summary: null,
      created: [-1, 21, 0],
    },
    {
      // Already clarified with "Perjelas poin": the original point is kept in ai_summary.
      key: "paraphrased",
      content:
        "Sebelum sprint planning, rapikan backlog: tutup item yang sudah tidak relevan, gabungkan yang duplikat, dan urutkan sisanya berdasarkan prioritas.",
      source: "telegram",
      status: "pending",
      ai_summary: paraphrased.text,
      created: [-1, 19, 30],
    },
    {
      key: "email",
      content: "Fwd: Penawaran harga kertas struk 58 mm dari supplier",
      source: "email",
      status: "pending",
      ai_summary: null,
      created: [-2, 9, 15],
    },
    {
      key: "processed-1",
      content: "Telepon ibu nanti malam",
      source: "voice",
      status: "processed",
      ai_summary: null,
      created: [-3, 20, 0],
    },
    {
      key: "processed-2",
      content: "Ide: program poin pelanggan",
      source: "manual",
      status: "processed",
      ai_summary: null,
      created: [-4, 13, 0],
    },
  ];
  const inbox_items: TablesInsert<"inbox_items">[] = inboxSpecs.map((it) => ({
    id: id(`inbox:${it.key}`),
    user_id: userId,
    content: it.content,
    source: it.source,
    status: it.status,
    ai_summary: it.ai_summary,
    created_at: at(...it.created),
  }));

  /* templates */
  const templateSpecs: [string, "task" | "note", string, Record<string, Json>][] = [
    [
      "bug",
      "task",
      "Laporan bug",
      {
        title: "Bug: ",
        body: "Langkah reproduksi:\n1. \n\nHasil yang diharapkan:\n\nHasil sebenarnya:",
        priority: "high",
        tags: ["bug"],
        estimate: 45,
      },
    ],
    [
      "belanja",
      "task",
      "Belanja mingguan",
      {
        title: "Belanja mingguan",
        body: "- beras\n- telur\n- sabun cuci",
        priority: "low",
        tags: ["belanja"],
        estimate: 30,
      },
    ],
    [
      "notulen",
      "note",
      "Notulen meeting",
      {
        title: "Notulen: ",
        body: "## Hadir\n- \n## Pembahasan\n- \n## Action items\n[ ] ",
        tags: ["meeting"],
      },
    ],
    [
      "review",
      "note",
      "Review mingguan",
      {
        title: "Review minggu ini",
        body: "## Yang berjalan baik\n- \n## Yang perlu diperbaiki\n- \n## 3 prioritas minggu depan\n1. ",
        tags: ["review"],
      },
    ],
  ];
  const templates: TablesInsert<"templates">[] = templateSpecs.map(
    ([key, kind, name, payload], i) => ({
      id: id(`template:${key}`),
      user_id: userId,
      kind,
      name,
      payload: payload as Json,
      created_at: at(-25 + i, 11),
    }),
  );

  /* automations + run history */
  const automationSpecs: {
    key: string;
    name: string;
    trigger: Json;
    conditions: Json;
    actions: Json;
    enabled: boolean;
    /** [task key, day offset, ok, coded steps] (see src/lib/automation-run-detail.ts). */
    runs: [string, number, boolean, RunStep[]][];
    /** Scheduled rules (9.4): cron in the demo zone. Never actually run on the demo (no n8n tick). */
    cron?: string;
  }[] = [
    {
      key: "urgent",
      name: "Prioritas tinggi → tag urgent",
      trigger: { type: "task_created" },
      conditions: [{ field: "priority", op: "eq", value: "high" }],
      actions: [{ type: "add_tag", value: "urgent" }],
      enabled: true,
      runs: [
        ["proposal", -1, true, [{ code: "addTag", params: { tag: "urgent" } }]],
        ["ssl", -4, true, [{ code: "addTag", params: { tag: "urgent" } }]],
      ],
    },
    {
      key: "done-comment",
      name: "Selesai → komentar",
      trigger: { type: "status_changed", to: "done" },
      conditions: [],
      actions: [{ type: "comment", text: "Selesai ✅ — jangan lupa update catatan proyek." }],
      enabled: true,
      runs: [
        ["bug-struk-log", -1, true, [{ code: "comment" }]],
        ["audit-lighthouse", -4, true, [{ code: "comment" }]],
        ["skema-laporan", -6, true, [{ code: "comment" }]],
      ],
    },
    {
      key: "review",
      name: "Review → Rina",
      trigger: { type: "status_changed", to: "review" },
      conditions: [{ field: "project_id", op: "eq", value: project("kasir") }],
      actions: [{ type: "set_field", field: "assignee_name", value: "Rina" }],
      enabled: true,
      runs: [
        [
          "export-stok",
          0,
          true,
          [{ code: "setField", params: { field: "assignee_name", value: "Rina" } }],
        ],
      ],
    },
    {
      key: "fleksibel",
      name: "Tenggat berubah → geser 1 hari (tag fleksibel)",
      trigger: { type: "due_changed" },
      conditions: [{ field: "tag", op: "contains", value: "fleksibel" }],
      actions: [{ type: "shift_due", days: 1 }],
      enabled: false,
      runs: [],
    },
    {
      key: "telegram",
      name: "Bug baru → kabari di Telegram",
      trigger: { type: "task_created" },
      conditions: [{ field: "tag", op: "contains", value: "bug" }],
      actions: [{ type: "telegram", text: "Bug baru: {title}" }],
      enabled: true,
      runs: [
        ["bug-struk-retry", -2, true, [{ code: "skippedDemo", params: { channel: "telegram" } }]],
      ],
    },
    {
      key: "weekly-review",
      name: "Senin 08:00 → tugas weekly review",
      trigger: { type: "schedule" },
      conditions: [],
      actions: [{ type: "create_task", title: "Weekly review {{date}}", due_in_days: 0 }],
      enabled: true,
      runs: [],
      cron: "0 8 * * 1",
    },
    {
      key: "note-rapat",
      name: "Catatan #rapat → tugas tindak lanjut",
      trigger: { type: "note_tagged", to: "rapat" },
      conditions: [],
      actions: [{ type: "create_task", title: "Tindak lanjut: {{title}}", due_in_days: 2 }],
      enabled: true,
      runs: [],
    },
  ];
  const automations: TablesInsert<"automations">[] = automationSpecs.map((a, i) => ({
    id: id(`automation:${a.key}`),
    user_id: userId,
    name: a.name,
    trigger: a.trigger,
    conditions: a.conditions,
    actions: a.actions,
    enabled: a.enabled,
    run_count: a.runs.length,
    last_run_at: a.runs.length ? at(Math.max(...a.runs.map((r) => r[1])), 14) : null,
    schedule_cron: a.cron ?? null,
    schedule_tz: a.cron ? tz : null,
    // Like `scheduleAutomation` (from the end of the reset day, so it is never in the past before
    // the next daily reset): the list shows "berikutnya …" instead of
    // looking broken. Nothing runs it: the n8n tick is a 404 on the demo.
    next_run_at:
      a.cron && a.enabled ? (nextRun(a.cron, tz, new Date(at(1, 0)))?.toISOString() ?? null) : null,
    created_at: at(-20 + i, 10),
  }));
  const titleOf = (key: string) => taskSpecs.find((t) => t.key === key)?.title ?? key;
  const automation_runs: TablesInsert<"automation_runs">[] = automationSpecs.flatMap((a) =>
    a.runs.map(([t, d, ok, log], i) => ({
      id: id(`run:${a.key}:${i}`),
      user_id: userId,
      automation_id: id(`automation:${a.key}`),
      task_id: task(t),
      ok,
      detail: serializeRunDetail("task", titleOf(t), log),
      created_at: at(d, 14 - i),
    })),
  );

  /* canvas */
  const board = id("canvas:board");
  const canvas_boards: TablesInsert<"canvas_boards">[] = [
    {
      id: board,
      user_id: userId,
      project_id: project("kasir"),
      title: "Peta rilis aplikasi kasir",
      viewport: { x: 0, y: 0, zoom: 1 },
      created_at: at(-15, 10),
      updated_at: at(-1, 10),
    },
  ];
  const nodeSpecs: [string, string, string, number, number, string, string | null][] = [
    ["goal", "Tujuan v2", "Kasir stabil + laporan harian untuk toko pilot.", 60, 60, "blue", null],
    [
      "printer",
      "Printer Bluetooth",
      "Reconnect otomatis, tes 58/80 mm.",
      420,
      40,
      "rose",
      "bug-struk",
    ],
    ["laporan", "Laporan harian", "Skema → API → UI → QA.", 420, 260, "amber", "api-laporan"],
    ["export", "Export stok", "Excel dengan SKU dan lokasi rak.", 780, 140, "green", "export-stok"],
    [
      "pilot",
      "Toko pilot",
      "2 toko, 2 minggu, kumpulkan masukan.",
      780,
      380,
      "violet",
      "rilis-pilot",
    ],
    [
      "risiko",
      "Risiko",
      "Koneksi internet toko tidak stabil → mode offline?",
      60,
      360,
      "slate",
      null,
    ],
    ["offline", "Mode offline", "Lihat catatan Mode offline.", 60, 560, "teal", null],
  ];
  const node = (key: string) => id(`canvas:node:${key}`);
  const canvas_nodes: TablesInsert<"canvas_nodes">[] = nodeSpecs.map(
    ([key, title, content, x, y, color, ref]) => ({
      id: node(key),
      board_id: board,
      user_id: userId,
      node_type: ref ? "task" : "text",
      title,
      content,
      ref_type: ref ? "task" : null,
      ref_id: ref ? task(ref) : null,
      url: null,
      x,
      y,
      width: 280,
      height: 160,
      color,
      created_at: at(-15, 10),
      updated_at: at(-1, 10),
    }),
  );
  const edgeSpecs: [string, string, string][] = [
    ["goal", "printer", "perlu"],
    ["goal", "laporan", "perlu"],
    ["laporan", "export", ""],
    ["printer", "pilot", "memblokir"],
    ["laporan", "pilot", "memblokir"],
    ["risiko", "offline", "mitigasi"],
    ["goal", "risiko", ""],
  ];
  const canvas_edges: TablesInsert<"canvas_edges">[] = edgeSpecs.map(([s, t, label]) => ({
    id: id(`canvas:edge:${s}>${t}`),
    board_id: board,
    user_id: userId,
    source_id: node(s),
    target_id: node(t),
    label,
    created_at: at(-15, 11),
  }));

  /* curated activity history (the audit rows written by the seed itself are deleted) */
  const activitySpecs: [number, number, string, string, string, Json][] = [
    [0, 7, "update", "tasks", task("export-stok"), { changed_fields: ["status"] }],
    [0, 7, "update", "notes", note("welcome"), { changed_fields: ["title"] }],
    [
      -1,
      16,
      "update",
      "tasks",
      task("bug-struk-log"),
      { changed_fields: ["status", "completed_at"] },
    ],
    [-1, 15, "insert", "inbox_items", id("inbox:paraphrased"), {}],
    [-1, 11, "insert", "task_comments", id("comment:1"), {}],
    [-1, 10, "update", "notes", note("laporan"), { changed_fields: ["updated_at"] }],
    [-1, 9, "insert", "notes", note("meeting"), {}],
    [-2, 17, "update", "tasks", task("bug-struk"), { changed_fields: ["status"] }],
    [-2, 14, "delete", "tasks", task("trash-1"), {}],
    [-2, 10, "insert", "tasks", task("bug-struk-retry"), {}],
    [-3, 15, "update", "notes", note("trash"), { changed_fields: ["deleted_at"] }],
    [-3, 11, "update", "tasks", task("seo"), { changed_fields: ["status"] }],
    [
      -4,
      16,
      "update",
      "tasks",
      task("audit-lighthouse"),
      { changed_fields: ["status", "completed_at"] },
    ],
    [-4, 9, "insert", "automation_runs", id("run:urgent:1"), {}],
    [-5, 10, "update", "projects", project("batal"), { changed_fields: ["deleted_at"] }],
    [
      -6,
      16,
      "update",
      "tasks",
      task("skema-laporan"),
      { changed_fields: ["status", "completed_at"] },
    ],
    [-6, 11, "insert", "notes", note("webp"), {}],
    [-7, 10, "insert", "task_dependencies", id("dep:skema-laporan>api-laporan"), {}],
    [-8, 11, "update", "tasks", task("arsip-1"), { changed_fields: ["archived_at"] }],
    [-9, 15, "update", "notes", note("arsip"), { changed_fields: ["archived_at"] }],
    [-12, 10, "insert", "project_members", id("member:kasir:rina"), {}],
  ];
  const activity_logs: TablesInsert<"activity_logs">[] = activitySpecs.map(
    ([d, h, action, entity_type, entity_id, extra], i) => ({
      id: id(`activity:${i}`),
      user_id: userId,
      action,
      entity_type,
      entity_id,
      metadata: { table: entity_type, ...(extra as Record<string, Json>) },
      source: "database",
      created_at: at(d, h, i % 60),
    }),
  );

  return {
    profile: { display_name: DEMO_DISPLAY_NAME, telegram_chat_id: null, telegram_username: null },
    projects,
    project_members,
    milestones,
    tasks,
    task_dependencies,
    task_comments,
    time_entries,
    habits,
    habit_logs,
    notes,
    note_versions,
    inbox_items,
    templates,
    automations,
    automation_runs,
    canvas_boards,
    canvas_nodes,
    canvas_edges,
    activity_logs,
  };
}

// Simulated AI for the public demo (Phase 10). When `APP_MODE=demo`, src/lib/ai.server.ts answers
// from here instead of calling a provider: no fetch, no AI_API_KEY, no cost. Answers are
// realistic, hard-coded fixtures keyed by the example inputs in src/lib/demo-examples.ts (which
// the demo UI pre-fills), with fallbacks for free input:
//   - brain dump: keyword-matched fixture, else one item per line through the local NLP parser;
//   - paraphrase / meeting: keyword-matched fixture, else a generic "try an example" reply;
//   - OCR / voice: always the example text (the uploaded bytes are ignored).
// Due dates are relative to "today" in APP_TIMEZONE (time.server.ts), so the demo never shows
// stale deadlines.
import {
  DEMO_BRAIN_DUMP_EXAMPLES,
  DEMO_MEETING_EXAMPLES,
  DEMO_OCR_TEXT,
  DEMO_PARAPHRASE_EXAMPLES,
  DEMO_VOICE_TRANSCRIPT,
  demoGenericReply,
  type DemoExample,
} from "@/lib/demo-examples";
import type { ParsedTask } from "@/lib/ai.server";
import { appTimezone, parseTaskTextInZone, zonedIsoDate } from "@/server/n8n/time.server";

export type DemoTextKind = "paraphrase" | "meeting" | "ocr" | "summary";

type Clock = { now?: Date; tz?: string };

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Finds the fixture for an input: an exact example (whitespace and case ignored) first, then the
 * example whose keywords appear most often (at least `minHits`).
 */
export function matchFixture<K extends string>(
  input: string,
  keywords: Record<K, readonly string[]>,
  examples: readonly DemoExample[],
  minHits = 2,
): K | null {
  const text = normalize(input);
  const exact = examples.find((e) => normalize(e.text) === text);
  if (exact && exact.key in keywords) return exact.key as K;
  let best: K | null = null;
  let bestHits = 0;
  for (const key of Object.keys(keywords) as K[]) {
    const hits = keywords[key].filter((word) => text.includes(word)).length;
    if (hits > bestHits) {
      best = key;
      bestHits = hits;
    }
  }
  return bestHits >= minHits ? best : null;
}

/** Days from `now` (in `tz`) to the next given weekday (0 = Sunday), 1–7. */
function daysUntilWeekday(now: Date, tz: string, weekday: number): number {
  const today = new Date(`${zonedIsoDate(now, tz)}T00:00:00Z`).getUTCDay();
  return (weekday - today + 7) % 7 || 7;
}

/* ---------------- brain dump ---------------- */

type DumpKey = "dump-kasir" | "dump-rumah" | "dump-website" | "point-garansi" | "voice" | "ocr";

const DUMP_KEYWORDS: Record<DumpKey, readonly string[]> = {
  "dump-kasir": ["kasir", "struk", "printer", "laporan penjualan", "export excel", "offline"],
  "dump-rumah": ["belanja", "beras", "telur", "listrik", "servis motor", "telepon ibu"],
  "dump-website": ["website", "checkout", "kompres", "artikel blog", "kompetitor"],
  "point-garansi": ["vendor", "garansi"],
  voice: ["proposal", "kopi"],
  ocr: ["rencana q4", "qris", "desainer", "anggaran marketing"],
};

const DUMP_EXAMPLES: readonly DemoExample[] = [
  ...DEMO_BRAIN_DUMP_EXAMPLES,
  ...DEMO_PARAPHRASE_EXAMPLES,
  { key: "voice", label: { id: "", en: "" }, text: DEMO_VOICE_TRANSCRIPT },
  { key: "ocr", label: { id: "", en: "" }, text: DEMO_OCR_TEXT },
];

/** Resolves the existing project name the user already has (case-insensitive), else ours. */
function projectName(name: string, existing: string[]): string {
  return existing.find((p) => p.toLowerCase() === name.toLowerCase()) ?? name;
}

function dumpFixture(key: DumpKey, existing: string[], clock: Required<Clock>): ParsedTask[] {
  const { now, tz } = clock;
  const day = (n: number) => zonedIsoDate(now, tz, n);
  const friday = day(daysUntilWeekday(now, tz, 5));
  const kasir = projectName("Aplikasi Kasir", existing);
  const toko = projectName("Website Toko", existing);
  switch (key) {
    case "dump-kasir":
      return [
        {
          title: "Perbaiki struk yang tidak tercetak di printer Bluetooth",
          description:
            "Struk gagal tercetak saat kasir memakai printer Bluetooth. Reproduksi di perangkat kasir, cek koneksi dan driver printer.",
          priority: "high",
          due_date: day(1),
          tags: ["bug", "printer"],
          project: kasir,
          kind: "issue",
        },
        {
          title: "Tambah laporan penjualan harian",
          description: "Laporan berisi total transaksi, omzet, dan produk terlaris per hari.",
          priority: "medium",
          due_date: friday,
          tags: ["fitur", "laporan"],
          project: kasir,
          kind: "task",
        },
        {
          title: "Export data stok ke Excel",
          description: "Permintaan Rina: unduh daftar stok sebagai file Excel untuk rekap gudang.",
          priority: "medium",
          due_date: day(7),
          tags: ["fitur", "follow-up"],
          project: kasir,
          kind: "task",
        },
        {
          title: "Ide: mode offline saat internet putus",
          description:
            "Transaksi tetap bisa dicatat tanpa internet, lalu disinkronkan ketika koneksi kembali.",
          priority: "low",
          due_date: null,
          tags: ["ide", "meeting"],
          project: kasir,
          kind: "note",
        },
      ];
    case "dump-rumah":
      return [
        {
          title: "Belanja beras, telur, dan sabun cuci",
          description: null,
          priority: "medium",
          due_date: day(1),
          tags: ["belanja"],
          project: null,
          kind: "task",
        },
        {
          title: "Bayar tagihan listrik",
          description: "Bayar sebelum tanggal 20 agar tidak kena denda.",
          priority: "high",
          due_date: day(3),
          tags: ["tagihan"],
          project: null,
          kind: "task",
        },
        {
          title: "Servis motor",
          description: null,
          priority: "low",
          due_date: day(7),
          tags: ["rumah"],
          project: null,
          kind: "task",
        },
        {
          title: "Telepon ibu",
          description: null,
          priority: "medium",
          due_date: day(0),
          tags: ["keluarga"],
          project: null,
          kind: "task",
        },
      ];
    case "dump-website":
      return [
        {
          title: "Percepat halaman checkout di HP",
          description:
            "Checkout terasa lambat di perangkat mobile. Kompres gambar produk dan cek ukuran aset yang dimuat.",
          priority: "high",
          due_date: day(2),
          tags: ["bug", "performa"],
          project: toko,
          kind: "issue",
        },
        {
          title: "Tulis artikel blog promo akhir bulan",
          description: null,
          priority: "medium",
          due_date: day(5),
          tags: ["konten", "marketing"],
          project: toko,
          kind: "task",
        },
        {
          title: "Referensi desain dari kompetitor",
          description: "Kumpulkan tangkapan layar halaman produk dan checkout kompetitor.",
          priority: "low",
          due_date: null,
          tags: ["desain", "riset"],
          project: toko,
          kind: "note",
        },
      ];
    case "point-garansi":
      return [
        {
          title: "Follow up vendor printer soal garansi",
          description:
            "Tanyakan status garansi printer yang bermasalah; siapkan nomor seri dan bukti pembelian.",
          priority: "medium",
          due_date: day(2),
          tags: ["follow-up", "vendor"],
          project: kasir,
          kind: "task",
        },
      ];
    case "voice":
      return [
        {
          title: "Kirim proposal ke klien",
          description: "Kirim proposal besok pukul 10.00.",
          priority: "high",
          due_date: day(1),
          tags: ["klien", "follow-up"],
          project: null,
          kind: "task",
        },
        {
          title: "Beli kopi untuk kantor",
          description: null,
          priority: "low",
          due_date: day(1),
          tags: ["belanja"],
          project: null,
          kind: "task",
        },
      ];
    case "ocr":
      return [
        {
          title: "Rilis aplikasi kasir v2",
          description: "Target rilis akhir Oktober sesuai rencana Q4.",
          priority: "high",
          due_date: day(14),
          tags: ["rilis", "q4"],
          project: kasir,
          kind: "task",
        },
        {
          title: "Integrasi pembayaran QRIS",
          description: "Sebagian tulisan di papan kurang terbaca; pastikan cakupannya dengan tim.",
          priority: "medium",
          due_date: null,
          tags: ["pembayaran", "q4"],
          project: kasir,
          kind: "task",
        },
        {
          title: "Rekrut 1 desainer",
          description: null,
          priority: "medium",
          due_date: null,
          tags: ["rekrutmen", "q4"],
          project: null,
          kind: "task",
        },
        {
          title: "Anggaran marketing naik 10%",
          description: "Catatan dari rencana Q4.",
          priority: "low",
          due_date: null,
          tags: ["anggaran", "q4"],
          project: null,
          kind: "note",
        },
      ];
  }
}

/** Free input: one item per line through the local NLP parser (dates in APP_TIMEZONE). */
function dumpFallback(dump: string, existing: string[], clock: Required<Clock>): ParsedTask[] {
  const lines = dump
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 1 && !/:$/.test(line))
    .slice(0, 20);
  return lines.map((line) => {
    const parsed = parseTaskTextInZone(` ${line}`, clock.now, clock.tz);
    const issue = /\b(bug|error|rusak|gagal|crash)\b/i.test(line);
    const note = /^(ide|catatan|note|referensi)\b/i.test(parsed.title);
    return {
      title: parsed.title.slice(0, 200),
      description: null,
      priority: parsed.priority ?? (/\b(urgent|penting|asap)\b/i.test(line) ? "high" : "medium"),
      due_date: parsed.due ? zonedIsoDate(parsed.due, clock.tz) : null,
      tags: parsed.tags.slice(0, 3),
      project: parsed.project ? projectName(parsed.project, existing) : null,
      kind: issue ? "issue" : note ? "note" : "task",
    } satisfies ParsedTask;
  });
}

/** Simulated `aiParseBrainDump`. */
export function demoBrainDump(dump: string, existingProjects: string[], clock: Clock = {}) {
  const full = { now: clock.now ?? new Date(), tz: clock.tz ?? appTimezone() };
  const key = matchFixture(dump, DUMP_KEYWORDS, DUMP_EXAMPLES);
  return key
    ? dumpFixture(key, existingProjects, full)
    : dumpFallback(dump, existingProjects, full);
}

/* ---------------- text ---------------- */

const PARAPHRASE_KEYWORDS = {
  "point-garansi": ["vendor", "printer", "garansi"],
  "point-backlog": ["backlog", "sprint", "planning"],
} as const;

const PARAPHRASE_FIXTURES: Record<keyof typeof PARAPHRASE_KEYWORDS, string> = {
  "point-garansi":
    "Hubungi vendor printer untuk menanyakan status garansi printer yang bermasalah. Siapkan nomor seri dan bukti pembelian, lalu pastikan apakah perbaikan atau penggantian unit ditanggung garansi beserta perkiraan waktunya.",
  "point-backlog":
    "Sebelum sprint planning, rapikan backlog: tutup item yang sudah tidak relevan, gabungkan yang duplikat, dan urutkan sisanya berdasarkan prioritas. Pastikan item teratas sudah punya deskripsi dan kriteria selesai yang jelas agar estimasi saat planning berjalan cepat.",
};

const MEETING_KEYWORDS = {
  "meeting-weekly": ["weekly", "printer", "laporan harian", "checkout", "demo ke klien"],
  "meeting-retro": ["retro", "deploy", "qa", "timebox"],
} as const;

const MEETING_FIXTURES: Record<keyof typeof MEETING_KEYWORDS, string> = {
  "meeting-weekly": `## Ringkasan
Weekly sync tim produk (Andi, Rina, Budi) membahas progres aplikasi kasir dan website toko, serta persiapan demo ke klien Senin depan.

## Poin Pembahasan
### Aplikasi Kasir
- Bug struk tidak tercetak di printer Bluetooth masih muncul.
- Laporan penjualan harian sudah sekitar 70% selesai.

### Website Toko
- Halaman checkout lambat di HP, kemungkinan karena gambar belum dikompres.

## Action Items
- [ ] Cek driver printer Bluetooth (Budi)
- [ ] Selesaikan laporan penjualan harian (target Jumat)
- [ ] Kompres gambar halaman checkout (Rina)
- [ ] Siapkan demo ke klien (Senin depan)`,
  "meeting-retro": `## Ringkasan
Retro sprint 12: proses deploy membaik berkat checklist, tetapi bug dari QA masuk terlambat dan meeting terlalu panjang.

## Poin Pembahasan
- **Yang berjalan baik:** deploy lebih lancar dengan checklist.
- **Yang perlu diperbaiki:** banyak bug baru dilaporkan QA di akhir sprint; durasi meeting terlalu panjang.

## Action Items
- [ ] QA ikut daily standup mulai sprint berikutnya
- [ ] Timebox setiap meeting maksimal 30 menit (Andi)`,
};

/** Local stand-in for the n8n summary: the first points of the text as a bullet list. */
function summaryFixture(input: string): string {
  const points = input
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((line) => `- ${line.length > 160 ? `${line.slice(0, 157)}…` : line}`);
  return points.length ? points.join("\n") : demoGenericReply(DEMO_MEETING_EXAMPLES);
}

/** Simulated `aiText` for each kind of request. */
export function demoText(kind: DemoTextKind, input: string): string {
  switch (kind) {
    case "paraphrase": {
      const key = matchFixture(input, PARAPHRASE_KEYWORDS, DEMO_PARAPHRASE_EXAMPLES);
      return key ? PARAPHRASE_FIXTURES[key] : demoGenericReply(DEMO_PARAPHRASE_EXAMPLES);
    }
    case "meeting": {
      const key = matchFixture(input, MEETING_KEYWORDS, DEMO_MEETING_EXAMPLES);
      return key ? MEETING_FIXTURES[key] : demoGenericReply(DEMO_MEETING_EXAMPLES);
    }
    case "ocr":
      return DEMO_OCR_TEXT;
    case "summary":
      return summaryFixture(input);
  }
}

/** Simulated `aiTranscribe`. */
export function demoTranscript(): string {
  return DEMO_VOICE_TRANSCRIPT;
}

/**
 * Waits 600–1200 ms so the demo feels like a real model call. Rejects with an AbortError when
 * the request is cancelled.
 */
export function demoDelay(signal?: AbortSignal, ms = 600 + Math.random() * 600): Promise<void> {
  return new Promise((resolve, reject) => {
    const reason = () => signal?.reason ?? new DOMException("Aborted", "AbortError");
    if (signal?.aborted) return reject(reason());
    const abort = () => {
      clearTimeout(timer);
      reject(reason());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

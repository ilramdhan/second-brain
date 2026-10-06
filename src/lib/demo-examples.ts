// Example inputs for the public demo (Phase 10). Client-safe: no secrets, no server imports.
//
// In demo mode (`VITE_APP_MODE=demo`) every AI form starts pre-filled with one of these and offers
// "Contoh" chips to switch, while the server answers with matching fixtures
// (src/server/demo/ai-fixtures.server.ts) instead of calling an AI provider. The demo seed reuses
// the same constants (DEMO_INBOX_ITEMS, DEMO_MEETING_NOTE, DEMO_PROJECT_NAMES), so the seeded
// inbox items and meeting note produce the polished fixture answers out of the box.
//
// Example texts are Indonesian on purpose (the fixtures answer in Indonesian, like the real
// prompts); only the chip labels are translated.

export type DemoLabel = { id: string; en: string };

export type DemoExample = {
  /** Stable key; the server fixtures use the same ids. */
  key: string;
  label: DemoLabel;
  text: string;
};

/** Projects the brain dump fixtures file items under (the seed creates them). */
export const DEMO_PROJECT_NAMES = ["Aplikasi Kasir", "Website Toko"] as const;

/** Brain dumps: QuickCapture → Inbox → "Proses dengan AI" (parseBrainDump). */
export const DEMO_BRAIN_DUMP_EXAMPLES: readonly DemoExample[] = [
  {
    key: "dump-kasir",
    label: { id: "Meeting aplikasi kasir", en: "POS app meeting" },
    text: [
      "Meeting sprint aplikasi kasir:",
      "- bug struk tidak tercetak di printer bluetooth, urgent",
      "- tambah laporan penjualan harian, target Jumat",
      "- Rina minta export Excel buat stok",
      "- ide: mode offline kalau internet putus",
    ].join("\n"),
  },
  {
    key: "dump-rumah",
    label: { id: "Urusan rumah", en: "Household errands" },
    text: [
      "besok belanja: beras, telur, sabun cuci",
      "bayar listrik sebelum tanggal 20",
      "servis motor minggu depan",
      "telepon ibu nanti malam",
    ].join("\n"),
  },
  {
    key: "dump-website",
    label: { id: "Website toko online", en: "Online store website" },
    text: [
      "Website toko online:",
      "- halaman checkout lambat di HP, cek gambar yang belum dikompres",
      "- tulis artikel blog promo akhir bulan",
      "- catat referensi desain dari kompetitor",
    ].join("\n"),
  },
];

/** Short points: Inbox → "Perjelas poin" (paraphrasePoint). */
export const DEMO_PARAPHRASE_EXAMPLES: readonly DemoExample[] = [
  {
    key: "point-garansi",
    label: { id: "Garansi printer", en: "Printer warranty" },
    text: "follow up vendor printer soal garansi",
  },
  {
    key: "point-backlog",
    label: { id: "Rapikan backlog", en: "Groom the backlog" },
    text: "rapikan backlog sebelum sprint planning",
  },
];

/** Raw meeting notes: note editor → "Buat notulen" (summarizeMeeting). */
export const DEMO_MEETING_EXAMPLES: readonly DemoExample[] = [
  {
    key: "meeting-weekly",
    label: { id: "Weekly sync tim produk", en: "Product team weekly sync" },
    text: [
      "Weekly sync tim produk",
      "hadir: Andi, Rina, Budi",
      "- kasir: bug printer bluetooth masih muncul, Budi cek driver",
      "- kasir: laporan harian 70% selesai, target Jumat",
      "- website: checkout lambat di HP, Rina kompres gambar",
      "- next: demo ke klien Senin depan",
    ].join("\n"),
  },
  {
    key: "meeting-retro",
    label: { id: "Retro sprint", en: "Sprint retro" },
    text: [
      "Retro sprint 12",
      "+ deploy lebih lancar pakai checklist",
      "- banyak bug masuk telat dari QA",
      "- meeting terlalu panjang",
      "aksi: QA ikut daily, timebox meeting 30 menit (Andi)",
    ].join("\n"),
  },
];

/** What the demo "transcribes" from any recording (transcribeVoice). */
export const DEMO_VOICE_TRANSCRIPT =
  "Ingatkan saya kirim proposal ke klien besok jam 10, terus beli kopi buat kantor.";

/** What the demo "reads" from any photo (ocrImage). */
export const DEMO_OCR_TEXT = [
  "Rencana Q4",
  "1. Rilis aplikasi kasir v2 — akhir Oktober",
  "2. Integrasi pembayaran QRIS [?]",
  "3. Rekrut 1 desainer",
  "Catatan: anggaran marketing naik 10%",
].join("\n");

/** Typed QuickCapture examples (brain dumps first, then short points). */
export const DEMO_CAPTURE_EXAMPLES: readonly DemoExample[] = [
  ...DEMO_BRAIN_DUMP_EXAMPLES,
  ...DEMO_PARAPHRASE_EXAMPLES,
];

/**
 * Pending inbox items for the demo seed. "Proses dengan AI" has a polished fixture for each one;
 * "Perjelas poin" has one for the short point.
 */
export const DEMO_INBOX_ITEMS: readonly { content: string; source: "manual" | "voice" | "ocr" }[] =
  [
    { content: DEMO_BRAIN_DUMP_EXAMPLES[0]!.text, source: "manual" },
    { content: DEMO_PARAPHRASE_EXAMPLES[0]!.text, source: "manual" },
    { content: DEMO_VOICE_TRANSCRIPT, source: "voice" },
    { content: DEMO_OCR_TEXT, source: "ocr" },
  ];

/** Raw meeting note for the demo seed ("Buat notulen" turns it into the weekly fixture). */
export const DEMO_MEETING_NOTE = {
  title: "Weekly sync tim produk",
  content: DEMO_MEETING_EXAMPLES[0]!.text,
} as const;

/**
 * Tiny placeholder payloads for the demo "Pakai contoh" buttons on voice and OCR: they pass the
 * server validators, and the demo server ignores the bytes and returns the fixture.
 */
export const DEMO_AUDIO_STUB = { audioBase64: "AAAA", mimeType: "audio/webm" } as const;
export const DEMO_IMAGE_STUB = { imageBase64: "AAAA", mimeType: "image/png" } as const;

/** Picks the label in the active UI locale. */
export const demoLabel = (label: DemoLabel, locale: "id" | "en") => label[locale];

/** Start of every demo reply for free input that matches no example (callers must not save it). */
export const DEMO_AI_GENERIC_PREFIX = "Di demo, AI memakai contoh.";

/** "Di demo, AI memakai contoh. Coba salah satu contoh berikut: …" for the given examples. */
export function demoGenericReply(examples: readonly DemoExample[]): string {
  const list = examples.map((e) => `“${e.label.id}”`).join(", ");
  return `${DEMO_AI_GENERIC_PREFIX} Coba salah satu contoh berikut: ${list}.`;
}

/** True for the generic demo reply: show it as a hint instead of overwriting the user's text. */
export function isDemoGenericReply(text: string): boolean {
  return text.trimStart().startsWith(DEMO_AI_GENERIC_PREFIX);
}

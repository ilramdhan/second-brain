// Feature crops for the landing bento cells (docs/screenshots/landing/), cut from the raw lossless
// captures so text stays legible inside a small card. Sizes must match <BentoShot> in Landing.tsx.
import sharp from "sharp";
import { mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = process.env.SHOTS_RAW ?? "/tmp/sb-shots/raw";
const OUT = process.argv[2] ?? fileURLToPath(new URL("../landing", import.meta.url));
mkdirSync(OUT, { recursive: true });

// [output name, source shot, crop rect in source pixels, output width]
const CROPS = [
  ["inbox", "inbox-desktop", { left: 480, top: 150, width: 720, height: 470 }, 720],
  ["kanban", "tasks-kanban-desktop", { left: 288, top: 240, width: 892, height: 440 }, 892],
  ["automations", "automations-desktop", { left: 480, top: 280, width: 720, height: 215 }, 720],
  ["note", "note-mobile", { left: 0, top: 470, width: 780, height: 1080 }, 480],
  ["today", "today-mobile", { left: 0, top: 160, width: 780, height: 720 }, 420],
  ["telegram", "telegram-mobile", { left: 0, top: 250, width: 780, height: 720 }, 420],
];

let total = 0;
for (const [name, src, rect, width] of CROPS) {
  for (const theme of ["light", "dark"]) {
    const out = `${OUT}/${name}-${theme}.webp`;
    await sharp(`${SRC}/${src}-${theme}.png`)
      .extract(rect)
      .resize({ width })
      .webp({ quality: 74, effort: 6, smartSubsample: true })
      .toFile(out);
    const size = statSync(out).size;
    total += size;
    console.log(out.split("/").pop(), Math.round(size / 1024) + " KB");
  }
}
console.log("total", Math.round(total / 1024) + " KB");

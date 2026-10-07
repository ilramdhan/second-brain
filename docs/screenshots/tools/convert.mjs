// Converts the raw PNG captures to the committed WebP files in docs/screenshots/.
// Mobile shots are captured at 2x and stored at 1.5x (585×1266): crisp text, a third less weight.
import sharp from "sharp";
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = process.env.SHOTS_RAW ?? "/tmp/sb-shots/raw";
const OUT = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
mkdirSync(OUT, { recursive: true });
let total = 0;
for (const f of readdirSync(SRC)
  .filter((f) => f.endsWith(".png"))
  .sort()) {
  const out = `${OUT}/${f.replace(/\.png$/, ".webp")}`;
  let img = sharp(`${SRC}/${f}`);
  if (f.includes("-mobile-")) img = img.resize({ width: 585 });
  await img.webp({ quality: 72, effort: 6, smartSubsample: true }).toFile(out);
  const size = statSync(out).size;
  total += size;
  console.log(f, Math.round(size / 1024) + " KB");
}
console.log("total", Math.round(total / 1024) + " KB");

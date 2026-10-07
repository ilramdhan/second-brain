// Renders the static Telegram bot mockup (telegram-mockup.html) at 390×844 @2x, light and dark.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = process.env.SHOTS_RAW ?? "/tmp/sb-shots/raw";
mkdirSync(OUT, { recursive: true });
const page = new URL("./telegram-mockup.html", import.meta.url);

const b = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto(`file://${fileURLToPath(page)}?theme=${theme}`);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/telegram-mobile-${theme}.png` });
  await p.close();
}
await b.close();

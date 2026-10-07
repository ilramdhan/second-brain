// Captures the README/landing screenshots from the seeded demo with Playwright.
// Usage (from a scratch dir with `npm i playwright sharp` + `npx playwright install chromium`):
//   node docs/screenshots/tools/capture.mjs [page-prefix]
// Writes lossless PNGs to $SHOTS_RAW (default /tmp/sb-shots/raw); convert.mjs/crops.mjs make WebP.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.DEMO_URL ?? "https://demo-2ndbrain.ilramdhan.dev";
const OUT = process.env.SHOTS_RAW ?? "/tmp/sb-shots/raw";
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

const PAGES = [
  { name: "today", path: "/today" },
  { name: "tasks-kanban", path: "/tasks", tab: "Kanban" },
  { name: "calendar", path: "/calendar" },
  { name: "timeline", path: "/timeline" },
  { name: "notes", path: "/notes" },
  { name: "note", path: "/notes", openNote: "Printer Bluetooth ESC/POS" },
  { name: "graph", path: "/graph", settle: 4000 },
  { name: "reports", path: "/reports" },
  { name: "habits", path: "/habits" },
  { name: "inbox", path: "/inbox" },
  { name: "automations", path: "/automations" },
];

const browser = await chromium.launch();

// Sign in once with the public demo account ("Isi otomatis" fills it in) and reuse the session.
async function login() {
  const ctx = await browser.newContext(VIEWPORTS.desktop);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Isi otomatis" }).click();
  await p.locator("form button[type=submit]").first().click();
  await p.waitForURL(/\/today/, { timeout: 30000 });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

const state = await login();

for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      ...vp,
      storageState: state,
      colorScheme: theme,
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
    });
    await ctx.addCookies([{ name: "sb_theme", value: theme, url: BASE }]);
    // App theme + hide the dismissible demo notice so the page itself is in frame.
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("second-brain-theme", t);
        sessionStorage.setItem("second-brain-demo-notice-dismissed", "1");
      } catch {
        // storage blocked: the shot just keeps the default theme/notice
      }
    }, theme);
    const p = await ctx.newPage();
    for (const pg of PAGES) {
      if (only && !pg.name.startsWith(only)) continue;
      await p.goto(`${BASE}${pg.path}`, { waitUntil: "networkidle" });
      await p.waitForTimeout(1200);
      if (pg.tab) {
        await p.getByRole("tab", { name: pg.tab }).click();
        await p.waitForTimeout(800);
      }
      if (pg.openNote) {
        await p.getByText(pg.openNote, { exact: false }).first().click();
        await p.waitForURL(/\/notes\/.+/);
        await p.waitForLoadState("networkidle");
        await p.waitForTimeout(1500);
      }
      await p.waitForTimeout(pg.settle ?? 600);
      await p.mouse.move(0, 0);
      const file = `${OUT}/${pg.name}-${vpName}-${theme}.png`;
      await p.screenshot({ path: file });
      console.log("shot", file);
    }
    await ctx.close();
  }
}
await browser.close();

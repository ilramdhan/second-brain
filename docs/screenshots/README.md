# Screenshots

Screenshots of the seeded [public demo](https://demo-2ndbrain.ilramdhan.dev), used by the main
README gallery and the landing page (`src/components/landing/Screenshots.tsx`).

- `<page>-<desktop|mobile>-<light|dark>.webp`: full views. Desktop is 1440×900 @1x, mobile is a
  390×844 viewport captured @2x and stored at 1.5x (585×1266).
- `landing/<feature>-<light|dark>.webp`: crops shown inside the landing bento cards.
- `telegram-mobile-*.webp`: a static mockup (`tools/telegram-mockup.html`) of the bot's real
  replies from `src/server/n8n/bot.server.ts`, because a real chat would show account details.

All files are WebP. The landing imports them through Vite (hashed `assets/`), and the PWA
precache only globs js/css/woff2, so the images are fetched on demand and never grow the install.

## Refresh

The tools are not app dependencies. Run them from a scratch directory:

```bash
mkdir -p /tmp/sb-shots && cd /tmp/sb-shots
npm init -y && npm i playwright sharp && npx playwright install chromium
REPO=/path/to/second-brain
node $REPO/docs/screenshots/tools/capture.mjs   # signs in with "Isi otomatis", raw PNGs → /tmp/sb-shots/raw
node $REPO/docs/screenshots/tools/tg.mjs        # Telegram mockup
node $REPO/docs/screenshots/tools/convert.mjs   # → docs/screenshots/*.webp
node $REPO/docs/screenshots/tools/crops.mjs     # → docs/screenshots/landing/*.webp
```

Capture after the nightly demo reset so the data matches the seed, and check that no real
personal data is visible before committing.

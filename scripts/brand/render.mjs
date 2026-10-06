// Rasterises the brand SVGs in this folder into public/ (OG image, PNG icons, favicon.ico).
// The tools are NOT project dependencies; install them in a throwaway directory first:
//
//   mkdir -p /tmp/brand-tools && (cd /tmp/brand-tools && npm init -y && npm i @resvg/resvg-js)
//   BRAND_TOOLS=/tmp/brand-tools node scripts/brand/render.mjs
//
// Fonts: the OG banner uses Helvetica Neue (static bold faces; the app itself renders with the system-ui stack). Pass extra font
// files with BRAND_FONTS=/path/a.ttf:/path/b.ttf.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "../../public");
const tools = createRequire(join(process.env.BRAND_TOOLS ?? "/tmp/brand-tools", "package.json"));
const { Resvg } = tools("@resvg/resvg-js");

const fontFiles = (process.env.BRAND_FONTS ?? "").split(":").filter(Boolean);

/** ICO container with PNG-encoded entries (supported by every current browser). */
function toIco(pngs, sizes) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(sizes[i] % 256, entry);
    header.writeUInt8(sizes[i] % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}

function render(svgFile, width, transform = (svg) => svg) {
  const svg = transform(readFileSync(join(here, svgFile), "utf8"));
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true, fontFiles, defaultFontFamily: "Helvetica Neue" },
  });
  return resvg.render().asPng();
}

writeFileSync(join(pub, "og-image.png"), render("og-image.svg", 1200));
for (const [name, size] of [
  ["icon-512.png", 512],
  ["icon-192.png", 192],
  ["apple-touch-icon.png", 180],
  ["favicon.png", 64],
]) {
  writeFileSync(join(pub, name), render("icon.svg", size));
}
// Maskable: launchers crop to a circle or squircle, so the brain shrinks to sit well inside the
// 80% safe zone.
writeFileSync(
  join(pub, "icon-maskable-512.png"),
  render("icon.svg", 512, (svg) =>
    svg.replace("translate(106 106) scale(12.5)", "translate(136 136) scale(10)"),
  ),
);
// The .ico uses the rounded favicon art (light variant) so tabs without SVG support match.
const favicon = readFileSync(join(pub, "favicon.svg"), "utf8").replace(/@media[^}]*}\s*}/, "");
const icoPngs = [16, 32, 48].map((size) =>
  new Resvg(favicon, { fitTo: { mode: "width", value: size } }).render().asPng(),
);
writeFileSync(join(pub, "favicon.ico"), toIco(icoPngs, [16, 32, 48]));
console.log("brand assets written to public/");

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  demoUrl,
  jsonLd,
  LANDING_JSON_LD,
  landingHead,
  OG_IMAGE,
  publicPageHead,
  SITE_URL,
} from "@/lib/landing";

type Meta = Record<string, unknown>;
const pub = join(__dirname, "../../public");

function metaContent(meta: Meta[], key: string): unknown {
  return meta.find((m) => m["name"] === key || m["property"] === key)?.["content"];
}

describe("landing <head>", () => {
  const head = landingHead();

  it("has a unique title, description, canonical and index robots", () => {
    expect(head.meta.find((m) => "title" in m)).toEqual({
      title: "Second Brain — tugas & catatan dengan AI",
    });
    expect(String(metaContent(head.meta, "description")).length).toBeGreaterThan(50);
    expect(metaContent(head.meta, "robots")).toBe("index, follow");
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://2ndbrain.ilramdhan.dev/",
    });
  });

  it("has Open Graph tags with an absolute 1200x630 image", () => {
    expect(metaContent(head.meta, "og:url")).toBe(`${SITE_URL}/`);
    expect(metaContent(head.meta, "og:type")).toBe("website");
    expect(metaContent(head.meta, "og:site_name")).toBe("Second Brain");
    expect(metaContent(head.meta, "og:locale")).toBe("id_ID");
    expect(metaContent(head.meta, "og:locale:alternate")).toBe("en_US");
    expect(metaContent(head.meta, "og:image")).toBe("https://2ndbrain.ilramdhan.dev/og-image.png");
    expect(metaContent(head.meta, "og:image:width")).toBe("1200");
    expect(metaContent(head.meta, "og:image:height")).toBe("630");
    expect(metaContent(head.meta, "og:image:type")).toBe("image/png");
    expect(metaContent(head.meta, "og:image:alt")).toBeTruthy();
  });

  it("has a large-image Twitter card", () => {
    expect(metaContent(head.meta, "twitter:card")).toBe("summary_large_image");
    expect(metaContent(head.meta, "twitter:image")).toBe(OG_IMAGE.url);
    expect(metaContent(head.meta, "twitter:title")).toBeTruthy();
    expect(metaContent(head.meta, "twitter:description")).toBeTruthy();
  });

  it("embeds WebApplication JSON-LD", () => {
    expect(head.scripts).toHaveLength(1);
    const [script] = head.scripts;
    expect(script?.type).toBe("application/ld+json");
    expect(JSON.parse(script?.children ?? "")).toEqual(LANDING_JSON_LD);
    expect(jsonLd({ a: "</script>" })).not.toContain("</script>");
    expect(LANDING_JSON_LD).toMatchObject({
      "@type": "WebApplication",
      url: `${SITE_URL}/`,
      applicationCategory: "ProductivityApplication",
      operatingSystem: "Web",
      offers: { price: "0" },
      isBasedOn: { codeRepository: "https://github.com/ilramdhan/second-brain" },
    });
  });

  it("builds the login page head with its own canonical", () => {
    const login = publicPageHead({ title: "Masuk", description: "d", path: "/login" });
    expect(login.links).toEqual([{ rel: "canonical", href: `${SITE_URL}/login` }]);
    expect(metaContent(login.meta, "og:url")).toBe(`${SITE_URL}/login`);
  });
});

describe("demoUrl", () => {
  it("is hidden without a valid http(s) URL", () => {
    expect(demoUrl(undefined)).toBeNull();
    expect(demoUrl("")).toBeNull();
    expect(demoUrl("  ")).toBeNull();
    expect(demoUrl("not a url")).toBeNull();
    expect(demoUrl("javascript:alert(1)")).toBeNull();
  });

  it("accepts an absolute https URL", () => {
    expect(demoUrl(" https://2ndbrain-demo.ilramdhan.dev ")).toBe(
      "https://2ndbrain-demo.ilramdhan.dev/",
    );
  });
});

describe("public brand assets", () => {
  function pngSize(file: string) {
    const buf = readFileSync(join(pub, file));
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
  }

  it("ships a 1200x630 OG image under 300 KB", () => {
    expect(pngSize("og-image.png")).toMatchObject({ width: 1200, height: 630 });
    expect(pngSize("og-image.png").bytes).toBeLessThan(300 * 1024);
  });

  it("ships correctly sized icons referenced by the manifest", () => {
    expect(pngSize("apple-touch-icon.png")).toMatchObject({ width: 180, height: 180 });
    const manifest = JSON.parse(readFileSync(join(pub, "manifest.webmanifest"), "utf8")) as {
      start_url: string;
      scope: string;
      lang: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(manifest).toMatchObject({ start_url: "/today", scope: "/", lang: "id" });
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons.filter((i) => i.src.endsWith(".png"))) {
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(icon.src.slice(1))).toMatchObject({ width: w, height: h });
    }
    expect(readFileSync(join(pub, "favicon.svg"), "utf8")).toContain("prefers-color-scheme: dark");
  });

  it("points robots.txt at the absolute sitemap", () => {
    expect(readFileSync(join(pub, "robots.txt"), "utf8")).toContain(
      "Sitemap: https://2ndbrain.ilramdhan.dev/sitemap.xml",
    );
    expect(readFileSync(join(pub, "sitemap.xml"), "utf8")).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}/);
  });
});

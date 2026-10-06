import { redirect } from "@tanstack/react-router";

/** Public production origin, used for canonical and Open Graph URLs on the public pages. */
export const SITE_URL = "https://2ndbrain.ilramdhan.dev";
export const SITE_NAME = "Second Brain";
export const AUTHOR = "Ilham Ramadhan";
export const GITHUB_URL = "https://github.com/ilramdhan/second-brain";
export const SECURITY_URL = `${GITHUB_URL}/blob/main/SECURITY.md`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
/** Same value as APP_HOME in src/lib/auth.ts (kept here so the landing chunk stays Supabase-free). */
export const APP_HOME_PATH = "/today";

/** Social preview image: public/og-image.png, rendered from scripts/brand/og-image.svg. */
export const OG_IMAGE = {
  url: `${SITE_URL}/og-image.png`,
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Second Brain: otak kedua untuk tugas dan catatan Anda, dengan kartu inbox, kanban, graph, dan automations.",
} as const;

export const LANDING_TITLE = "Second Brain — tugas & catatan dengan AI";
export const LANDING_DESCRIPTION =
  "Tangkap ide, biarkan AI merapikannya, lalu kelola tugas (list, kanban, kalender, timeline), catatan berblok, dan proyek tim. Open source, PWA.";

/**
 * Optional public demo deployment (Phase 10). The "Coba Demo" button stays hidden unless
 * `VITE_DEMO_URL` is set at build time; only absolute http(s) URLs are accepted.
 */
export function demoUrl(raw: unknown = import.meta.env["VITE_DEMO_URL"]): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

type PageMeta = { title: string; description: string; path: string; robots?: string };

/**
 * `<head>` entries for a public page: title, description, robots, canonical, Open Graph and
 * Twitter card. Every URL is absolute on the production origin, because crawlers and chat apps
 * do not resolve a relative og:image.
 */
export function publicPageHead({ title, description, path, robots = "index, follow" }: PageMeta) {
  const url = `${SITE_URL}${path}`;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: robots },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:locale", content: "id_ID" },
      { property: "og:locale:alternate", content: "en_US" },
      { property: "og:image", content: OG_IMAGE.url },
      { property: "og:image:secure_url", content: OG_IMAGE.url },
      { property: "og:image:type", content: OG_IMAGE.type },
      { property: "og:image:width", content: String(OG_IMAGE.width) },
      { property: "og:image:height", content: String(OG_IMAGE.height) },
      { property: "og:image:alt", content: OG_IMAGE.alt },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: OG_IMAGE.url },
      { name: "twitter:image:alt", content: OG_IMAGE.alt },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/** schema.org description for rich results (an inert `application/ld+json` script; CSP-safe). */
export const LANDING_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  description: LANDING_DESCRIPTION,
  applicationCategory: "ProductivityApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires JavaScript. Installable as a PWA.",
  inLanguage: ["id", "en"],
  image: OG_IMAGE.url,
  license: "https://opensource.org/licenses/MIT",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: { "@type": "Person", name: AUTHOR, url: "https://github.com/ilramdhan" },
  sameAs: [GITHUB_URL],
  // `codeRepository` is a SoftwareSourceCode property, so the source is linked via isBasedOn.
  isBasedOn: {
    "@type": "SoftwareSourceCode",
    name: SITE_NAME,
    codeRepository: GITHUB_URL,
    license: "https://opensource.org/licenses/MIT",
    programmingLanguage: "TypeScript",
  },
};

/** Full `<head>` of the landing page `/`. */
export function landingHead() {
  const head = publicPageHead({
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    path: "/",
  });
  return {
    ...head,
    meta: [
      ...head.meta,
      { name: "keywords", content: "second brain, catatan, tugas, kanban, PKM, PWA, open source" },
    ],
    // `application/ld+json` is data, never executed, so the CSP's script-src does not apply.
    scripts: [{ type: "application/ld+json", children: jsonLd(LANDING_JSON_LD) }],
  };
}

/** JSON for an inline `<script>`: `<` is escaped so the text can never close the tag. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Signed-in visitors skip the landing page. The Supabase session lives in browser storage, so the
 * check only runs in the browser; the server always renders the landing page (SEO, fast LCP).
 * The auth module (and with it supabase-js) is loaded lazily so the landing chunk stays small and
 * a deployment without Supabase env still renders the page.
 */
export async function isSignedIn(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const { hasStoredSession } = await import("@/lib/auth");
  return hasStoredSession();
}

/** `beforeLoad` of `/`: throws a router redirect to the app for a signed-in visitor. */
export async function redirectSignedInVisitor(): Promise<void> {
  if (await isSignedIn()) throw redirect({ to: APP_HOME_PATH, replace: true });
}

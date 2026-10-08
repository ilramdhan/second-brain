import { redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { robotsFor } from "@/lib/app-mode";
import { REPO_URL } from "@/lib/app-version";
import { messages, type Locale } from "@/lib/i18n";

/** Public production origin, used for canonical and Open Graph URLs on the public pages. */
export const SITE_URL = "https://2ndbrain.ilramdhan.dev";
export const SITE_NAME = "Second Brain";
export const AUTHOR = "Ilham Ramadhan";
export const GITHUB_URL = REPO_URL;
export const SECURITY_URL = `${GITHUB_URL}/blob/main/SECURITY.md`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
/** README section with the Vercel + Supabase deployment steps. */
export const SELF_HOST_DOCS_URL = `${GITHUB_URL}#deployment-to-vercel`;
export const N8N_DOCS_URL = `${GITHUB_URL}/blob/main/integrations/n8n/README.md`;
export const ENV_EXAMPLE_URL = `${GITHUB_URL}/blob/main/.env.example`;
/** Same value as APP_HOME in src/lib/auth.ts (kept here so the landing chunk stays Supabase-free). */
export const APP_HOME_PATH = "/today";

/** Social preview image: public/og-image.png, rendered from scripts/brand/og-image.svg. */
export const OG_IMAGE = {
  url: `${SITE_URL}/og-image.png`,
  width: 1200,
  height: 630,
  type: "image/png",
  alt: messages.id.metaOgImageAlt,
} as const;

export const LANDING_TITLE = messages.id.metaLandingTitle;
export const LANDING_DESCRIPTION = messages.id.metaLandingDesc;

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

/**
 * Public self-service sign-up (`VITE_ALLOW_SIGNUP=true` at build time). Off by default: the
 * login page then only offers "Masuk". This hides the UI only; the server-side switch is
 * Supabase _Authentication → Sign In / Providers → Allow new users to sign up_, because
 * `auth.signUp` can be called directly with the public anon key.
 */
export function signupAllowed(raw: unknown = import.meta.env["VITE_ALLOW_SIGNUP"]): boolean {
  return typeof raw === "string" && raw.trim().toLowerCase() === "true";
}

type PageMeta = {
  title: string;
  description: string;
  path: string;
  robots?: string;
  /** Language of the page text (the `sb_lang` cookie, see src/lib/page-head.ts). */
  locale?: Locale;
};

/**
 * `<head>` entries for a public page: title, description, robots, canonical, Open Graph and
 * Twitter card. Every URL is absolute on the production origin, because crawlers and chat apps
 * do not resolve a relative og:image.
 */
export function publicPageHead({
  title,
  description,
  path,
  robots = "index, follow",
  locale = "id",
}: PageMeta) {
  const url = `${SITE_URL}${path}`;
  const imageAlt = messages[locale].metaOgImageAlt;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      // The demo deployment (VITE_APP_MODE=demo) is never indexed, whatever the page asks for.
      { name: "robots", content: robotsFor(robots) },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:locale", content: locale === "en" ? "en_US" : "id_ID" },
      { property: "og:locale:alternate", content: locale === "en" ? "id_ID" : "en_US" },
      { property: "og:image", content: OG_IMAGE.url },
      { property: "og:image:secure_url", content: OG_IMAGE.url },
      { property: "og:image:type", content: OG_IMAGE.type },
      { property: "og:image:width", content: String(OG_IMAGE.width) },
      { property: "og:image:height", content: String(OG_IMAGE.height) },
      { property: "og:image:alt", content: imageAlt },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: OG_IMAGE.url },
      { name: "twitter:image:alt", content: imageAlt },
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
export function landingHead(locale: Locale = "id") {
  const head = publicPageHead({
    title: messages[locale].metaLandingTitle,
    description: messages[locale].metaLandingDesc,
    path: "/",
    locale,
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

/**
 * `beforeLoad` of `/` and `/login`: throws a router redirect to the app for a signed-in visitor.
 * `target` is an already validated same-origin path (`safeRedirect`), e.g. the page the auth
 * guard bounced the visitor from; without it the visitor lands on the app home.
 */
export async function redirectSignedInVisitor(target?: string): Promise<void> {
  if (!(await isSignedIn())) return;
  throw target
    ? redirect({ href: target, replace: true })
    : redirect({ to: APP_HOME_PATH, replace: true });
}

/**
 * Client fallback for {@link redirectSignedInVisitor}. On the first page load `beforeLoad` ran
 * on the server (where the session is unknown) and is not repeated during hydration, so a
 * signed-in visitor opening a `/` or `/login` bookmark is forwarded from here after mount.
 */
export function useRedirectSignedInVisitor(target?: string): void {
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    void isSignedIn().then((signedIn) => {
      if (!active || !signedIn) return;
      if (target) void navigate({ href: target, replace: true });
      else void navigate({ to: APP_HOME_PATH, replace: true });
    });
    return () => {
      active = false;
    };
  }, [navigate, target]);
}

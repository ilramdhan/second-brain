// Locale-aware `<head>` for routes. `head()` runs after the loaders, and its context carries every
// match of the location, including the root one whose loader returns the `sb_lang` cookie
// (src/lib/preferences-ssr.ts). So the SSR HTML already has the title in the visitor's language;
// RootComponent invalidates the router when the language changes in the app, which re-runs every
// head() with the new cookie value.

import { rootRouteId } from "@tanstack/react-router";

import { format, messages, type Locale, type MessageKey } from "@/lib/i18n";
import { SITE_NAME } from "@/lib/landing";

/** The parts of the head() context this helper reads (optional: tests call `head()` bare). */
export type HeadContext = {
  matches?: readonly { routeId: string; loaderData?: unknown }[];
};

/** Locale of the root loader (the `sb_lang` cookie); Indonesian when it is not known. */
export function headLocale(ctx?: HeadContext): Locale {
  const root = ctx?.matches?.find((m) => m.routeId === rootRouteId)?.loaderData as
    { locale?: unknown } | undefined;
  return root?.locale === "en" ? "en" : "id";
}

/** `t()` for head() functions, in the locale of the request/cookie. */
export function headT(ctx?: HeadContext) {
  const locale = headLocale(ctx);
  return (key: MessageKey) => format(messages[locale][key]);
}

/** "Page — Second Brain". */
export const pageTitle = (title: string) => `${title} — ${SITE_NAME}`;

/**
 * Head of an app page: title, description and the small Open Graph/Twitter set. `ogDesc`
 * defaults to the description; `extra` is appended (e.g. a robots tag).
 */
export function pageHead(
  ctx: HeadContext | undefined,
  keys: { title: MessageKey; desc: MessageKey; ogDesc?: MessageKey },
  extra: { name: string; content: string }[] = [],
) {
  const t = headT(ctx);
  const title = pageTitle(t(keys.title));
  const description = t(keys.desc);
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: keys.ogDesc ? t(keys.ogDesc) : description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      ...extra,
    ],
  };
}

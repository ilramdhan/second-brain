// UI dictionaries, split per area so no single file grows unbounded. Each area file exports
// `id` (Indonesian, the default locale and the source of the key set) and `en`, typed
// `satisfies Record<keyof typeof id, string>` so a missing English key fails `tsc`.
// src/lib/i18n/i18n.test.ts also checks that both locales have identical, non-empty keys and
// that no key is defined by two areas.
//
// Placeholders use `{name}` and are filled by `t(key, { name })` (see `format` below).

import type { Locale as DateFnsLocale } from "date-fns";
import { enUS, id as dateFnsId } from "date-fns/locale";

import * as admin from "./admin";
import * as auth from "./auth";
import * as automations from "./automations";
import * as core from "./core";
import * as meta from "./meta";
import * as notes from "./notes";
import * as tasks from "./tasks";
import * as workspace from "./workspace";

/** Every area, in merge order (exported for the key-collision test). */
export const areas = { core, auth, tasks, notes, workspace, automations, admin, meta } as const;

export const messages = {
  id: {
    ...core.id,
    ...auth.id,
    ...tasks.id,
    ...notes.id,
    ...workspace.id,
    ...automations.id,
    ...admin.id,
    ...meta.id,
  },
  en: {
    ...core.en,
    ...auth.en,
    ...tasks.en,
    ...notes.en,
    ...workspace.en,
    ...automations.en,
    ...admin.en,
    ...meta.en,
  },
} as const;

export type Locale = "id" | "en";
export type MessageKey = keyof typeof messages.id;
export type MessageVars = Record<string, string | number>;

/** Fill `{name}` placeholders; unknown placeholders are left as-is. */
export function format(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** BCP 47 tag for `Intl` / `toLocale*String`. */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "id-ID";
}

/** date-fns locale object for `format` / `formatDistanceToNow`. */
export function dateLocale(locale: Locale): DateFnsLocale {
  return locale === "en" ? enUS : dateFnsId;
}

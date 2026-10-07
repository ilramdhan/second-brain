import { describe, expect, it } from "vitest";

import { areas, dateLocale, format, intlLocale, messages } from "./index";

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (s: string) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

describe("i18n dictionaries", () => {
  it("ID and EN have exactly the same keys", () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.id).sort());
  });

  it("every area has the same keys in both locales", () => {
    for (const [name, area] of Object.entries(areas)) {
      expect(Object.keys(area.en).sort(), name).toEqual(Object.keys(area.id).sort());
    }
  });

  it("no key is defined by two areas (later spreads would silently win)", () => {
    const seen = new Map<string, string>();
    for (const [name, area] of Object.entries(areas)) {
      for (const key of Object.keys(area.id)) {
        expect(seen.get(key), `${key} in ${name}`).toBeUndefined();
        seen.set(key, name);
      }
    }
  });

  it("has no empty strings", () => {
    for (const locale of ["id", "en"] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect((value as string).trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("uses the same {placeholders} in both locales", () => {
    for (const key of Object.keys(messages.id) as (keyof typeof messages.id)[]) {
      expect(placeholders(messages.en[key]), key).toEqual(placeholders(messages.id[key]));
    }
  });
});

describe("format", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(format("{n} dari {total}", { n: 2, total: 5 })).toBe("2 dari 5");
    expect(format("Halo {name}", {})).toBe("Halo {name}");
    expect(format("Tanpa var")).toBe("Tanpa var");
  });

  it("maps locales to Intl tags and date-fns locales", () => {
    expect(intlLocale("id")).toBe("id-ID");
    expect(intlLocale("en")).toBe("en-US");
    expect(dateLocale("id").code).toBe("id");
    expect(dateLocale("en").code).toBe("en-US");
  });
});

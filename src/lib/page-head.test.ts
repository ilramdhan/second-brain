import { rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { fieldLabels, fillSummary, PROJECT_FIELD_LABEL } from "@/lib/capture-fields";
import { CronError, cronErrorText, describeCron, parseCron } from "@/lib/cron";
import { format, messages, type MessageKey } from "@/lib/i18n";
import { landingHead } from "@/lib/landing";
import { formToInsert, emptyNoteForm } from "@/lib/note-prefill";
import { optionLabel, translatedOptions } from "@/lib/option-labels";
import { PARA } from "@/lib/constants";
import { headLocale, pageHead } from "@/lib/page-head";

const ctx = (locale: unknown) => ({
  matches: [
    { routeId: rootRouteId, loaderData: { locale, theme: "system" } },
    { routeId: "/_authenticated/tasks" },
  ],
});
const en = (key: MessageKey, vars?: Record<string, string | number>) =>
  format(messages.en[key], vars);
const title = (head: { meta: Record<string, unknown>[] }) =>
  head.meta.find((m) => "title" in m)?.["title"];

describe("route <head> locale", () => {
  it("reads the root loader locale and defaults to Indonesian", () => {
    expect(headLocale(ctx("en"))).toBe("en");
    expect(headLocale(ctx("fr"))).toBe("id");
    expect(headLocale()).toBe("id");
  });

  it("builds app page titles in the cookie language", () => {
    const keys = { title: "metaTasksTitle", desc: "metaTasksDesc" } as const;
    expect(title(pageHead(undefined, keys))).toBe("Tugas — Second Brain");
    expect(title(pageHead(ctx("en"), keys))).toBe("Tasks — Second Brain");
  });

  it("translates the landing page and flips og:locale", () => {
    const head = landingHead("en");
    expect(title(head)).toBe("Second Brain — tasks & notes with AI");
    expect(head.meta).toContainEqual({ property: "og:locale", content: "en_US" });
    expect(head.meta).toContainEqual({ property: "og:locale:alternate", content: "id_ID" });
  });
});

describe("option labels", () => {
  it("translates constants options and falls back to the raw id", () => {
    expect(optionLabel(en, "projectStatus", "on_hold")).toBe("On hold");
    expect(optionLabel(en, "noteStatus", "draft")).toBe("Draft");
    expect(optionLabel(en, "color", "violet")).toBe("Purple");
    expect(optionLabel(en, "para", "unknown")).toBe("unknown");
    expect(translatedOptions(en, "para", PARA).map((p) => p.label)).toEqual([
      "Projects",
      "Areas",
      "Resources",
      "Archives",
    ]);
  });
});

describe("capture fields and untitled fallback", () => {
  it("summarises a fill in English", () => {
    const labels = fieldLabels(en, PROJECT_FIELD_LABEL);
    expect(fillSummary({ via: "ai", filled: ["color"], dropped: [] }, labels, [], en)).toBe(
      "Filled by AI: color · Review, then save.",
    );
  });

  it("uses the given untitled title", () => {
    expect(formToInsert(emptyNoteForm(null), "Untitled").title).toBe("Untitled");
  });
});

describe("cron errors", () => {
  it("keeps the Indonesian message and translates by code", () => {
    let error: unknown;
    try {
      parseCron("61 * * * *");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CronError);
    const cron = error as CronError;
    expect(cron.message).toBe('menit harus 0–59 (dapat "61")');
    expect(cronErrorText(cron, "en")).toBe('minute must be 0–59 (got "61")');
    expect(describeCron("* *", "en")).toBe(
      "Invalid: cron needs 5 parts (minute hour day-of-month month day-of-week), got 2",
    );
    expect(describeCron("* *")).toBe(
      "Tidak valid: cron harus 5 bagian (menit jam tanggal bulan hari), dapat 2",
    );
  });
});

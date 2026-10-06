import { Info } from "lucide-react";

import { LEGAL_DOCS, LEGAL_UPDATED, type LegalBlock } from "@/components/legal/content";
import { PAGE, SiteFooter, SiteHeader, SkipLink, TEXT_LINK } from "@/components/landing/SiteChrome";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") return <p>{block}</p>;
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
      {block.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Public legal page (privacy policy or terms) in the active UI language. */
export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const { t, locale } = usePreferences();
  const doc = LEGAL_DOCS[kind][locale];
  const title = t(kind === "privacy" ? "legalPrivacyTitle" : "legalTermsTitle");
  const updated = new Date(`${LEGAL_UPDATED}T00:00:00Z`).toLocaleDateString(
    locale === "id" ? "id-ID" : "en-US",
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
  );
  return (
    <div data-public-page className="min-h-screen bg-background text-foreground">
      <SkipLink />
      <SiteHeader />
      <main id="main" tabIndex={-1} className={cn(PAGE, "py-10 focus:outline-none md:py-14")}>
        <article className="mx-auto max-w-3xl" aria-labelledby="legal-title">
          <header className="border-b pb-6">
            <h1 id="legal-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("legalUpdated")}: <time dateTime={LEGAL_UPDATED}>{updated}</time>
            </p>
            <p className="mt-4 text-pretty text-muted-foreground">{doc.intro}</p>
            <aside
              className="mt-4 flex gap-3 rounded-xl border bg-muted/40 p-4 text-sm"
              aria-label={locale === "id" ? "Catatan" : "Note"}
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <p>{t("legalNotAdvice")}</p>
            </aside>
          </header>
          <nav aria-label={t("legalToc")} className="border-b py-6">
            <h2 className="text-sm font-semibold">{t("legalToc")}</h2>
            <ol className="mt-3 grid list-decimal gap-1.5 pl-5 text-sm text-muted-foreground sm:grid-cols-2">
              {doc.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className={TEXT_LINK}>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="space-y-10 pt-8 leading-relaxed">
            {doc.sections.map((section, i) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="space-y-3"
              >
                <h2 id={`${section.id}-title`} className="text-xl font-semibold tracking-tight">
                  {i + 1}. {section.title}
                </h2>
                {section.blocks.map((block, j) => (
                  <Block key={j} block={block} />
                ))}
              </section>
            ))}
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

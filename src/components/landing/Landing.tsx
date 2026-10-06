import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Brain,
  CalendarDays,
  CheckSquare,
  Inbox,
  Network,
  Scale,
  Send,
  Smartphone,
  Users,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/landing";
import { usePreferences, type MessageKey } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/*
 * Public landing page. The visuals are static HTML/SVG mockups (no app components, no data
 * hooks, no Supabase) so this chunk stays small and renders on the server. Motion only runs
 * under `motion-safe:`, so `prefers-reduced-motion` turns it off.
 */

type CardProps = {
  icon: typeof Inbox;
  title: MessageKey;
  body: MessageKey;
  className?: string;
  children?: ReactNode;
};

function BentoCard({ icon: Icon, title, body, className, children }: CardProps) {
  const { t } = usePreferences();
  return (
    <article
      className={cn(
        "flex flex-col gap-4 overflow-hidden rounded-2xl border bg-card p-5 text-card-foreground",
        className,
      )}
    >
      <div>
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <h3 className="text-base font-semibold tracking-tight">{t(title)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t(body)}</p>
      </div>
      {children && (
        <div className="mt-auto" aria-hidden>
          {children}
        </div>
      )}
    </article>
  );
}

/** GitHub mark (lucide no longer ships brand icons). */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function InboxMock() {
  return (
    <div className="space-y-2 rounded-xl border bg-background p-3 text-xs">
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-muted-foreground">
        <span className="truncate">rapat dengan tim desain jumat 10.00 #proyek-web !tinggi</span>
        <span className="ml-auto h-4 w-px bg-foreground motion-safe:animate-pulse" />
      </div>
      <div className="flex justify-center text-muted-foreground">
        <ArrowRight className="h-3.5 w-3.5 rotate-90" />
      </div>
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-primary" />
          <span className="font-medium text-foreground">Rapat dengan tim desain</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-md bg-tone-blue/15 px-1.5 py-0.5 text-tone-blue">Jum 10.00</span>
          <span className="rounded-md bg-tone-teal/15 px-1.5 py-0.5 text-tone-teal">
            proyek-web
          </span>
          <span className="rounded-md bg-priority-high/15 px-1.5 py-0.5 text-priority-high">
            tinggi
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        {["Teks", "Suara", "Foto"].map((label) => (
          <span key={label} className="rounded-md bg-inbox px-2 py-1 text-inbox-foreground">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function KanbanMock() {
  const columns = [
    { name: "To do", cards: [70, 45], tone: "bg-tone-slate" },
    { name: "Doing", cards: [85], tone: "bg-tone-amber" },
    { name: "Done", cards: [60, 75], tone: "bg-tone-green" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 rounded-xl border bg-background p-3 text-[10px]">
      {columns.map((col) => (
        <div key={col.name} className="space-y-1.5">
          <div className="flex items-center gap-1 font-medium text-muted-foreground">
            <span className={cn("h-1.5 w-1.5 rounded-full", col.tone)} />
            {col.name}
          </div>
          {col.cards.map((w, i) => (
            <div key={i} className="space-y-1 rounded-md border bg-card p-1.5">
              <div className="h-1.5 rounded-full bg-foreground/20" style={{ width: `${w}%` }} />
              <div className="h-1.5 w-1/3 rounded-full bg-foreground/10" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function GraphMock() {
  const nodes = [
    [50, 40, 7],
    [20, 20, 4],
    [85, 22, 5],
    [18, 68, 5],
    [80, 70, 4],
    [52, 88, 3.5],
  ] as const;
  const edges = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [3, 5],
    [4, 5],
    [1, 3],
  ] as const;
  return (
    <svg viewBox="0 0 100 100" className="h-32 w-full text-primary" role="presentation">
      {edges.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={nodes[a][0]}
          y1={nodes[a][1]}
          x2={nodes[b][0]}
          y2={nodes[b][1]}
          className="stroke-border"
          strokeWidth={0.8}
        />
      ))}
      {nodes.map(([x, y, r], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={r}
          className={i === 0 ? "fill-primary" : "fill-primary/40"}
        />
      ))}
    </svg>
  );
}

function CollabMock() {
  return (
    <div className="relative rounded-xl border bg-background p-3 text-xs">
      <div className="h-1.5 w-4/5 rounded-full bg-foreground/20" />
      <div className="mt-2 flex items-center gap-0.5">
        <div className="h-1.5 w-1/2 rounded-full bg-foreground/20" />
        <span className="h-3 w-0.5 bg-tone-rose motion-safe:animate-pulse" />
        <span className="rounded bg-tone-rose px-1 text-[9px] text-primary-foreground">Rani</span>
      </div>
      <div className="mt-2 flex items-center gap-0.5">
        <div className="h-1.5 w-1/3 rounded-full bg-foreground/20" />
        <span className="h-3 w-0.5 bg-tone-violet motion-safe:animate-pulse" />
        <span className="rounded bg-tone-violet px-1 text-[9px] text-primary-foreground">Adi</span>
      </div>
    </div>
  );
}

function AutomationMock() {
  const steps = ["Status → Selesai", "Pindah ke Arsip", "Kirim webhook"];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-lg border px-2 py-1",
              i === 0 ? "bg-primary text-primary-foreground" : "bg-background",
            )}
          >
            {step}
          </span>
          {i < steps.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

function ChatMock() {
  return (
    <div className="space-y-2 rounded-xl border bg-background p-3 text-xs">
      <div className="ml-auto w-fit max-w-[80%] rounded-lg rounded-br-sm bg-primary px-2.5 py-1.5 text-primary-foreground">
        /task bayar listrik besok 09.00
      </div>
      <div className="w-fit max-w-[85%] rounded-lg rounded-bl-sm bg-muted px-2.5 py-1.5">
        Tugas dibuat: Bayar listrik · besok 09.00
      </div>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        <span>Tersinkron ke Google Calendar</span>
      </div>
    </div>
  );
}

export function Landing() {
  const { t } = usePreferences();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-5 md:px-6">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <Brain className="h-6 w-6 text-primary" aria-hidden />
          Second Brain
        </span>
        <Button asChild size="sm">
          <Link to="/login">{t("landingSignIn")}</Link>
        </Button>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-5 md:px-6">
        <section className="py-10 text-center md:py-16">
          <p className="text-xs font-medium tracking-wide text-primary uppercase">
            {t("landingEyebrow")}
          </p>
          <h1 className="mx-auto mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl md:text-5xl">
            {t("landingTitle")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-pretty text-muted-foreground">
            {t("landingSubtitle")}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button asChild size="lg">
              <Link to="/login">
                {t("landingSignIn")}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GithubMark />
                {t("landingGithub")}
              </a>
            </Button>
          </div>
        </section>

        <section aria-label={t("landingFeatures")}>
          <div className="grid grid-flow-dense grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BentoCard
              icon={Inbox}
              title="landingInboxTitle"
              body="landingInboxBody"
              className="sm:col-span-2 lg:row-span-2"
            >
              <InboxMock />
            </BentoCard>
            <BentoCard
              icon={CheckSquare}
              title="landingTasksTitle"
              body="landingTasksBody"
              className="sm:col-span-2"
            >
              <KanbanMock />
            </BentoCard>
            <BentoCard icon={Users} title="landingCollabTitle" body="landingCollabBody">
              <CollabMock />
            </BentoCard>
            <BentoCard icon={Smartphone} title="landingPwaTitle" body="landingPwaBody" />
            <BentoCard
              icon={Network}
              title="landingNotesTitle"
              body="landingNotesBody"
              className="lg:row-span-2"
            >
              <GraphMock />
            </BentoCard>
            <BentoCard
              icon={Workflow}
              title="landingAutomationsTitle"
              body="landingAutomationsBody"
              className="sm:col-span-2"
            >
              <AutomationMock />
            </BentoCard>
            <BentoCard icon={Scale} title="landingOssTitle" body="landingOssBody" />
            <BentoCard
              icon={Send}
              title="landingIntegrationsTitle"
              body="landingIntegrationsBody"
              className="sm:col-span-2 lg:col-span-3"
            >
              <ChatMock />
            </BentoCard>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-5 md:px-6">
          <span>{t("landingFooter")}</span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
            GitHub · MIT
          </a>
        </div>
      </footer>
    </div>
  );
}

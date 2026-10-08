import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Cloud,
  Database,
  HardDriveDownload,
  Inbox,
  Network,
  Play,
  Scale,
  Send,
  Smartphone,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  GithubMark,
  NewTab,
  PAGE,
  SiteFooter,
  SiteHeader,
  SkipLink,
} from "@/components/landing/SiteChrome";
import { BackToTop, TechMarquee } from "@/components/landing/LandingExtras";
import { ThemedScreenshot } from "@/components/landing/Screenshots";
import { DemoNotice } from "@/components/demo/DemoBanner";
import { Button } from "@/components/ui/button";
import { demoUrl, GITHUB_URL, SELF_HOST_DOCS_URL } from "@/lib/landing";
import { usePreferences, type MessageKey } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/*
 * Public landing page. The visuals are static HTML/SVG mockups and real screenshots of the demo
 * (no app components, no data hooks, no Supabase) so this chunk stays small and renders on the
 * server. Motion only runs under `motion-safe:`, so `prefers-reduced-motion` turns it off.
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

function InboxMock() {
  const { t } = usePreferences();
  return (
    <div className="space-y-2 rounded-xl border bg-background p-3 text-xs">
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-muted-foreground">
        <span className="truncate">{t("authMockCapture")}</span>
        <span className="ml-auto h-4 w-px bg-foreground motion-safe:animate-pulse" />
      </div>
      <div className="flex justify-center text-muted-foreground">
        <ArrowRight className="h-3.5 w-3.5 rotate-90" />
      </div>
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-primary" />
          <span className="font-medium text-foreground">{t("authMockTaskTitle")}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-md bg-tone-blue/15 px-1.5 py-0.5 text-tone-blue">
            {t("authMockTaskWhen")}
          </span>
          <span className="rounded-md bg-tone-teal/15 px-1.5 py-0.5 text-tone-teal">
            {t("authMockProject")}
          </span>
          <span className="rounded-md bg-priority-high/15 px-1.5 py-0.5 text-priority-high">
            {t("authMockPriority")}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        {[t("authMockText"), t("authMockVoice"), t("authMockPhoto")].map((label) => (
          <span key={label} className="rounded-md bg-inbox px-2 py-1 text-inbox-foreground">
            {label}
          </span>
        ))}
      </div>
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
  const { t } = usePreferences();
  const steps = [t("authMockRuleTrigger"), t("authMockRuleMove"), t("authMockRuleWebhook")];
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
  const { t } = usePreferences();
  return (
    <div className="space-y-2 rounded-xl border bg-background p-3 text-xs">
      <div className="ml-auto w-fit max-w-[80%] rounded-lg rounded-br-sm bg-primary px-2.5 py-1.5 text-primary-foreground">
        {t("authMockChatIn")}
      </div>
      <div className="w-fit max-w-[85%] rounded-lg rounded-bl-sm bg-muted px-2.5 py-1.5">
        {t("authMockChatOut")}
      </div>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        <span>{t("authMockChatSynced")}</span>
      </div>
    </div>
  );
}

/** Section with an anchor id (header menu target): offset below the sticky header, focusable. */
function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: MessageKey;
  subtitle?: MessageKey;
  children: ReactNode;
}) {
  const { t } = usePreferences();
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className="py-12 focus:outline-none md:py-16"
    >
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t(title)}
        </h2>
        {subtitle && <p className="mt-3 text-pretty text-muted-foreground">{t(subtitle)}</p>}
      </div>
      {children}
    </section>
  );
}

type Item = { title: MessageKey; body: MessageKey; icon: typeof Inbox };

const STEPS: Item[] = [
  { title: "landingStep1Title", body: "landingStep1Body", icon: Inbox },
  { title: "landingStep2Title", body: "landingStep2Body", icon: Sparkles },
  { title: "landingStep3Title", body: "landingStep3Body", icon: CheckSquare },
  { title: "landingStep4Title", body: "landingStep4Body", icon: Network },
];

const INTEGRATIONS: Item[] = [
  { title: "landingIntTelegramTitle", body: "landingIntTelegramBody", icon: Send },
  { title: "landingIntCalendarTitle", body: "landingIntCalendarBody", icon: CalendarDays },
  { title: "landingIntAiTitle", body: "landingIntAiBody", icon: Sparkles },
  { title: "landingIntN8nTitle", body: "landingIntN8nBody", icon: Bot },
  { title: "landingIntBackupTitle", body: "landingIntBackupBody", icon: HardDriveDownload },
  { title: "landingIntWebhookTitle", body: "landingIntWebhookBody", icon: Workflow },
];

const SELF_HOST: Item[] = [
  { title: "landingHost1Title", body: "landingHost1Body", icon: Database },
  { title: "landingHost2Title", body: "landingHost2Body", icon: Cloud },
  { title: "landingHost3Title", body: "landingHost3Body", icon: Bot },
];

const FAQ: { q: MessageKey; a: MessageKey }[] = [
  { q: "landingFaq1Q", a: "landingFaq1A" },
  { q: "landingFaq2Q", a: "landingFaq2A" },
  { q: "landingFaq3Q", a: "landingFaq3A" },
  { q: "landingFaq4Q", a: "landingFaq4A" },
  { q: "landingFaq5Q", a: "landingFaq5A" },
  { q: "landingFaq6Q", a: "landingFaq6A" },
];

/** Window chrome around a screenshot so it reads as "the app" rather than a loose image. */
function ShotFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-xl shadow-foreground/5",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b px-3 py-2" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-tone-rose/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-tone-amber/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-tone-green/60" />
      </div>
      {children}
    </div>
  );
}

/**
 * A cropped demo screenshot inside a bento card: same border/radius as the mocks, faded at the
 * bottom so a crop reads as "more below" rather than cut off. Decorative (the card text describes
 * it), so empty alt; the card's children wrapper is already aria-hidden.
 */
function BentoShot({
  name,
  width,
  height,
  className,
}: {
  name: string;
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-background [mask-image:linear-gradient(to_bottom,black_80%,transparent)]",
        className,
      )}
    >
      <ThemedScreenshot name={`landing/${name}`} width={width} height={height} alt="" />
    </div>
  );
}

function IconTile({ icon: Icon }: { icon: typeof Inbox }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <Icon className="h-5 w-5" aria-hidden />
    </div>
  );
}

export function Landing() {
  const { t } = usePreferences();
  const demo = demoUrl();
  return (
    <div data-public-page className="min-h-screen bg-background text-foreground">
      <SkipLink />
      <SiteHeader onLanding />

      <main id="main" tabIndex={-1} className={cn(PAGE, "pb-8 focus:outline-none")}>
        <DemoNotice className="mt-4" />
        <section className="py-10 text-center md:py-16" aria-labelledby="landing-title">
          <p className="text-xs font-medium tracking-wide text-primary uppercase">
            {t("landingEyebrow")}
          </p>
          <h1
            id="landing-title"
            className="mx-auto mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl md:text-5xl"
          >
            {t("landingTitle")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-pretty text-muted-foreground">
            {t("landingSubtitle")}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {/* Demo landing (VITE_DEMO_URL), same tab; without it the primary CTA is sign-in. */}
            {demo ? (
              <Button asChild size="lg">
                <a href={demo}>
                  <Play aria-hidden />
                  {t("landingDemo")}
                  <ArrowRight aria-hidden />
                </a>
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link to="/login">
                  {t("landingSignIn")}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            )}
            <Button asChild size="lg" variant="secondary">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GithubMark />
                {t("landingGithub")}
                <NewTab />
              </a>
            </Button>
          </div>
          <ShotFrame className="mx-auto mt-10 max-w-5xl text-left md:mt-14">
            <ThemedScreenshot
              name="today-desktop"
              width={1440}
              height={900}
              phone={{ name: "today-mobile", width: 585, height: 1266 }}
              alt={t("landingShotHeroAlt")}
            />
          </ShotFrame>
        </section>

        <Section id="fitur" title="landingFeatures" subtitle="landingFeaturesSubtitle">
          <div className="grid grid-flow-dense grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BentoCard
              icon={Inbox}
              title="landingInboxTitle"
              body="landingInboxBody"
              className="sm:col-span-2 lg:row-span-2"
            >
              <div className="space-y-3">
                <InboxMock />
                <BentoShot name="inbox" width={720} height={470} />
              </div>
            </BentoCard>
            <BentoCard
              icon={CheckSquare}
              title="landingTasksTitle"
              body="landingTasksBody"
              className="sm:col-span-2"
            >
              <BentoShot name="kanban" width={892} height={440} />
            </BentoCard>
            <BentoCard icon={Users} title="landingCollabTitle" body="landingCollabBody">
              <CollabMock />
            </BentoCard>
            <BentoCard icon={Smartphone} title="landingPwaTitle" body="landingPwaBody">
              <BentoShot name="today" width={420} height={387} />
            </BentoCard>
            <BentoCard
              icon={Network}
              title="landingNotesTitle"
              body="landingNotesBody"
              className="lg:row-span-2"
            >
              <div className="space-y-3">
                <GraphMock />
                <BentoShot name="note" width={480} height={665} />
              </div>
            </BentoCard>
            <BentoCard
              icon={Workflow}
              title="landingAutomationsTitle"
              body="landingAutomationsBody"
              className="sm:col-span-2"
            >
              <div className="space-y-3">
                <AutomationMock />
                <BentoShot name="automations" width={720} height={215} />
              </div>
            </BentoCard>
            <BentoCard icon={Scale} title="landingOssTitle" body="landingOssBody" />
            <BentoCard
              icon={Send}
              title="landingIntegrationsTitle"
              body="landingIntegrationsBody"
              className="sm:col-span-2 lg:col-span-3"
            >
              <div className="grid items-center gap-4 sm:grid-cols-[1fr_minmax(0,16rem)]">
                <ChatMock />
                <BentoShot name="telegram" width={420} height={387} />
              </div>
            </BentoCard>
          </div>
        </Section>

        <Section id="cara-kerja" title="landingHowTitle" subtitle="landingHowSubtitle">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-2xl border bg-card p-5">
                <div className="flex items-center gap-3">
                  <IconTile icon={step.icon} />
                  <span className="text-sm font-semibold text-primary">
                    {t("landingStep")} {i + 1}
                  </span>
                </div>
                <h3 className="mt-3 text-base font-semibold tracking-tight">{t(step.title)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(step.body)}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="integrasi" title="landingIntTitle" subtitle="landingIntSubtitle">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {INTEGRATIONS.map((item) => (
              <li key={item.title} className="flex gap-4 rounded-2xl border bg-card p-5">
                <IconTile icon={item.icon} />
                <div>
                  <h3 className="text-base font-semibold tracking-tight">{t(item.title)}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t(item.body)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="teknologi" title="landingTechTitle" subtitle="landingTechSubtitle">
          <TechMarquee />
        </Section>

        <Section id="self-host" title="landingHostTitle" subtitle="landingHostSubtitle">
          <ol className="grid gap-4 md:grid-cols-3">
            {SELF_HOST.map((step, i) => (
              <li key={step.title} className="rounded-2xl border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <IconTile icon={step.icon} />
                </div>
                <h3 className="mt-3 text-base font-semibold tracking-tight">{t(step.title)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(step.body)}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex justify-center">
            <Button asChild variant="secondary">
              <a href={SELF_HOST_DOCS_URL} target="_blank" rel="noreferrer">
                {t("landingHostGuide")}
                <ArrowRight aria-hidden />
                <NewTab />
              </a>
            </Button>
          </div>
        </Section>

        <Section id="faq" title="landingFaqTitle">
          <div className="mx-auto max-w-3xl divide-y rounded-2xl border bg-card">
            {FAQ.map((item) => (
              <details key={item.q} className="group px-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base">{t(item.q)}</h3>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <p className="pb-4 text-sm text-pretty text-muted-foreground">{t(item.a)}</p>
              </details>
            ))}
          </div>
        </Section>
      </main>

      <SiteFooter onLanding />
      <BackToTop />
    </div>
  );
}

import { CalendarDays, CheckCircle2, Circle, Eye, Flag } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { PRIORITY, TASK_STATUS } from "@/lib/constants";
import { intlLocale, usePreferences, type Locale } from "@/lib/preferences";
import type {
  PublicBlock,
  PublicInline,
  PublicNote,
  PublicProject,
  PublicShare,
  PublicTask,
} from "@/lib/share";
import { cn } from "@/lib/utils";
import { optionLabel } from "@/lib/option-labels";

// Read-only page for `/s/$token`. Renders only the sanitized DTO from the server: no ids, no
// links into the app, no external scripts (CSP-safe), light/dark via the root theme script.

function formatDate(value: string, locale: Locale): string {
  // Date-only values (YYYY-MM-DD) are calendar dates; render them in UTC so they never shift.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return date.toLocaleDateString(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(/^\d{4}-\d{2}-\d{2}$/.test(value) ? { timeZone: "UTC" } : {}),
  });
}

function Inline({ parts }: { parts: PublicInline[] }) {
  const { t } = usePreferences();
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case "strong":
            return <strong key={i}>{part.text}</strong>;
          case "code":
            return (
              <code key={i} className="rounded bg-secondary px-1 font-mono text-[0.9em]">
                {part.text}
              </code>
            );
          case "url":
            return (
              <a
                key={i}
                href={part.text}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className="break-all text-primary underline underline-offset-2"
              >
                {part.text}
              </a>
            );
          case "wiki":
            return (
              <span key={i} className="font-medium">
                {part.text}
              </span>
            );
          case "ref":
            return part.text === null ? (
              <span key={i} className="rounded bg-muted px-1 text-xs text-muted-foreground italic">
                {t("publicNotSharedRef")}
              </span>
            ) : (
              <span key={i} className="rounded bg-accent/60 px-1 text-accent-foreground">
                {part.text}
              </span>
            );
          default:
            return <Fragment key={i}>{part.text}</Fragment>;
        }
      })}
    </>
  );
}

/** Groups consecutive list blocks so screen readers get real lists. */
function groupBlocks(blocks: PublicBlock[]) {
  const groups: { type: PublicBlock["type"]; blocks: PublicBlock[] }[] = [];
  for (const block of blocks) {
    const last = groups.at(-1);
    const listy = block.type === "bullet" || block.type === "numbered" || block.type === "todo";
    if (listy && last && last.type === block.type) last.blocks.push(block);
    else groups.push({ type: block.type, blocks: [block] });
  }
  return groups;
}

function NoteBody({ note }: { note: PublicNote }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed break-words">
      {groupBlocks(note.blocks).map((group, gi) => {
        const b = group.blocks[0]!;
        switch (group.type) {
          case "h1":
            return (
              <h2 key={gi} className="pt-3 text-2xl font-semibold tracking-tight">
                <Inline parts={b.inline} />
              </h2>
            );
          case "h2":
            return (
              <h3 key={gi} className="pt-2 text-xl font-semibold tracking-tight">
                <Inline parts={b.inline} />
              </h3>
            );
          case "h3":
            return (
              <h4 key={gi} className="pt-1 text-lg font-semibold">
                <Inline parts={b.inline} />
              </h4>
            );
          case "bullet":
            return (
              <ul key={gi} className="list-disc space-y-1 pl-6 marker:text-muted-foreground">
                {group.blocks.map((x, i) => (
                  <li key={i}>
                    <Inline parts={x.inline} />
                  </li>
                ))}
              </ul>
            );
          case "numbered":
            return (
              <ol key={gi} className="list-decimal space-y-1 pl-6 marker:text-muted-foreground">
                {group.blocks.map((x, i) => (
                  <li key={i}>
                    <Inline parts={x.inline} />
                  </li>
                ))}
              </ol>
            );
          case "todo":
            return (
              <ul key={gi} className="space-y-1">
                {group.blocks.map((x, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {x.checked ? (
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-success" aria-hidden />
                    ) : (
                      <Circle className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="sr-only">{x.checked ? "✓ " : "☐ "}</span>
                    <span className={cn(x.checked && "text-muted-foreground line-through")}>
                      <Inline parts={x.inline} />
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote
                key={gi}
                className="border-l-2 border-primary/40 pl-4 text-muted-foreground"
              >
                <Inline parts={b.inline} />
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={gi}
                className="overflow-x-auto rounded-lg bg-secondary p-3 font-mono text-sm whitespace-pre"
              >
                <code>{b.inline[0]?.text ?? ""}</code>
              </pre>
            );
          case "divider":
            return <hr key={gi} className="my-4 border-border" />;
          default:
            return b.inline.length ? (
              <p key={gi}>
                <Inline parts={b.inline} />
              </p>
            ) : (
              <div key={gi} className="h-3" aria-hidden />
            );
        }
      })}
    </div>
  );
}

const STATUS_ORDER = TASK_STATUS.map((s) => s.id) as string[];

function TaskItem({ task }: { task: PublicTask }) {
  const { t, locale } = usePreferences();
  const priority = PRIORITY.find((p) => p.id === task.priority);
  return (
    <li className="rounded-lg border bg-card px-3 py-2.5 text-sm">
      <p
        className={cn(
          "font-medium",
          task.status === "done" && "text-muted-foreground line-through",
        )}
      >
        {task.title}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {priority && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
              priority.className,
            )}
          >
            <Flag className="h-3 w-3" aria-hidden /> {optionLabel(t, "priority", priority.id)}
          </span>
        )}
        {task.dueDate && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" aria-hidden />
            <span className="sr-only">{t("publicDue")}: </span>
            {formatDate(task.dueDate, locale)}
          </span>
        )}
      </div>
    </li>
  );
}

function ProjectBody({ project }: { project: PublicProject }) {
  const { t, locale } = usePreferences();
  const columns = TASK_STATUS.map((status) => ({
    status,
    tasks: project.tasks.filter((task) => task.status === status.id),
  }));
  const other = project.tasks.filter((task) => !STATUS_ORDER.includes(task.status));
  if (other.length) columns[0]!.tasks.push(...other);
  return (
    <div className="space-y-8">
      {project.description && (
        <p className="text-[15px] leading-relaxed whitespace-pre-line text-pretty">
          {project.description}
        </p>
      )}
      <section aria-labelledby="public-tasks">
        <h2 id="public-tasks" className="mb-3 text-lg font-semibold">
          {t("publicTasks")} <span className="text-muted-foreground">({project.tasks.length})</span>
        </h2>
        {project.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("publicNoTasks")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {columns.map(({ status, tasks }) => (
              <section
                key={status.id}
                aria-labelledby={`col-${status.id}`}
                className="rounded-xl bg-secondary/50 p-3"
              >
                <h3
                  id={`col-${status.id}`}
                  className="mb-2 flex items-center justify-between text-sm font-semibold"
                >
                  {optionLabel(t, "status", status.id, status.label)}
                  <span className="text-xs font-normal text-muted-foreground">{tasks.length}</span>
                </h3>
                <ul className="space-y-2">
                  {tasks.map((task, i) => (
                    <TaskItem key={i} task={task} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
      {project.milestones.length > 0 && (
        <section aria-labelledby="public-milestones">
          <h2 id="public-milestones" className="mb-3 text-lg font-semibold">
            {t("publicMilestones")}
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {project.milestones.map((m, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
                {m.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className={cn("flex-1", m.done && "text-muted-foreground line-through")}>
                  <span className="sr-only">{m.done ? "✓ " : ""}</span>
                  {m.title}
                </span>
                {m.dueDate && (
                  <span className="text-xs text-muted-foreground">
                    {formatDate(m.dueDate, locale)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PublicChrome({ children }: { children: ReactNode }) {
  const { t } = usePreferences();
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main
        id="main"
        className="mx-auto w-full max-w-5xl flex-1 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10 sm:px-6 md:pt-12"
      >
        {children}
      </main>
      <footer className="border-t pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-center px-4 pt-5 text-sm sm:px-6">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <img src="/favicon.svg" alt="" width={18} height={18} aria-hidden />
            {t("publicMadeWith")}
          </a>
        </div>
      </footer>
    </div>
  );
}

export function PublicSharePage({ share }: { share: PublicShare }) {
  const { t, locale } = usePreferences();
  const status = share.kind === "project" ? optionLabel(t, "projectStatus", share.status) : null;
  return (
    <PublicChrome>
      <article
        aria-labelledby="public-title"
        className={share.kind === "note" ? "mx-auto max-w-3xl" : undefined}
      >
        <header className="mb-6 border-b pb-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5">
              <Eye className="h-3 w-3" aria-hidden /> {t("publicReadOnly")}
            </span>
            {status && <span className="rounded-full bg-secondary px-2 py-0.5">{status}</span>}
            {share.kind === "project" && (share.startDate || share.dueDate) && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" aria-hidden />
                {share.startDate ? formatDate(share.startDate, locale) : "…"} –{" "}
                {share.dueDate ? formatDate(share.dueDate, locale) : "…"}
              </span>
            )}
          </div>
          <h1
            id="public-title"
            className="text-3xl font-semibold tracking-tight text-balance break-words sm:text-4xl"
          >
            {share.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("publicUpdated")}{" "}
            <time dateTime={share.updatedAt}>{formatDate(share.updatedAt, locale)}</time>
          </p>
        </header>
        {share.kind === "note" ? <NoteBody note={share} /> : <ProjectBody project={share} />}
      </article>
    </PublicChrome>
  );
}

export function PublicShareUnavailable({ rateLimited = false }: { rateLimited?: boolean }) {
  const { t } = usePreferences();
  return (
    <PublicChrome>
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("publicNotFoundTitle")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {rateLimited ? t("publicRateLimited") : t("publicNotFoundBody")}
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t("publicHome")}
        </a>
      </div>
    </PublicChrome>
  );
}

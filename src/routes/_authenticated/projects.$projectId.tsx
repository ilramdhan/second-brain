import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, format, isBefore, startOfDay } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Diamond,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Trash2,
  UserMinus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { NotesBoard } from "@/components/notes/NotesBoard";
import { ProjectDialog } from "@/components/projects/ProjectDialog";
import { CheckCircle } from "@/components/tasks/CheckCircle";
import { TaskViews } from "@/components/tasks/TaskViews";
import { Timeline } from "@/components/Timeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { color, labelOf, PARA, PROJECT_STATUS } from "@/lib/constants";
import {
  useInviteActions,
  useMe,
  useMilestoneActions,
  useMilestones,
  usePeople,
  useProjectInvites,
  useProjects,
  useTasks,
  type Project,
} from "@/lib/data";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/common/PageContainer";
import { meQuery, milestonesQuery, preloadQueries, projectsQuery, tasksQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { toastError } from "@/lib/errors";
import { DemoDisabled } from "@/components/demo/DemoDisabled";
import { DEMO_DISABLED_MESSAGE, isDemo } from "@/lib/app-mode";
import { normalizeEmail } from "@/lib/password";
import { usePreferences } from "@/lib/preferences";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Detail proyek — Second Brain" },
      {
        name: "description",
        content: "Ringkasan, tugas, milestone, timeline, catatan, dan tim dalam satu proyek.",
      },
      { property: "og:title", content: "Detail proyek — Second Brain" },
      { property: "og:description", content: "Semua hal tentang satu proyek di satu tempat." },
    ],
  }),
  loader: ({ context }) =>
    preloadQueries(context.queryClient, projectsQuery, tasksQuery, milestonesQuery, meQuery),
  component: ProjectDetail,
  errorComponent: RouteError,
});

const fmt = (d: string) => format(new Date(`${d}T00:00:00`), "d MMM yyyy", { locale: localeId });

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useProjects();
  const { data: tasks = [] } = useTasks();
  const { data: milestones = [] } = useMilestones();
  const [editing, setEditing] = useState(false);
  const { data: me } = useMe();
  const project = projects.find((p) => p.id === projectId);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Memuat…</div>;
  if (!project)
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Proyek tidak ditemukan atau Anda tidak punya akses.
        </p>
        <Link to="/projects" className="mt-4 inline-block text-sm text-primary">
          Kembali ke proyek
        </Link>
      </div>
    );

  const pTasks = tasks.filter((t) => t.project_id === project.id);
  const pMilestones = milestones.filter((m) => m.project_id === project.id);
  const parent = projects.find((p) => p.id === project.parent_id);

  return (
    <PageContainer>
      <Link
        to="/projects"
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {parent ? parent.name : "Semua proyek"}
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={cn("h-3 w-3 rounded-full", color(project.color).dot)} />
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-secondary px-2 py-0.5">
              {labelOf(PARA, project.para_type)}
            </span>
            <span className={cn("rounded-full px-2 py-0.5", color(project.color).soft)}>
              {labelOf(PROJECT_STATUS, project.status)}
            </span>
            {(project.start_date || project.due_date) && (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {project.start_date ? fmt(project.start_date) : "…"} –{" "}
                {project.due_date ? fmt(project.due_date) : "…"}
              </span>
            )}
            {project.launch_date && (
              <span className="flex items-center gap-1">
                <Rocket className="h-3 w-3" />
                Launch {fmt(project.launch_date)}
              </span>
            )}
          </div>
        </div>
        {/* Only the project owner may edit project settings (enforced by RLS, migration 0010). */}
        {project.user_id === me?.id && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Ubah
          </Button>
        )}
      </header>

      <Tabs defaultValue="overview">
        <div className="scrollbar-subtle -mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList>
            <TabsTrigger value="overview">Ringkasan</TabsTrigger>
            <TabsTrigger value="tasks">Tugas</TabsTrigger>
            <TabsTrigger value="milestones">Milestone</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="notes">Catatan</TabsTrigger>
            <TabsTrigger value="team">Tim</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          <Overview project={project} projects={projects} />
        </TabsContent>
        <TabsContent value="tasks">
          <TaskViews projectId={project.id} />
        </TabsContent>
        <TabsContent value="milestones">
          <Milestones project={project} />
        </TabsContent>
        <TabsContent value="timeline">
          <Timeline
            tasks={pTasks.filter((t) => !t.parent_id)}
            projects={[project]}
            milestones={pMilestones}
            groupByProject={false}
          />
        </TabsContent>
        <TabsContent value="notes">
          <NotesBoard projectId={project.id} />
        </TabsContent>
        <TabsContent value="team">
          <Team project={project} />
        </TabsContent>
      </Tabs>

      <ProjectDialog
        open={editing}
        onOpenChange={setEditing}
        project={project}
        onDeleted={() => navigate({ to: "/projects" })}
      />
    </PageContainer>
  );
}

function Overview({ project, projects }: { project: Project; projects: Project[] }) {
  const { data: tasks = [] } = useTasks();
  const { data: milestones = [] } = useMilestones();
  const ts = tasks.filter((t) => t.project_id === project.id && !t.parent_id);
  const done = ts.filter((t) => t.status === "done").length;
  const today = startOfDay(new Date());
  const overdue = ts.filter(
    (t) => t.status !== "done" && t.due_date && isBefore(new Date(t.due_date), today),
  ).length;
  const inProgress = ts.filter((t) => t.status === "in_progress" || t.status === "review").length;
  const pct = ts.length ? Math.round((done / ts.length) * 100) : 0;
  const nextMs = milestones
    .filter((m) => m.project_id === project.id && !m.done)
    .sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"))[0];
  const kids = projects.filter((p) => p.parent_id === project.id);
  const launchIn = project.launch_date
    ? differenceInCalendarDays(new Date(`${project.launch_date}T00:00:00`), today)
    : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold">Deskripsi</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {project.description ||
              "Belum ada deskripsi. Klik Ubah untuk menambahkan tujuan proyek."}
          </p>
        </section>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total tugas" value={ts.length} />
          <Stat label="Dikerjakan" value={inProgress} />
          <Stat label="Selesai" value={done} />
          <Stat
            label="Terlambat"
            value={overdue}
            tone={overdue ? "text-priority-high" : undefined}
          />
        </section>
        <section className="rounded-2xl border bg-card p-5">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-semibold">Progres</span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full rounded-full", color(project.color).bar)}
              style={{ width: `${pct}%` }}
            />
          </div>
        </section>
      </div>
      <div className="space-y-4">
        {launchIn !== null && (
          <section className="rounded-2xl border bg-card p-5">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Rocket className="h-3.5 w-3.5" /> Launch date
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {launchIn > 0
                ? `${launchIn} hari lagi`
                : launchIn === 0
                  ? "Hari ini!"
                  : "Sudah launch"}
            </p>
            <p className="text-xs text-muted-foreground">{fmt(project.launch_date!)}</p>
          </section>
        )}
        <section className="rounded-2xl border bg-card p-5">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Diamond className="h-3.5 w-3.5" /> Milestone berikutnya
          </p>
          {nextMs ? (
            <>
              <p className="mt-1 text-sm font-semibold">{nextMs.title}</p>
              {nextMs.due_date && (
                <p className="text-xs text-muted-foreground">{fmt(nextMs.due_date)}</p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Belum ada.</p>
          )}
        </section>
        {kids.length > 0 && (
          <section className="rounded-2xl border bg-card p-5">
            <p className="mb-2 text-xs text-muted-foreground">Sub-proyek</p>
            <ul className="space-y-1">
              {kids.map((k) => (
                <li key={k.id}>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: k.id }}
                    className="flex items-center gap-2 text-sm hover:text-primary"
                  >
                    <span className={cn("h-2 w-2 rounded-full", color(k.color).dot)} />
                    {k.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string | undefined }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", tone)}>{value}</p>
    </div>
  );
}

function Milestones({ project }: { project: Project }) {
  const { data: milestones = [] } = useMilestones();
  const { data: tasks = [] } = useTasks();
  const actions = useMilestoneActions();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const list = milestones.filter((m) => m.project_id === project.id);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await actions.create({
      project_id: project.id,
      title: title.trim().slice(0, 200),
      due_date: due || null,
    });
    setTitle("");
    setDue("");
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={add}
        className="flex flex-col gap-2 rounded-2xl border bg-card p-3 sm:flex-row"
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nama milestone, mis. Beta release"
        />
        <Input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="sm:w-44"
        />
        <Button type="submit">
          <Plus /> Tambah
        </Button>
      </form>
      <ol className="relative space-y-3 border-l pl-6">
        {list.map((m) => {
          const ts = tasks.filter((t) => t.milestone_id === m.id);
          const d = ts.filter((t) => t.status === "done").length;
          return (
            <li key={m.id} className="group relative rounded-2xl border bg-card p-4">
              <Diamond
                className={cn(
                  "absolute -left-[33px] top-5 h-4 w-4",
                  m.done ? "fill-success text-success" : "fill-warning text-warning",
                )}
              />
              <div className="flex items-start gap-3">
                <CheckCircle
                  done={m.done}
                  onClick={() => actions.update(m.id, { done: !m.done })}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      m.done && "text-muted-foreground line-through",
                    )}
                  >
                    {m.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.due_date ? fmt(m.due_date) : "Tanpa tanggal"} · {d}/{ts.length} tugas
                  </p>
                </div>
                <Input
                  type="date"
                  value={m.due_date ?? ""}
                  onChange={(e) => actions.update(m.id, { due_date: e.target.value || null })}
                  className="hidden h-8 w-40 sm:block"
                />
                <button
                  onClick={() => confirm("Hapus milestone?") && actions.remove(m.id)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Hapus milestone"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Belum ada milestone. Pecah proyek menjadi tahapan, lalu hubungkan tugas ke milestone.
          </p>
        )}
      </ol>
    </div>
  );
}

function Team({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { t } = usePreferences();
  const { data: me } = useMe();
  const { data: people = [] } = usePeople(project.id);
  const { data: invites = [] } = useProjectInvites(project.id);
  const { invite, revoke } = useInviteActions(project.id);
  const [email, setEmail] = useState("");
  const isOwner = project.user_id === me?.id;

  async function send(address: string, resend = false) {
    // The server refuses in the demo as well (assertNotDemo + the 0019 row limit of 0).
    if (isDemo()) {
      toast.error(DEMO_DISABLED_MESSAGE);
      return;
    }
    const value = normalizeEmail(address);
    if (!value) {
      toast.error(t("authEmailInvalid"));
      return;
    }
    try {
      const result = await invite.mutateAsync(value);
      if (result.status === "member") toast.info(t("teamInviteAlreadyMember"));
      else if (result.emailError === "rate_limited") toast.warning(t("teamInviteEmailLimited"));
      else if (result.emailError) toast.warning(t("teamInviteEmailFailed"));
      else toast.success(resend ? t("teamResent") : t("teamInviteSent"));
      if (!resend) setEmail("");
    } catch (err) {
      toastError(err);
    }
  }

  async function revokeInvite(id: string) {
    if (!confirm(t("teamRevokeConfirm"))) return;
    try {
      await revoke.mutateAsync(id);
      toast.success(t("teamRevoked"));
    } catch (err) {
      toastError(err);
    }
  }

  async function removeMember(userId: string) {
    if (!confirm("Keluarkan anggota ini dari proyek?")) return;
    const { error } = await supabase
      .from("project_members")
      .delete()
      .eq("project_id", project.id)
      .eq("user_id", userId);
    if (error) {
      toastError(error);
      return;
    }
    qc.invalidateQueries({ queryKey: ["people", project.id] });
  }

  return (
    <div className="max-w-2xl space-y-4">
      {isOwner ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(email);
          }}
          className="flex flex-col gap-2 rounded-2xl border bg-card p-3 sm:flex-row"
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("teamInvitePlaceholder")}
            aria-label={t("teamInviteLabel")}
            autoComplete="off"
            maxLength={320}
          />
          <DemoDisabled>
            <Button type="submit" disabled={invite.isPending}>
              <Mail /> {t("teamInvite")}
            </Button>
          </DemoDisabled>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t("teamMemberNote")}</p>
      )}
      <ul className="divide-y rounded-2xl border bg-card">
        {people.map((p) => (
          <li key={p.user_id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold uppercase text-accent-foreground">
              {(p.display_name || p.email).slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {p.display_name || p.email}
                {p.user_id === me?.id && " (Anda)"}
              </p>
              <p className="truncate text-xs text-muted-foreground">{p.email}</p>
            </div>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
              {p.role === "owner" ? "Pemilik" : "Anggota"}
            </span>
            {isOwner && p.role !== "owner" && (
              <button
                onClick={() => removeMember(p.user_id)}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                aria-label="Keluarkan"
              >
                <UserMinus className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {invites.length > 0 && (
        <section aria-labelledby="pending-invites" className="space-y-2">
          <h3 id="pending-invites" className="text-sm font-semibold">
            {t("teamPendingHeading")}
          </h3>
          <ul className="divide-y rounded-2xl border border-dashed bg-card">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Clock className="h-4 w-4" aria-hidden />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm">{inv.email}</p>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {t("teamPending")}
                </span>
                {isOwner && (
                  <span className="flex items-center gap-1">
                    <DemoDisabled>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={invite.isPending}
                        onClick={() => void send(inv.email, true)}
                      >
                        <RefreshCw /> {t("teamResend")}
                      </Button>
                    </DemoDisabled>
                    <button
                      type="button"
                      onClick={() => void revokeInvite(inv.id)}
                      disabled={revoke.isPending}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      aria-label={`${t("teamRevoke")}: ${inv.email}`}
                      title={t("teamRevoke")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {isOwner && <p className="text-xs text-muted-foreground">{t("teamInviteHint")}</p>}
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        Anggota bisa melihat dan mengubah tugas, milestone, dan catatan di proyek ini, serta bisa
        ditugaskan ke tugas.
      </p>
    </div>
  );
}

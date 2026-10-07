import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ChevronRight,
  KanbanSquare,
  LayoutGrid,
  ListTree,
  Pencil,
  Plus,
  Rocket,
} from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { Kanban } from "@/components/Kanban";
import { ProjectDialog } from "@/components/projects/ProjectDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { color, labelOf, PARA, PROJECT_STATUS } from "@/lib/constants";
import { useProjectActions, useProjects, useTasks, type Project, type Task } from "@/lib/data";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/common/PageContainer";
import { preloadQueries, projectsQuery, tasksQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "Proyek — Second Brain" },
      {
        name: "description",
        content: "Kelola proyek dengan metode PARA dalam tampilan grid, kanban, dan pohon.",
      },
      { property: "og:title", content: "Proyek — Second Brain" },
      {
        property: "og:description",
        content: "Projects, Areas, Resources, Archives — lengkap dengan progres dan launch date.",
      },
    ],
  }),
  loader: ({ context }) => preloadQueries(context.queryClient, projectsQuery, tasksQuery),
  component: ProjectsPage,
  errorComponent: RouteError,
});

function progress(p: Project, tasks: Task[]) {
  const ts = tasks.filter((t) => t.project_id === p.id && !t.parent_id);
  const done = ts.filter((t) => t.status === "done").length;
  return { total: ts.length, done, pct: ts.length ? Math.round((done / ts.length) * 100) : 0 };
}

function ProjectsPage() {
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks();
  const { update } = useProjectActions();
  const navigate = useNavigate();
  const [view, setView] = useState("grid");
  const [para, setPara] = useState("all");
  const [dialog, setDialog] = useState<{
    open: boolean;
    project: Project | null;
    defaults?: Partial<Project> | undefined;
  }>({ open: false, project: null });

  const list = projects.filter((p) => para === "all" || p.para_type === para);

  return (
    <PageContainer>
      <PageHeader
        title="Proyek"
        subtitle="Dikelompokkan dengan metode PARA. Klik proyek untuk melihat detail."
        actions={
          <Button
            size="sm"
            onClick={() =>
              setDialog({
                open: true,
                project: null,
                defaults: { para_type: para === "all" ? "project" : para },
              })
            }
          >
            <Plus /> Proyek
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="scrollbar-subtle -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {[{ id: "all", label: "Semua" }, ...PARA].map((p) => (
            <button
              key={p.id}
              onClick={() => setPara(p.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                para === p.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              {p.label}{" "}
              <span className="opacity-70">
                {p.id === "all"
                  ? projects.length
                  : projects.filter((x) => x.para_type === p.id).length}
              </span>
            </button>
          ))}
        </div>
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="grid" className="gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" />
              Grid
            </TabsTrigger>
            <TabsTrigger value="board" className="gap-1.5">
              <KanbanSquare className="h-3.5 w-3.5" />
              Kanban
            </TabsTrigger>
            <TabsTrigger value="tree" className="gap-1.5">
              <ListTree className="h-3.5 w-3.5" />
              Pohon
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "grid" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              tasks={tasks}
              onEdit={() => setDialog({ open: true, project: p })}
            />
          ))}
          {list.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
              Belum ada proyek di kategori ini.
            </p>
          )}
        </div>
      )}

      {view === "board" && (
        <Kanban
          columns={PROJECT_STATUS}
          items={list}
          getColumn={(p) => p.status}
          onMove={(p, status) => update(p.id, { status })}
          onAdd={(status) => setDialog({ open: true, project: null, defaults: { status } })}
          onOpen={(p) => navigate({ to: "/projects/$projectId", params: { projectId: p.id } })}
          itemLabel={(p) => p.name}
          renderCard={(p) => (
            <ProjectCard
              project={p}
              tasks={tasks}
              onEdit={() => setDialog({ open: true, project: p })}
              compact
            />
          )}
        />
      )}

      {view === "tree" && (
        <div className="rounded-2xl border bg-card p-2">
          <Tree
            projects={list}
            all={list}
            parentId={null}
            tasks={tasks}
            depth={0}
            onAddChild={(p) =>
              setDialog({
                open: true,
                project: null,
                defaults: { parent_id: p.id, para_type: p.para_type },
              })
            }
          />
          {list.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">Belum ada proyek.</p>
          )}
        </div>
      )}

      <ProjectDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        project={dialog.project}
        defaults={dialog.defaults}
      />
    </PageContainer>
  );
}

function ProjectCard({
  project: p,
  tasks,
  onEdit,
  compact,
}: {
  project: Project;
  tasks: Task[];
  onEdit: () => void;
  compact?: boolean | undefined;
}) {
  const pr = progress(p, tasks);
  return (
    <div className="group relative rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
      <Link
        to="/projects/$projectId"
        params={{ projectId: p.id }}
        className="absolute inset-0 rounded-2xl"
        aria-label={`Buka ${p.name}`}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color(p.color).dot)} />
          <h3 className="truncate text-sm font-semibold">{p.name}</h3>
        </div>
        <button
          onClick={onEdit}
          onPointerDown={(e) => e.stopPropagation()}
          className="relative z-10 -m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-100 hover:bg-accent md:m-0 md:h-7 md:w-7 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          aria-label="Ubah proyek"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      {p.description && !compact && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
      )}
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full bg-secondary px-2 py-0.5">{labelOf(PARA, p.para_type)}</span>
        {!compact && (
          <span className="rounded-full bg-secondary px-2 py-0.5">
            {labelOf(PROJECT_STATUS, p.status)}
          </span>
        )}
        {p.launch_date && (
          <span className="flex items-center gap-1">
            <Rocket className="h-3 w-3" />
            {format(new Date(`${p.launch_date}T00:00:00`), "d MMM yy", { locale: localeId })}
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
          <span>
            {pr.done}/{pr.total} tugas
          </span>
          <span>{pr.pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn("h-full rounded-full", color(p.color).bar)}
            style={{ width: `${pr.pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Tree({
  projects,
  all,
  parentId,
  tasks,
  depth,
  onAddChild,
}: {
  projects: Project[];
  all: Project[];
  parentId: string | null;
  tasks: Task[];
  depth: number;
  onAddChild: (p: Project) => void;
}) {
  // Roots: no parent, or parent not in current filtered list
  const items = projects.filter((p) =>
    parentId === null
      ? !p.parent_id || !all.some((x) => x.id === p.parent_id)
      : p.parent_id === parentId,
  );
  return (
    <ul>
      {items.map((p) => (
        <TreeNode key={p.id} p={p} all={all} tasks={tasks} depth={depth} onAddChild={onAddChild} />
      ))}
    </ul>
  );
}

function TreeNode({
  p,
  all,
  tasks,
  depth,
  onAddChild,
}: {
  p: Project;
  all: Project[];
  tasks: Task[];
  depth: number;
  onAddChild: (p: Project) => void;
}) {
  const [open, setOpen] = useState(true);
  const kids = all.filter((x) => x.parent_id === p.id);
  const pr = progress(p, tasks);
  return (
    <li>
      <div
        className="group flex items-center gap-1 rounded-lg py-1.5 pr-2 hover:bg-accent/60"
        style={{ paddingLeft: depth * 20 + 4 }}
      >
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            "tap-target rounded p-0.5 text-muted-foreground",
            !kids.length && "invisible",
          )}
          aria-label="Buka/tutup"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
        </button>
        <span className={cn("h-2 w-2 shrink-0 rounded-full", color(p.color).dot)} />
        <Link
          to="/projects/$projectId"
          params={{ projectId: p.id }}
          className="flex-1 truncate text-sm hover:text-primary"
        >
          {p.name}
        </Link>
        <span className="text-xs text-muted-foreground">
          {pr.done}/{pr.total}
        </span>
        <button
          onClick={() => onAddChild(p)}
          className="rounded p-1 text-muted-foreground opacity-0 hover:bg-background group-hover:opacity-100"
          aria-label="Tambah sub-proyek"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && kids.length > 0 && (
        <Tree
          projects={all}
          all={all}
          parentId={p.id}
          tasks={tasks}
          depth={depth + 1}
          onAddChild={onAddChild}
        />
      )}
    </li>
  );
}

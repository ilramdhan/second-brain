import { useMemo, useState } from "react";
import { addDays, format, isBefore, isToday, isTomorrow, startOfDay } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { CalendarClock, KanbanSquare, List, Plus } from "lucide-react";

import { Kanban } from "@/components/Kanban";
import { LoadMore, usePaged } from "@/components/common/LoadMore";
import { TaskCard, TaskRow } from "@/components/tasks/TaskItem";
import { applyTaskFilter, EMPTY_FILTER, TaskFilters, type TaskFilter } from "@/components/tasks/TaskFilters";
import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TASK_STATUS } from "@/lib/constants";
import { useMe, useProjects, useTaskActions, useTasks, type Project, type Task } from "@/lib/data";

export function TaskViews({ projectId }: { projectId?: string | undefined }) {
  const { data: allTasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: me } = useMe();
  const { newTask } = useTaskDialog();
  const { setStatus } = useTaskActions();
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);
  const [showDone, setShowDone] = useState(false);

  const scoped = useMemo(() => allTasks.filter((t) => !t.parent_id && (!projectId || t.project_id === projectId)), [allTasks, projectId]);
  const tags = useMemo(() => [...new Set(scoped.flatMap((t) => t.tags))].sort(), [scoped]);
  const filtered = applyTaskFilter(scoped, filter, me?.id);
  const listItems = filtered
    .filter((t) => showDone || t.status !== "done")
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));

  const paged = usePaged(listItems, 25, `${JSON.stringify(filter)}-${showDone}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="list" className="gap-1.5"><List className="h-3.5 w-3.5" />List</TabsTrigger>
            <TabsTrigger value="board" className="gap-1.5"><KanbanSquare className="h-3.5 w-3.5" />Kanban</TabsTrigger>
            <TabsTrigger value="upcoming" className="gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Upcoming</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => newTask({ project_id: projectId ?? null })}>
          <Plus /> Tugas
        </Button>
      </div>

      <TaskFilters value={filter} onChange={setFilter} projects={projects} tags={tags} hideProject={!!projectId} />

      {view === "list" && (
        <>
          <ul className="space-y-2">
            {paged.visible.map((t) => <TaskRow key={t.id} task={t} projects={projects} allTasks={allTasks} />)}
          </ul>
          <LoadMore shown={paged.visible.length} total={paged.total} onMore={paged.more} />
          {listItems.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Tidak ada tugas yang cocok.</p>}
          <button onClick={() => setShowDone(!showDone)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            {showDone ? "Sembunyikan yang selesai" : `Tampilkan yang selesai (${filtered.filter((t) => t.status === "done").length})`}
          </button>
        </>
      )}

      {view === "board" && (
        <Kanban
          columns={TASK_STATUS}
          items={filtered}
          getColumn={(t) => t.status}
          onMove={(t, col) => setStatus(t, col)}
          onAdd={(col) => newTask({ status: col, project_id: projectId ?? null })}
          renderCard={(t) => <TaskCard task={t} projects={projects} allTasks={allTasks} />}
        />
      )}

      {view === "upcoming" && <Upcoming tasks={filtered.filter((t) => t.status !== "done")} projects={projects} allTasks={allTasks} />}
    </div>
  );
}

function Upcoming({ tasks, projects, allTasks }: { tasks: Task[]; projects: Project[]; allTasks: Task[] }) {
  const { newTask } = useTaskDialog();
  const today = startOfDay(new Date());
  const overdue = tasks.filter((t) => t.due_date && isBefore(new Date(t.due_date), today));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const later = tasks.filter((t) => t.due_date && new Date(t.due_date) >= addDays(today, 14));
  const noDate = tasks.filter((t) => !t.due_date);

  const Group = ({ title, items, date }: { title: string; items: Task[]; date?: Date | undefined }) =>
    items.length === 0 && !date ? null : (
      <section className="space-y-2">
        <div className="flex items-center justify-between border-b pb-1.5">
          <h3 className="text-sm font-semibold capitalize">{title} <span className="font-normal text-muted-foreground">{items.length || ""}</span></h3>
          {date && (
            <button onClick={() => newTask({ due_date: date.toISOString() })} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Tambah tugas">
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <ul className="space-y-2">{items.map((t) => <TaskRow key={t.id} task={t} projects={projects} allTasks={allTasks} />)}</ul>
      </section>
    );

  return (
    <div className="space-y-6">
      <Group title="Terlambat" items={overdue} />
      {days.map((d) => {
        const items = tasks.filter((t) => t.due_date && startOfDay(new Date(t.due_date)).getTime() === d.getTime());
        const label = isToday(d) ? "Hari ini" : isTomorrow(d) ? "Besok" : format(d, "EEEE, d MMM", { locale: localeId });
        return items.length || isToday(d) ? <Group key={d.toISOString()} title={label} items={items} date={d} /> : null;
      })}
      <Group title="Nanti" items={later} />
      <Group title="Tanpa tanggal" items={noDate} />
    </div>
  );
}

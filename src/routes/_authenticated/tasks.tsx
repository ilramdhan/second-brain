import { createFileRoute } from "@tanstack/react-router";

import { TaskViews } from "@/components/tasks/TaskViews";
import { PageHeader } from "@/components/common/PageHeader";
import { useTasks } from "@/lib/data";
import { PageContainer } from "@/components/common/PageContainer";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tugas — Second Brain" },
      {
        name: "description",
        content: "Kelola tugas, issue, dan deadline dalam tampilan list, kanban, dan upcoming.",
      },
      { property: "og:title", content: "Tugas — Second Brain" },
      { property: "og:description", content: "List, kanban, dan upcoming untuk semua tugas Anda." },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  const { data: tasks = [] } = useTasks();
  const open = tasks.filter((t) => t.status !== "done" && !t.parent_id).length;
  return (
    <PageContainer>
      <PageHeader title="Tugas" subtitle={`${open} belum selesai`} />
      <TaskViews />
    </PageContainer>
  );
}

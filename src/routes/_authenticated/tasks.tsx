import { createFileRoute } from "@tanstack/react-router";

import { TaskViews } from "@/components/tasks/TaskViews";
import { PageHeader } from "@/components/common/PageHeader";
import { useTasks } from "@/lib/data";
import { PageContainer } from "@/components/common/PageContainer";
import { depsQuery, meQuery, preloadQueries, projectsQuery, tasksQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { usePreferences } from "@/lib/preferences";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: (ctx) =>
    pageHead(ctx, { title: "metaTasksTitle", desc: "metaTasksDesc", ogDesc: "metaTasksOgDesc" }),
  loader: ({ context }) =>
    preloadQueries(context.queryClient, tasksQuery, projectsQuery, depsQuery, meQuery),
  component: TasksPage,
  errorComponent: RouteError,
});

function TasksPage() {
  const { data: tasks = [] } = useTasks();
  const { t } = usePreferences();
  const open = tasks.filter((t) => t.status !== "done" && !t.parent_id).length;
  return (
    <PageContainer>
      <PageHeader title={t("taskPageTitle")} subtitle={t("taskPageOpenCount", { count: open })} />
      <TaskViews />
    </PageContainer>
  );
}

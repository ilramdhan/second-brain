import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { Timeline } from "@/components/Timeline";
import { useMilestones, useProjects, useTasks } from "@/lib/data";
import { PageContainer } from "@/components/common/PageContainer";
import { milestonesQuery, preloadQueries, projectsQuery, tasksQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { usePreferences } from "@/lib/preferences";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/_authenticated/timeline")({
  head: (ctx) =>
    pageHead(ctx, {
      title: "metaTimelineTitle",
      desc: "metaTimelineDesc",
      ogDesc: "metaTimelineOgDesc",
    }),
  loader: ({ context }) =>
    preloadQueries(context.queryClient, tasksQuery, projectsQuery, milestonesQuery),
  component: TimelinePage,
  errorComponent: RouteError,
});

function TimelinePage() {
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: milestones = [] } = useMilestones();
  const { t } = usePreferences();
  return (
    <PageContainer>
      <PageHeader title={t("taskTlTitle")} subtitle={t("taskTlSubtitle")} />
      <Timeline
        tasks={tasks.filter((t) => !t.parent_id)}
        projects={projects}
        milestones={milestones}
      />
    </PageContainer>
  );
}

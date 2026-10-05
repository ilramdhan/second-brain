import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { Timeline } from "@/components/Timeline";
import { useMilestones, useProjects, useTasks } from "@/lib/data";
import { PageContainer } from "@/components/common/PageContainer";
import { milestonesQuery, preloadQueries, projectsQuery, tasksQuery } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/timeline")({
  head: () => ({
    meta: [
      { title: "Timeline — Second Brain" },
      {
        name: "description",
        content: "Timeline ala Gantt untuk semua proyek, tugas, milestone, dan launch date.",
      },
      { property: "og:title", content: "Timeline — Second Brain" },
      { property: "og:description", content: "Geser dan perpanjang tugas langsung di timeline." },
    ],
  }),
  loader: ({ context }) =>
    preloadQueries(context.queryClient, tasksQuery, projectsQuery, milestonesQuery),
  component: TimelinePage,
});

function TimelinePage() {
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: milestones = [] } = useMilestones();
  return (
    <PageContainer>
      <PageHeader
        title="Timeline"
        subtitle="Geser batang untuk memindah jadwal, tarik ujungnya untuk memperpanjang."
      />
      <Timeline
        tasks={tasks.filter((t) => !t.parent_id)}
        projects={projects}
        milestones={milestones}
      />
    </PageContainer>
  );
}

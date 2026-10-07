import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { NotesBoard } from "@/components/notes/NotesBoard";
import { PageContainer } from "@/components/common/PageContainer";
import { notesQuery, preloadQueries, projectsQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { usePreferences } from "@/lib/preferences";

export const Route = createFileRoute("/_authenticated/notes/")({
  head: () => ({
    meta: [
      { title: "Catatan — Second Brain" },
      {
        name: "description",
        content: "Catatan, ide, dan notulen meeting dalam tampilan grid atau kanban.",
      },
      { property: "og:title", content: "Catatan — Second Brain" },
      { property: "og:description", content: "Simpan ide dan notulen, rapikan dengan AI." },
    ],
  }),
  loader: ({ context }) => preloadQueries(context.queryClient, notesQuery, projectsQuery),
  component: NotesPage,
  errorComponent: RouteError,
});

function NotesPage() {
  const { t } = usePreferences();
  return (
    <PageContainer>
      <PageHeader title={t("notes")} subtitle={t("noteListSubtitle")} />
      <NotesBoard />
    </PageContainer>
  );
}

import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { NotesBoard } from "@/components/notes/NotesBoard";
import { PageContainer } from "@/components/common/PageContainer";
import { notesQuery, preloadQueries, projectsQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { usePreferences } from "@/lib/preferences";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/_authenticated/notes/")({
  head: (ctx) =>
    pageHead(ctx, { title: "metaNotesTitle", desc: "metaNotesDesc", ogDesc: "metaNotesOgDesc" }),
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

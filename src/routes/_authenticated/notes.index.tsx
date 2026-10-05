import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { NotesBoard } from "@/components/notes/NotesBoard";
import { PageContainer } from "@/components/common/PageContainer";

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
  component: NotesPage,
});

function NotesPage() {
  return (
    <PageContainer>
      <PageHeader title="Catatan" subtitle="Ide, referensi, dan notulen meeting." />
      <NotesBoard />
    </PageContainer>
  );
}

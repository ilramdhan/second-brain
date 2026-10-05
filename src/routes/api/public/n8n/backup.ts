import { createFileRoute } from "@tanstack/react-router";

// Backup export for n8n (workflow 05): ?userId=<uuid>|all&include=all|active&versions=0|1
// &page=0&page_size=10. `all` is paged by users (page_size users per request) so large
// installations stay within serverless limits; n8n loops until `next_page` is null. Each entry
// under `users[]` has the Settings backup format ({version, exported_at, tables}).
export const Route = createFileRoute("/api/public/n8n/backup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleN8n, json, readQuery, N8nHttpError } =
          await import("@/server/n8n/http.server");
        return handleN8n(request, async () => {
          const { backupQuerySchema } = await import("@/server/n8n/schemas.server");
          const q = readQuery(request, backupQuerySchema);
          const { exportUser, listUsersPage, userEmail } =
            await import("@/server/n8n/backup.server");
          const opts = { includeAll: q.include === "all", versions: q.versions === "1" };
          let users: { id: string; email: string | null }[];
          let nextPage: number | null = null;
          if (q.userId === "all") {
            users = await listUsersPage(q.page, q.page_size);
            nextPage = users.length === q.page_size ? q.page + 1 : null;
          } else {
            const email = await userEmail(q.userId);
            if (email === undefined) throw new N8nHttpError(404, "user not found");
            users = [{ id: q.userId, email }];
          }
          const exported = [];
          for (const u of users) exported.push(await exportUser(u.id, u.email, opts));
          const date = new Date().toISOString().slice(0, 10);
          return json(
            {
              version: 1,
              format: "second-brain-backup",
              exported_at: new Date().toISOString(),
              page: q.page,
              next_page: nextPage,
              count: exported.length,
              users: exported,
            },
            200,
            {
              "content-disposition": `attachment; filename="second-brain-backup-${date}${q.userId === "all" ? `-p${q.page}` : ""}.json"`,
              "cache-control": "no-store",
            },
          );
        });
      },
    },
  },
});

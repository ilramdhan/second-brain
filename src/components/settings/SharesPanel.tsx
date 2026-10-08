import { Link } from "@tanstack/react-router";
import { FileText, FolderKanban, Link2, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ShareStats, formatShareDate } from "@/components/share/ShareDialog";
import { Button } from "@/components/ui/button";
import { useNotes, useProjects, useShareActions, useShares } from "@/lib/data";
import { toastError } from "@/lib/errors";
import { usePreferences } from "@/lib/preferences";
import { isShareActive } from "@/lib/share";
import { useConfirm } from "@/components/common/confirm-context";

/** Settings: every active public link of the caller, with views and revoke. */
export function SharesPanel() {
  const { t, locale } = usePreferences();
  const confirm = useConfirm();
  const { data: shares = [], isLoading } = useShares();
  const { data: notes = [] } = useNotes();
  const { data: projects = [] } = useProjects();
  const actions = useShareActions();
  const [busy, setBusy] = useState<string | null>(null);
  const active = shares.filter((s) => isShareActive(s));

  async function revoke(id: string) {
    const share = shares.find((s) => s.id === id);
    const title =
      share?.resource_type === "note"
        ? notes.find((n) => n.id === share.resource_id)?.title
        : projects.find((p) => p.id === share?.resource_id)?.name;
    if (
      !(await confirm({
        title: t("shareRevokeConfirmTitle"),
        description: title
          ? t("shareRevokeConfirmDescNamed", { title })
          : t("shareRevokeConfirmDesc"),
        confirmLabel: t("confirmRevoke"),
        destructive: true,
      }))
    )
      return;
    setBusy(id);
    try {
      await actions.revoke(id);
      toast.success(t("shareRevoked"));
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-4 rounded-md border bg-card p-5" aria-labelledby="shares-title">
      <h2 id="shares-title" className="flex items-center gap-2 font-semibold">
        <Link2 className="h-4 w-4 text-primary" aria-hidden /> {t("sharesSettingsTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("sharesSettingsIntro")}</p>
      {isLoading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />…
        </p>
      ) : active.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("sharesEmpty")}</p>
      ) : (
        <ul className="mt-4 divide-y rounded-xl border">
          {active.map((share) => {
            const isNote = share.resource_type === "note";
            const title = isNote
              ? notes.find((n) => n.id === share.resource_id)?.title
              : projects.find((p) => p.id === share.resource_id)?.name;
            const Icon = isNote ? FileText : FolderKanban;
            return (
              <li
                key={share.id}
                className="flex flex-wrap items-center gap-3 px-3 py-3 sm:flex-nowrap"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <span className="sr-only">{t(isNote ? "sharesNote" : "sharesProject")}: </span>
                    {title ? (
                      isNote ? (
                        <Link
                          to="/notes/$noteId"
                          params={{ noteId: share.resource_id }}
                          className="hover:underline"
                        >
                          {title}
                        </Link>
                      ) : (
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: share.resource_id }}
                          className="hover:underline"
                        >
                          {title}
                        </Link>
                      )
                    ) : (
                      <span className="text-muted-foreground">{t("sharesUnavailable")}</span>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>
                      {share.expires_at
                        ? `${t("shareExpiresOn")} ${formatShareDate(share.expires_at, locale)}`
                        : t("shareNoExpiry")}
                    </span>
                    <ShareStats share={share} />
                  </p>
                </div>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  onClick={() => revoke(share.id)}
                  disabled={busy === share.id}
                  className="ml-auto"
                  aria-label={`${t("shareRevoke")}: ${title ?? t(isNote ? "sharesNote" : "sharesProject")}`}
                >
                  {busy === share.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 aria-hidden />
                  )}
                  {t("shareRevoke")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

import { Check, Copy, Eye, Link2, Loader2, RefreshCw, Share2, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { DemoDisabled } from "@/components/demo/DemoDisabled";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCanShare, useShareActions, useShareFor } from "@/lib/data";
import { toastError } from "@/lib/errors";
import { intlLocale, usePreferences, type Locale, type MessageKey } from "@/lib/preferences";
import {
  SHARE_EXPIRY_OPTIONS,
  shareUrl,
  type ShareExpiry,
  type ShareResourceType,
  type ShareRow,
} from "@/lib/share";

const EXPIRY_LABEL: Record<ShareExpiry, MessageKey> = {
  never: "shareExpiryNever",
  "7d": "shareExpiry7d",
  "30d": "shareExpiry30d",
};

export function formatShareDate(value: string, locale: Locale) {
  return new Date(value).toLocaleDateString(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "12 views · last viewed 3 Oct 2026" */
export function ShareStats({ share }: { share: ShareRow }) {
  const { t, locale } = usePreferences();
  return (
    <span className="inline-flex items-center gap-1">
      <Eye className="h-3.5 w-3.5" aria-hidden />
      {share.view_count} {t("shareViews")}
      {share.last_viewed_at && (
        <>
          {" "}
          · {t("shareLastViewed")} {formatShareDate(share.last_viewed_at, locale)}
        </>
      )}
    </span>
  );
}

/**
 * "Bagikan" button + dialog for a note or project: create a read-only public link, copy it
 * (the raw token exists only in this dialog's state, right after create/regenerate), change the
 * expiry, allow search-engine indexing (off by default), regenerate or revoke, and see the view
 * count.
 */
export function ShareButton({
  resourceType,
  resourceId,
  disabled,
}: {
  resourceType: ShareResourceType;
  resourceId: string;
  disabled?: boolean;
}) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? t("shareNotAllowed") : undefined}
        aria-haspopup="dialog"
      >
        <Share2 aria-hidden />
        <span className="hidden sm:inline">{t("shareButton")}</span>
        <span className="sr-only sm:hidden">{t("shareButton")}</span>
      </Button>
      {open && (
        <ShareDialog
          open={open}
          onOpenChange={setOpen}
          resourceType={resourceType}
          resourceId={resourceId}
        />
      )}
    </>
  );
}

export function ShareDialog({
  open,
  onOpenChange,
  resourceType,
  resourceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: ShareResourceType;
  resourceId: string;
}) {
  const { t, locale } = usePreferences();
  const { share, isLoading } = useShareFor(resourceType, resourceId);
  const actions = useShareActions();
  const canShare = useCanShare(resourceType, resourceId, !isLoading && !share);
  const notAllowed = !share && canShare.data === false;
  const [expiry, setExpiry] = useState<ShareExpiry | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [indexingDraft, setIndexingDraft] = useState(false);
  const [busy, setBusy] = useState<
    null | "create" | "regenerate" | "revoke" | "expiry" | "indexing"
  >(null);
  const [copied, setCopied] = useState(false);
  const linkId = useId();
  const expiryId = useId();
  const indexingId = useId();
  const indexingHintId = useId();
  const allowIndexing = share ? share.allow_indexing : indexingDraft;
  const url = token && typeof window !== "undefined" ? shareUrl(window.location.origin, token) : "";

  async function run<T>(kind: NonNullable<typeof busy>, fn: () => Promise<T>) {
    setBusy(kind);
    try {
      return await fn();
    } catch (error) {
      // RLS refusal on insert/rotate: say who may share instead of a generic "no access".
      if ((error as { code?: string } | null)?.code === "42501") toast.error(t("shareNotAllowed"));
      else toastError(error);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("shareCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the field is selectable.
      document.getElementById(linkId)?.focus();
    }
  }

  async function create() {
    const result = await run("create", () =>
      actions.create(resourceType, resourceId, expiry ?? "never", indexingDraft),
    );
    if (result) setToken(result.token);
  }

  async function regenerate() {
    if (!share || !confirm(t("shareRegenerateConfirm"))) return;
    const result = await run("regenerate", () => actions.regenerate(share.id));
    if (result) {
      setToken(result.token);
      toast.success(t("shareRegenerated"));
    }
  }

  async function revoke() {
    if (!share || !confirm(t("shareRevokeConfirm"))) return;
    const done = await run("revoke", async () => {
      await actions.revoke(share.id);
      return true;
    });
    if (done) {
      setToken(null);
      toast.success(t("shareRevoked"));
    }
  }

  async function changeExpiry(next: ShareExpiry) {
    setExpiry(next);
    if (share) await run("expiry", () => actions.setExpiry(share.id, next));
  }

  async function changeIndexing(next: boolean) {
    if (!share) return setIndexingDraft(next);
    await run("indexing", () => actions.setIndexing(share.id, next));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={locale === "en" ? "Close" : "Tutup"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" aria-hidden />
            {t(resourceType === "note" ? "shareTitleNote" : "shareTitleProject")}
          </DialogTitle>
          <DialogDescription>{t("shareIntro")}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t(resourceType === "note" ? "shareIntroNote" : "shareIntroProject")}
        </p>

        <div className="space-y-1.5">
          <label htmlFor={expiryId} className="text-sm font-medium">
            {t("shareExpiry")}
          </label>
          <Select
            value={expiry ?? (share ? "" : "never")}
            onValueChange={(v) => void changeExpiry(v as ShareExpiry)}
            disabled={busy !== null}
          >
            <SelectTrigger id={expiryId} data-slot="select-trigger">
              <SelectValue
                placeholder={
                  share?.expires_at
                    ? `${t("shareExpiresOn")} ${formatShareDate(share.expires_at, locale)}`
                    : t("shareNoExpiry")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {SHARE_EXPIRY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(EXPIRY_LABEL[option])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <label htmlFor={indexingId} className="text-sm font-medium">
              {t("shareIndexing")}
            </label>
            <p id={indexingHintId} className="text-xs text-muted-foreground">
              {t("shareIndexingHint")}
            </p>
          </div>
          <DemoDisabled className="shrink-0">
            <Switch
              id={indexingId}
              checked={allowIndexing}
              onCheckedChange={(v) => void changeIndexing(v)}
              disabled={busy !== null || notAllowed}
              aria-describedby={indexingHintId}
              className="mt-1 shrink-0"
            />
          </DemoDisabled>
        </div>

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />…
          </p>
        ) : share ? (
          <div className="space-y-3 rounded-xl border bg-secondary/40 p-3 text-sm">
            {token ? (
              <div className="space-y-1.5">
                <label htmlFor={linkId} className="font-medium">
                  {t("shareLinkLabel")}
                </label>
                <div className="flex gap-2">
                  <Input
                    id={linkId}
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    onClick={copy}
                    aria-label={t("shareCopy")}
                    className="shrink-0"
                  >
                    {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    <span className="hidden sm:inline">{t("shareCopy")}</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("shareLinkOnce")}</p>
              </div>
            ) : (
              <p className="text-muted-foreground">{t("shareLinkHidden")}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                {t("shareActiveSince")} {formatShareDate(share.created_at, locale)}
              </span>
              <span>
                {share.expires_at
                  ? `${t("shareExpiresOn")} ${formatShareDate(share.expires_at, locale)}`
                  : t("shareNoExpiry")}
              </span>
              <ShareStats share={share} />
            </div>
          </div>
        ) : notAllowed ? (
          <p
            className="rounded-xl border bg-secondary/40 p-3 text-sm text-muted-foreground"
            role="status"
          >
            {t("shareNotAllowed")}
          </p>
        ) : null}

        <DialogFooter>
          {share ? (
            <>
              <div className="flex flex-col-reverse gap-2 sm:mr-auto sm:flex-row [&>button]:h-11 sm:[&>button]:h-9">
                <Button
                  variant="ghost"
                  onClick={revoke}
                  disabled={busy !== null}
                  className="text-destructive hover:text-destructive"
                >
                  {busy === "revoke" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 aria-hidden />
                  )}
                  {t("shareRevoke")}
                </Button>
              </div>
              <Button variant="outline" onClick={regenerate} disabled={busy !== null}>
                {busy === "regenerate" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw aria-hidden />
                )}
                {t("shareRegenerate")}
              </Button>
            </>
          ) : (
            <Button onClick={create} disabled={busy !== null || isLoading || notAllowed}>
              {busy === "create" ? <Loader2 className="animate-spin" /> : <Link2 aria-hidden />}
              {t("shareCreate")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEMO_IDLE_OPTIONS, getIdleMinutes, IDLE_KEY } from "@/hooks/use-idle-logout";
import { DemoDisabled } from "@/components/demo/DemoDisabled";
import { isDemo } from "@/lib/app-mode";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Send,
  Bell,
  Link2,
  Unlink,
  Download,
  Upload,
  CalendarDays,
  Loader2,
  Copy,
  Info,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { SecurityPanel } from "@/components/settings/SecurityPanel";
import { SharesPanel } from "@/components/settings/SharesPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { intlLocale, tr, usePreferences, type Locale, type Theme } from "@/lib/preferences";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createTelegramLinkCode } from "@/lib/telegram.functions";
import { syncSemanticIndexFn } from "@/lib/semantic.functions";
import { useSemanticStatus } from "@/lib/data";
import { useServerFn } from "@tanstack/react-start";
import {
  BACKUP_TABLES,
  BackupError,
  type BackupRow,
  chunk,
  MAX_BACKUP_BYTES,
  planHabitLogs,
  planUpserts,
  prepareBackup,
} from "@/lib/backup";
import {
  completeGoogleCalendarConnect,
  disconnectGoogleCalendar,
  googleCalendarStatus,
  setGoogleCalendarImport,
  startGoogleCalendarConnect,
  syncGoogleCalendarNow,
} from "@/lib/googleCalendar.functions";
import { Switch } from "@/components/ui/switch";
import { RouteError } from "@/components/common/RouteError";
import { toastError } from "@/lib/errors";
import {
  APP_VERSION,
  BUG_REPORT_URL,
  BUILD_TIME,
  CHANGELOG_URL,
  commitUrl,
  DOCS_URL,
  GIT_SHA,
  hasGitSha,
  releaseTagUrl,
  REPO_URL,
  useLatestRelease,
} from "@/lib/app-version";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/_authenticated/settings")({
  head: (ctx) => pageHead(ctx, { title: "metaSettingsTitle", desc: "metaSettingsDesc" }),
  component: SettingsPage,
  errorComponent: RouteError,
});

function SettingsPage() {
  const { theme, setTheme, locale, setLocale, t } = usePreferences();
  const [telegramChatId, setTelegramChatId] = useState<string | null>(null);
  const [telegramUsername, setTelegramUsername] = useState<string | null>(null);
  const [notifEnabled, setNotifEnabled] = useState(false);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("telegram_chat_id, telegram_username")
      .eq("id", user.id)
      .single();
    setTelegramChatId(data?.telegram_chat_id ?? null);
    setTelegramUsername(data?.telegram_username ?? null);
    setNotifEnabled(typeof Notification !== "undefined" && Notification.permission === "granted");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the Supabase request resolves.
    load();
  }, [load]);

  async function unlinkTelegram() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("profiles")
      .update({ telegram_chat_id: null, telegram_username: null })
      .eq("id", user.id);
    toast.success(tr("admTelegramUnlinked"));
    load();
  }

  async function enableNotifications() {
    if (window.top !== window.self) {
      toast.info(tr("admNotifOpenTab"));
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifEnabled(perm === "granted");
    if (perm === "granted") toast.success(tr("admNotifOn"));
    else toast.error(tr("admNotifDenied"));
  }

  return (
    <PageContainer size="narrow">
      <PageHeader title={t("settings")} subtitle={t("admSettingsSubtitle")} />

      <section className="mb-4 rounded-md border bg-card p-5">
        <h2 className="mb-4 font-semibold">{t("appearance")}</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs text-muted-foreground">{t("theme")}</p>
            <Tabs value={theme} onValueChange={(value) => setTheme(value as Theme)}>
              <TabsList className="w-full">
                <TabsTrigger className="flex-1" value="light">
                  {t("light")}
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="dark">
                  {t("dark")}
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="system">
                  {t("system")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">{t("language")}</p>
            <Tabs value={locale} onValueChange={(value) => setLocale(value as Locale)}>
              <TabsList className="w-full">
                <TabsTrigger className="flex-1" value="id">
                  Indonesia
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="en">
                  English
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="mt-2 text-xs text-muted-foreground">{t("admLanguageNote")}</p>
          </div>
        </div>
      </section>

      <IdleSetting />

      <SecurityPanel />

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Send className="h-4 w-4 text-primary" /> {t("admTelegramTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("admTelegramBody")}</p>
        {telegramChatId ? (
          <div className="mt-4 flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
            <div className="text-sm">
              <p className="font-medium text-secondary-foreground">{t("admConnected")}</p>
              <p className="text-xs text-muted-foreground">@{telegramUsername ?? telegramChatId}</p>
            </div>
            <Button
              variant="ghost"
              onClick={unlinkTelegram}
              className="text-destructive hover:text-destructive"
            >
              <Unlink className="h-3.5 w-3.5" /> {t("admDisconnect")}
            </Button>
          </div>
        ) : (
          <TelegramLinkPanel onLinked={load} />
        )}
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Bell className="h-4 w-4 text-primary" /> {t("admNotifTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("admNotifBody")}</p>
        <Button onClick={enableNotifications} disabled={notifEnabled} className="mt-4">
          {notifEnabled ? t("admNotifAlready") : t("admNotifEnable")}
        </Button>
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">{t("admPwaTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("admPwaBody")}</p>
      </section>

      <GoogleCalendarPanel />

      <BackupPanel />

      <SharesPanel />

      <SemanticIndexPanel />

      <AboutPanel />
    </PageContainer>
  );
}

function TelegramLinkPanel({ onLinked }: { onLinked: () => Promise<void> | void }) {
  const { t } = usePreferences();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{
    code: string;
    expiresAt: string;
    deepLink: string | null;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const remainingMs = link ? new Date(link.expiresAt).getTime() - now : 0;
  const expired = Boolean(link) && remainingMs <= 0;

  // While a code is active, tick the countdown and re-check the link status every few seconds.
  useEffect(() => {
    if (!link || expired) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void onLinked(), 4000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [link, expired, onLinked]);

  async function generate() {
    setBusy(true);
    try {
      const result = await createTelegramLinkCode();
      setLink(result);
      setNow(Date.now());
    } catch (error) {
      toastError(error, t("admTgCodeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("admCommandCopied"));
    } catch {
      toast.error(t("admCopyFailed"));
    }
  }

  const minutes = Math.floor(Math.max(remainingMs, 0) / 60_000);
  const seconds = Math.floor((Math.max(remainingMs, 0) % 60_000) / 1000);
  const command = link ? `/link ${link.code}` : "";

  return (
    <div className="mt-4 rounded-xl border border-dashed p-4 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <Link2 className="h-4 w-4" /> {t("admTgHowTo")}
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>{t("admTgStep1")}</li>
        <li>{t("admTgStep2")}</li>
        <li>
          {t("admTgStep3Pre")} <code className="rounded bg-secondary px-1">/link KODE</code>{" "}
          {t("admTgStep3Post")}
        </li>
      </ol>

      {link && !expired ? (
        <div className="mt-4 rounded-xl bg-secondary px-4 py-3">
          <p className="text-xs text-muted-foreground">{t("admTgSendThis")}</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <code
              className="font-mono text-lg font-semibold tracking-wider text-secondary-foreground"
              aria-label={t("admTgCommandLabel", { command })}
            >
              {command}
            </code>
            <Button variant="ghost" size="sm" onClick={() => copy(command)}>
              <Copy className="h-3.5 w-3.5" /> {t("admCopy")}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            {t("admTgExpiresIn", { time: `${minutes}:${String(seconds).padStart(2, "0")}` })}
          </p>
          {link.deepLink ? (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <a href={link.deepLink} target="_blank" rel="noopener noreferrer">
                <Send className="h-3.5 w-3.5" /> {t("admTgOpenBot")}
              </a>
            </Button>
          ) : null}
        </div>
      ) : expired ? (
        <p className="mt-4 text-xs text-destructive">{t("admTgExpired")}</p>
      ) : null}

      <DemoDisabled>
        <Button onClick={generate} disabled={busy} className="mt-4">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {link ? t("admTgNewCode") : t("admTgConnect")}
        </Button>
      </DemoDisabled>
    </div>
  );
}

function GoogleCalendarPanel() {
  const { t, intl } = usePreferences();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: () => googleCalendarStatus(),
  });
  async function connect() {
    const popup = window.open("", "google-calendar-oauth", "width=600,height=720");
    if (!popup) {
      toast.error(t("admAllowPopup"));
      return;
    }
    setBusy(true);
    const wait = new Promise<{ code: string; state: string }>((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== popup) return;
        if (
          event.data?.type === "googleCalendarComplete" &&
          typeof event.data.code === "string" &&
          typeof event.data.state === "string"
        ) {
          cleanup();
          resolve({ code: event.data.code, state: event.data.state });
        } else if (event.data?.type === "googleCalendarFailed") {
          cleanup();
          reject(new Error(t("admGoogleNotDone")));
        }
      };
      const poll = window.setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error(t("admPopupClosed")));
        }
      }, 500);
      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        window.clearInterval(poll);
      };
      window.addEventListener("message", onMessage);
    });
    try {
      const { authorizationUrl } = await startGoogleCalendarConnect();
      popup.location.href = authorizationUrl;
      const result = await wait;
      await completeGoogleCalendarConnect({ data: result });
      toast.success(t("admGcalConnected"));
      await qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
    } catch (error) {
      popup.close();
      toastError(error, t("admConnectFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function syncNow() {
    setBusy(true);
    try {
      const r = await syncGoogleCalendarNow();
      toast.success(
        t("admGcalSynced", { pulled: r.pulled, pushed: r.pushed }) +
          (r.failed ? t("admGcalSyncedFailed", { failed: r.failed }) : ""),
      );
      await qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
      await qc.invalidateQueries({ queryKey: ["tasks"] });
    } catch (error) {
      toastError(error, t("admSyncFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function toggleImport(enabled: boolean) {
    try {
      await setGoogleCalendarImport({ data: { enabled } });
      await qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
    } catch (error) {
      toastError(error, t("admSaveFailed"));
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await disconnectGoogleCalendar();
      toast.success(t("admGcalDisconnected"));
      await qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
    } catch (error) {
      toastError(error, t("admDisconnectFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-4 rounded-md border bg-card p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <CalendarDays className="h-4 w-4 text-primary" /> Google Calendar
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("admGcalBody")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <DemoDisabled>
          <Button
            variant={data?.connected ? "outline" : "default"}
            onClick={data?.connected ? disconnect : connect}
            disabled={busy || isLoading || (!data?.connected && data?.configured === false)}
          >
            {busy || isLoading ? (
              <Loader2 className="animate-spin" />
            ) : data?.connected ? (
              <Unlink />
            ) : (
              <Link2 />
            )}
            {data?.connected ? t("admDisconnect") : t("admGcalConnect")}
          </Button>
        </DemoDisabled>
        {data?.connected ? (
          <Button variant="outline" onClick={syncNow} disabled={busy}>
            <RefreshCw className={busy ? "animate-spin" : undefined} /> {t("admSyncNow")}
          </Button>
        ) : null}
      </div>
      {data?.connected ? (
        <div className="mt-3 space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={data.importEvents} onCheckedChange={toggleImport} />
            {t("admGcalImport")}
          </label>
          <p className="text-xs text-muted-foreground">
            {t("admGcalImportBody")}
            {data.lastPulledAt
              ? ` ${t("admGcalLastSynced", { time: new Date(data.lastPulledAt).toLocaleString(intl) })}`
              : ""}
          </p>
        </div>
      ) : null}
      <div>
        {data?.configured === false && !isDemo() ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("admGcalNotConfigured")}</p>
        ) : null}
      </div>
    </section>
  );
}

function BackupPanel() {
  const { t } = usePreferences();
  const qc = useQueryClient();
  async function download() {
    const tables: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      // PostgREST returns at most 1000 rows per request (habit logs easily exceed that).
      const rows: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .order("id")
          .range(from, from + 999);
        if (error) {
          toastError(error);
          return;
        }
        rows.push(...data);
        if (data.length < 1000) break;
      }
      tables[table] = rows;
    }
    const blob = new Blob(
      [JSON.stringify({ version: 1, exported_at: new Date().toISOString(), tables }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `second-brain-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(t("admBackupDownloaded"));
    return;
  }
  /**
   * Habit logs: keep only logs of the user's own habits (owner-only, restored just before) and
   * re-key logs for a day that already has a check-in (one row per habit and day).
   */
  async function prepareHabitLogs(rows: BackupRow[], userId: string) {
    const owned = new Set<string>();
    for (const ids of chunk([...new Set(rows.map((r) => String(r["habit_id"])))], 200)) {
      const { data, error } = await supabase
        .from("habits")
        .select("id")
        .eq("user_id", userId)
        .in("id", ids);
      if (error) throw error;
      for (const h of data) owned.add(h.id);
    }
    const existing: { id: string; habit_id: string; date: string }[] = [];
    const seen = new Set<string>();
    const add = (data: { id: string; habit_id: string; date: string }[]) => {
      for (const l of data) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        existing.push(l);
      }
    };
    for (const ids of chunk([...owned], 50)) {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("habit_logs")
          .select("id,habit_id,date")
          .in("habit_id", ids)
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        add(data);
        if (data.length < 1000) break;
      }
    }
    for (const ids of chunk(
      rows.map((r) => r.id),
      200,
    )) {
      const { data, error } = await supabase
        .from("habit_logs")
        .select("id,habit_id,date")
        .in("id", ids);
      if (error) throw error;
      add(data);
    }
    return planHabitLogs(rows, owned, existing);
  }
  async function restore(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES)
        throw new BackupError(t("admBackupTooLarge", { mb: MAX_BACKUP_BYTES / 1024 / 1024 }));
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new BackupError(t("admBackupSession"));
      let parsed: unknown;
      try {
        // Automatic backups from n8n are gzipped (.json.gz); decompress in the browser.
        const gz = /\.gz$/i.test(file.name) || file.type === "application/gzip";
        const text = gz
          ? await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text()
          : await file.text();
        if (text.length > MAX_BACKUP_BYTES * 4) throw new Error("too large");
        parsed = JSON.parse(text);
      } catch {
        throw new BackupError(t("admBackupInvalid"));
      }
      const prepared = prepareBackup(parsed, userId);
      let restored = 0;
      let skipped = 0;
      for (const table of BACKUP_TABLES) {
        let rows = prepared[table];
        if (!rows.length) continue;
        if (table === "habit_logs") {
          const habit = await prepareHabitLogs(rows, userId);
          rows = habit.rows;
          skipped += habit.skipped;
          if (!rows.length) continue;
        }
        // Only rows we own may be updated; ids owned by someone else are skipped and unseen ids
        // are inserted with ON CONFLICT DO NOTHING (ids hidden by RLS are never overwritten).
        const existing: { id: string; user_id: string }[] = [];
        for (const ids of chunk(
          rows.map((r) => r.id),
          200,
        )) {
          const { data, error } = await supabase.from(table).select("id,user_id").in("id", ids);
          if (error) throw error;
          existing.push(...(data ?? []));
        }
        const plan = planUpserts(rows, existing, userId);
        skipped += plan.skipped;
        for (const batch of chunk(plan.update, 500)) {
          const { error } = await supabase
            .from(table)
            .upsert(batch as never[], { onConflict: "id" });
          if (error) throw error;
        }
        for (const batch of chunk(plan.insert, 500)) {
          const { error } = await supabase
            .from(table)
            .upsert(batch as never[], { onConflict: "id", ignoreDuplicates: true });
          if (error) throw error;
        }
        restored += plan.update.length + plan.insert.length;
      }
      // Restored rows bypass the data hooks; drop the cached lists so every view refetches.
      void qc.invalidateQueries();
      toast.success(
        skipped
          ? t("admBackupRestoredSkipped", { restored, skipped })
          : t("admBackupRestored", { restored }),
      );
    } catch (error) {
      toastError(error, t("admBackupFailed"));
    }
  }
  return (
    <section className="mt-4 rounded-md border bg-card p-5">
      <h2 className="mb-1 font-semibold">{t("backup")}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t("admBackupBody")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={download}>
          <Download /> {t("admBackupDownload")}
        </Button>
        {isDemo() ? (
          // Restoring writes many rows outside the demo seed and its limits.
          <DemoDisabled>
            <Button variant="outline">
              <Upload /> {t("admBackupRestore")}
            </Button>
          </DemoDisabled>
        ) : (
          <Button asChild variant="outline">
            <label>
              <Upload /> {t("admBackupRestore")}
              <input
                type="file"
                accept="application/json,application/gzip,.json,.gz"
                className="sr-only"
                onChange={restore}
              />
            </label>
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * Settings → semantic search: status and an "Indeks ulang" button that drains the embedding
 * queue (missing or outdated rows) in a loop of server calls, 5 batches (250 rows) each.
 */
function SemanticIndexPanel() {
  const { t } = usePreferences();
  const { data: status, isLoading } = useSemanticStatus();
  const sync = useServerFn(syncSemanticIndexFn);
  const [running, setRunning] = useState(false);
  const [indexed, setIndexed] = useState<number | null>(null);

  async function reindex() {
    setRunning(true);
    setIndexed(0);
    let total = 0;
    try {
      // At most 20 rounds (5000 rows) per click; click again for more.
      for (let round = 0; round < 20; round++) {
        const result = await sync({ data: { batches: 5 } });
        total += result.embedded;
        setIndexed(total);
        if (result.remaining === 0) break;
      }
      toast.success(`${t("semanticIndexDone")}: ${total} ${t("semanticIndexCount")}`);
    } catch (error) {
      toastError(error);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mt-4 rounded-md border bg-card p-5" aria-labelledby="semantic-index-title">
      <h2 id="semantic-index-title" className="mb-1 flex items-center gap-2 font-semibold">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden /> {t("semanticIndexTitle")}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">{t("semanticIndexBody")}</p>
      {!isLoading && !status?.available ? (
        <p className="text-sm text-muted-foreground">{t("semanticIndexUnavailable")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={reindex} disabled={running || isLoading}>
            {running ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            {running ? t("semanticIndexRunning") : t("semanticIndexButton")}
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {indexed !== null ? `${indexed} ${t("semanticIndexCount")}` : ""}
            {status?.demo ? ` ${t("semanticIndexDemo")}` : ""}
          </span>
        </div>
      )}
    </section>
  );
}

function formatBuildTime(iso: string, locale: Locale): string | null {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function AboutPanel() {
  const { locale, t } = usePreferences();
  const { release, updateAvailable, checked } = useLatestRelease();
  const buildTime = formatBuildTime(BUILD_TIME, locale);
  const linkClass = "text-primary underline-offset-4 hover:underline";
  const links = [
    { href: CHANGELOG_URL, label: `${t("aboutChangelog")} (CHANGELOG)` },
    { href: REPO_URL, label: t("aboutRepo") },
    { href: DOCS_URL, label: t("aboutDocs") },
    { href: BUG_REPORT_URL, label: t("aboutReportBug") },
  ];

  return (
    <section className="mt-4 rounded-2xl border bg-card p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Info className="h-4 w-4 text-primary" /> {t("aboutTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("aboutSubtitle")}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t("aboutVersion")}</dt>
        <dd className="font-mono">
          <a className={linkClass} href={releaseTagUrl()} target="_blank" rel="noreferrer">
            v{APP_VERSION}
          </a>
          {` · ${GIT_SHA}`}
        </dd>
        <dt className="text-muted-foreground">{t("aboutCommit")}</dt>
        <dd className="font-mono">
          {hasGitSha() ? (
            <a className={linkClass} href={commitUrl()} target="_blank" rel="noreferrer">
              {GIT_SHA}
            </a>
          ) : (
            GIT_SHA
          )}
        </dd>
        {buildTime ? (
          <>
            <dt className="text-muted-foreground">{t("aboutBuildTime")}</dt>
            <dd suppressHydrationWarning>
              <time dateTime={BUILD_TIME}>{buildTime}</time>
            </dd>
          </>
        ) : null}
      </dl>
      <p className="mt-4 rounded-xl bg-secondary px-4 py-3 text-sm" role="status">
        {!checked ? (
          <span className="text-muted-foreground">{t("aboutChecking")}</span>
        ) : !release ? (
          <span className="text-muted-foreground">{t("aboutCheckFailed")}</span>
        ) : updateAvailable ? (
          <>
            {t("aboutUpdateAvailable")}{" "}
            <a className={linkClass} href={release.url} target="_blank" rel="noreferrer">
              v{release.version}
            </a>
          </>
        ) : (
          t("aboutUpToDate")
        )}
      </p>
      <nav
        aria-label={t("aboutTitle")}
        className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      >
        {links.map((link, index) => (
          <span key={link.href} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
            ) : null}
            <a className={linkClass} href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          </span>
        ))}
      </nav>
    </section>
  );
}

const IDLE_OPTIONS = [
  { value: 0, label: "admIdleNever" },
  { value: 15, label: "admIdle15" },
  { value: 30, label: "admIdle30" },
  { value: 60, label: "admIdle60" },
  { value: 240, label: "admIdle240" },
] as const;

function IdleSetting() {
  // The demo account is shared: it always signs out after at most an hour of inactivity.
  const { t } = usePreferences();
  const demo = isDemo();
  const [value, setValue] = useState("0");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the stored idle timeout after mount (localStorage is not available during SSR).
    setValue(String(getIdleMinutes()));
  }, []);
  return (
    <section className="mb-4 rounded-md border bg-card p-5">
      <h2 className="font-semibold">{t("admIdleTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("admIdleBody")}
        {demo ? ` ${t("admIdleDemo")}` : null}
      </p>
      <Select
        value={value}
        onValueChange={(v) => {
          setValue(v);
          localStorage.setItem(IDLE_KEY, v);
          toast.success(t("saved"));
        }}
      >
        <SelectTrigger className="mt-3 w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {IDLE_OPTIONS.filter((o) => !demo || DEMO_IDLE_OPTIONS.includes(o.value)).map((o) => (
            <SelectItem key={o.value} value={String(o.value)}>
              {t(o.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}

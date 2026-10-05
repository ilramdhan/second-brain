import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getIdleMinutes, IDLE_KEY } from "@/hooks/use-idle-logout";
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
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePreferences, type Locale, type Theme } from "@/lib/preferences";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createTelegramLinkCode } from "@/lib/telegram.functions";
import {
  BACKUP_TABLES,
  BackupError,
  chunk,
  MAX_BACKUP_BYTES,
  planUpserts,
  prepareBackup,
} from "@/lib/backup";
import {
  completeGoogleCalendarConnect,
  disconnectGoogleCalendar,
  googleCalendarStatus,
  startGoogleCalendarConnect,
} from "@/lib/googleCalendar.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Pengaturan — Second Brain" },
      { name: "description", content: "Atur tampilan, bahasa, koneksi, notifikasi, dan backup." },
      { property: "og:title", content: "Pengaturan — Second Brain" },
      {
        property: "og:description",
        content: "Atur tampilan, bahasa, koneksi, notifikasi, dan backup.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { theme, setTheme, locale, setLocale, t } = usePreferences();
  const en = locale === "en";
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
    toast.success("Telegram diputus");
    load();
  }

  async function enableNotifications() {
    if (window.top !== window.self) {
      toast.info("Buka aplikasi di tab sendiri (bukan preview) untuk mengaktifkan notifikasi.");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifEnabled(perm === "granted");
    if (perm === "granted") toast.success("Notifikasi aktif");
    else toast.error("Izin notifikasi ditolak — cek pengaturan situs di browser");
  }

  return (
    <PageContainer size="narrow">
      <PageHeader
        title={t("settings")}
        subtitle={
          en
            ? "Your profile, appearance, notifications, connections, and data."
            : "Profil, tampilan, notifikasi, koneksi, dan data Anda."
        }
      />

      <section className="mb-4 rounded-md border bg-card p-5">
        <h2 className="mb-4 font-semibold">{t("appearance")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
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
            <p className="mt-2 text-xs text-muted-foreground">
              {en
                ? "Content you create is not translated."
                : "Isi buatan Anda tidak diterjemahkan."}
            </p>
          </div>
        </div>
      </section>

      <IdleSetting />

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Send className="h-4 w-4 text-primary" /> Bot Telegram
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Kirim chat ke bot seperti biasa Anda mencatat di WhatsApp — semua pesan otomatis masuk ke
          Inbox, dan pengingat deadline dikirim ke Telegram Anda.
        </p>
        {telegramChatId ? (
          <div className="mt-4 flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
            <div className="text-sm">
              <p className="font-medium text-secondary-foreground">Terhubung</p>
              <p className="text-xs text-muted-foreground">@{telegramUsername ?? telegramChatId}</p>
            </div>
            <Button
              variant="ghost"
              onClick={unlinkTelegram}
              className="text-destructive hover:text-destructive"
            >
              <Unlink className="h-3.5 w-3.5" /> Putuskan
            </Button>
          </div>
        ) : (
          <TelegramLinkPanel onLinked={load} />
        )}
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Bell className="h-4 w-4 text-primary" /> Notifikasi di perangkat
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pengingat deadline juga muncul sebagai notifikasi saat aplikasi terbuka.
        </p>
        <Button onClick={enableNotifications} disabled={notifEnabled} className="mt-4">
          {notifEnabled ? "Notifikasi sudah aktif" : "Aktifkan notifikasi"}
        </Button>
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Pasang di HP (PWA)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Buka aplikasi ini di browser HP, lalu pilih "Tambahkan ke Layar Utama" / "Add to Home
          Screen" dari menu browser. Aplikasi akan terasa seperti aplikasi native.
        </p>
      </section>

      <GoogleCalendarPanel />

      <BackupPanel />
    </PageContainer>
  );
}

function TelegramLinkPanel({ onLinked }: { onLinked: () => Promise<void> | void }) {
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
      toast.error(error instanceof Error ? error.message : "Gagal membuat kode tautan Telegram.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Perintah disalin");
    } catch {
      toast.error("Gagal menyalin — salin manual");
    }
  }

  const minutes = Math.floor(Math.max(remainingMs, 0) / 60_000);
  const seconds = Math.floor((Math.max(remainingMs, 0) % 60_000) / 1000);
  const command = link ? `/link ${link.code}` : "";

  return (
    <div className="mt-4 rounded-xl border border-dashed p-4 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <Link2 className="h-4 w-4" /> Cara menghubungkan
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>Klik "Hubungkan Telegram" untuk membuat kode sekali pakai (berlaku 10 menit).</li>
        <li>Buka bot Second Brain di Telegram.</li>
        <li>
          Kirim perintah <code className="rounded bg-secondary px-1">/link KODE</code> ke bot.
        </li>
      </ol>

      {link && !expired ? (
        <div className="mt-4 rounded-xl bg-secondary px-4 py-3">
          <p className="text-xs text-muted-foreground">Kirim perintah ini ke bot:</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <code
              className="font-mono text-lg font-semibold tracking-wider text-secondary-foreground"
              aria-label={`Perintah tautan ${command}`}
            >
              {command}
            </code>
            <Button variant="ghost" size="sm" onClick={() => copy(command)}>
              <Copy className="h-3.5 w-3.5" /> Salin
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            Berlaku {minutes}:{String(seconds).padStart(2, "0")} lagi · sekali pakai. Halaman ini
            otomatis diperbarui setelah akun terhubung.
          </p>
          {link.deepLink ? (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <a href={link.deepLink} target="_blank" rel="noopener noreferrer">
                <Send className="h-3.5 w-3.5" /> Buka bot &amp; tautkan otomatis
              </a>
            </Button>
          ) : null}
        </div>
      ) : expired ? (
        <p className="mt-4 text-xs text-destructive">Kode kedaluwarsa. Buat kode baru.</p>
      ) : null}

      <Button onClick={generate} disabled={busy} className="mt-4">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {link ? "Buat kode baru" : "Hubungkan Telegram"}
      </Button>
    </div>
  );
}

function GoogleCalendarPanel() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: () => googleCalendarStatus(),
  });
  async function connect() {
    const popup = window.open("", "google-calendar-oauth", "width=600,height=720");
    if (!popup) {
      toast.error("Izinkan pop-up lalu coba lagi.");
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
          reject(new Error("Izin Google tidak selesai."));
        }
      };
      const poll = window.setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error("Jendela koneksi ditutup."));
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
      toast.success("Google Calendar terhubung");
      await qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
    } catch (error) {
      popup.close();
      toast.error(error instanceof Error ? error.message : "Koneksi gagal");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await disconnectGoogleCalendar();
      toast.success("Google Calendar diputus");
      await qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memutus koneksi");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-4 rounded-md border bg-card p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <CalendarDays className="h-4 w-4 text-primary" /> Google Calendar
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Setiap pengguna menghubungkan kalendernya sendiri. Tugas terjadwal dapat dikirim sebagai
        blok waktu.
      </p>
      <div className="mt-4">
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
          {data?.connected ? "Putuskan" : "Hubungkan Google Calendar"}
        </Button>
        {data?.configured === false ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Belum dikonfigurasi oleh admin (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
          </p>
        ) : null}
      </div>
    </section>
  );
}

function BackupPanel() {
  async function download() {
    const tables: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      const { data, error } = await supabase.from(table).select("*");
      if (error) {
        toast.error(error.message);
        return;
      }
      tables[table] = data ?? [];
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
    toast.success("Backup diunduh");
    return;
  }
  async function restore(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES)
        throw new BackupError(
          `File backup terlalu besar (maks ${MAX_BACKUP_BYTES / 1024 / 1024}MB)`,
        );
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new BackupError("Sesi berakhir, silakan masuk lagi");
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new BackupError("File bukan JSON yang valid");
      }
      const prepared = prepareBackup(parsed, userId);
      let restored = 0;
      let skipped = 0;
      for (const table of BACKUP_TABLES) {
        const rows = prepared[table];
        if (!rows.length) continue;
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
      toast.success(
        `Backup dipulihkan (${restored} baris${skipped ? `, ${skipped} milik orang lain dilewati` : ""}). Muat ulang halaman untuk melihat data.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup gagal dipulihkan");
    }
  }
  return (
    <section className="mt-4 rounded-md border bg-card p-5">
      <h2 className="mb-1 font-semibold">Backup & pemulihan</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Ekspor JSON terstruktur atau pulihkan tanpa menghapus data yang sudah ada.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={download}>
          <Download /> Unduh JSON
        </Button>
        <Button asChild variant="outline">
          <label>
            <Upload /> Pulihkan JSON
            <input type="file" accept="application/json" className="sr-only" onChange={restore} />
          </label>
        </Button>
      </div>
    </section>
  );
}

function IdleSetting() {
  const [value, setValue] = useState("0");
  useEffect(() => {
    setValue(String(getIdleMinutes()));
  }, []);
  return (
    <section className="mb-4 rounded-md border bg-card p-5">
      <h2 className="font-semibold">Keamanan sesi</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Keluar otomatis bila aplikasi tidak dipakai. Disarankan untuk perangkat bersama.
      </p>
      <Select
        value={value}
        onValueChange={(v) => {
          setValue(v);
          localStorage.setItem(IDLE_KEY, v);
          toast.success("Tersimpan");
        }}
      >
        <SelectTrigger className="mt-3 w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0">Tidak pernah</SelectItem>
          <SelectItem value="15">Setelah 15 menit</SelectItem>
          <SelectItem value="30">Setelah 30 menit</SelectItem>
          <SelectItem value="60">Setelah 1 jam</SelectItem>
          <SelectItem value="240">Setelah 4 jam</SelectItem>
        </SelectContent>
      </Select>
    </section>
  );
}

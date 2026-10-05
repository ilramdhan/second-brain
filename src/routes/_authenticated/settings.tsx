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
import { Send, Bell, Link2, Unlink, Download, Upload, CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePreferences, type Locale, type Theme } from "@/lib/preferences";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
          <div className="mt-4 rounded-xl border border-dashed p-4 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              <Link2 className="h-4 w-4" /> Cara menghubungkan
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Buka bot Second Brain di Telegram.</li>
              <li>
                Kirim perintah <code className="rounded bg-secondary px-1">/start</code>.
              </li>
              <li>
                Bot membalas dengan kode tautan — akun Anda otomatis terhubung jika email Telegram
                sesuai, atau masukkan kode di sini.
              </li>
            </ol>
          </div>
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
    const wait = new Promise<string>((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== popup) return;
        if (event.data?.type === "googleCalendarComplete" && typeof event.data.code === "string") {
          cleanup();
          resolve(event.data.code);
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
      const code = await wait;
      await completeGoogleCalendarConnect({ data: { code } });
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
          disabled={busy || isLoading}
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
      </div>
    </section>
  );
}

const BACKUP_TABLES = [
  "projects",
  "tasks",
  "notes",
  "milestones",
  "task_dependencies",
  "automations",
] as const;

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
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as {
        version?: number;
        tables?: Record<string, unknown[]>;
      };
      if (parsed.version !== 1 || !parsed.tables) throw new Error("Format backup tidak dikenali");
      for (const table of BACKUP_TABLES) {
        const rows = parsed.tables[table];
        if (!Array.isArray(rows) || !rows.length) continue;
        const { error } = await supabase.from(table).upsert(rows as never[]);
        if (error) throw error;
      }
      toast.success("Backup dipulihkan. Muat ulang halaman untuk melihat data.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup gagal dipulihkan");
    }
    event.target.value = "";
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

import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useIdleLogout } from "@/hooks/use-idle-logout";
import {
  Brain,
  Inbox,
  CheckSquare,
  StickyNote,
  FolderKanban,
  Settings,
  LogOut,
  CalendarDays,
  GanttChart,
  Search,
  Plus,
  Menu,
  Sun,
  Workflow,
  Network,
  Zap,
  Activity,
  Palette,
  BarChart3,
  LayoutTemplate,
  Archive,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { TaskDialogProvider, useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { DemoBanner } from "@/components/demo/DemoBanner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/lib/preferences";
import { logActivity } from "@/lib/activity";
import { LOGIN_PATH, requireSession } from "@/lib/auth";

// Dialog bodies are loaded the first time they open, not with the app shell.
const CommandMenu = lazy(() => import("@/components/CommandMenu"));
const QuickCapture = lazy(() =>
  import("@/components/QuickCapture").then((m) => ({ default: m.QuickCapture })),
);
const QuickTask = lazy(() =>
  import("@/components/tasks/QuickTask").then((m) => ({ default: m.QuickTask })),
);

function DialogFallback() {
  return (
    <div className="flex justify-center py-8">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function AuthPending() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Brain className="h-8 w-8 text-primary motion-safe:animate-pulse" />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated")({
  // The Supabase session lives in browser storage, so the server cannot know who is signed in.
  // Rendering this subtree on the client only lets `beforeLoad` check the session before any
  // page renders: signed-out visitors are redirected to /login, never shown an error page.
  ssr: false,
  // Private app pages: never indexed (robots.txt also disallows them).
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  // Not exposed as route context: it would go stale after a token refresh. Read it via useMe().
  beforeLoad: async ({ context, location }) => {
    await requireSession(context.queryClient, location.href);
  },
  pendingComponent: AuthPending,
  component: AuthenticatedLayout,
});

const NAV = [
  { to: "/today", key: "today", icon: Sun },
  { to: "/inbox", key: "inbox", icon: Inbox },
  { to: "/tasks", key: "tasks", icon: CheckSquare },
  { to: "/calendar", key: "calendar", icon: CalendarDays },
  { to: "/timeline", key: "timeline", icon: GanttChart },
  { to: "/projects", key: "projects", icon: FolderKanban },
  { to: "/notes", key: "notes", icon: StickyNote },
  { to: "/graph", key: "graph", icon: Network },
  { to: "/canvas", key: "canvas", icon: Palette },
  { to: "/automations", key: "automations", icon: Workflow },
  { to: "/reports", key: "reports", icon: BarChart3 },
  { to: "/templates", key: "templates", icon: LayoutTemplate },
  { to: "/archive", key: "archive", icon: Archive },
  { to: "/activity", key: "activity", icon: Activity },
  { to: "/settings", key: "settings", icon: Settings },
] as const;
const MOBILE = ["/today", "/tasks", "/calendar", "/projects"];

function AuthenticatedLayout() {
  const navigate = useNavigate();
  // A session can also end while a page is open (token revoked, sign-out in another tab). The
  // global listener in src/lib/auth.ts clears the cache; this sends the visitor to /login.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") void navigate({ to: LOGIN_PATH, replace: true });
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <TaskDialogProvider>
      <Shell />
    </TaskDialogProvider>
  );
}

function Shell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { newTask } = useTaskDialog();
  const { t } = usePreferences();
  const [cmd, setCmd] = useState(false);
  const [capture, setCapture] = useState(false);
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)))
        return;
      if (document.querySelector("[role=dialog]")) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "q" || e.key === "Q")) {
        e.preventDefault();
        setQuick(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Ctrl/Cmd+K toggles the palette from anywhere (also inside inputs), like before.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmd((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);

  // Close the mobile menu on navigation (state adjusted during render, not in an effect).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMore(false);
  }

  async function signOut() {
    await logActivity("signed_out", "auth", undefined, {}, "auth");
    await supabase.auth.signOut();
    queryClient.clear();
    navigate({ to: LOGIN_PATH });
  }
  const onIdle = useCallback(async () => {
    await logActivity("idle_timeout", "auth", undefined, {}, "auth");
    await supabase.auth.signOut();
    queryClient.clear();
    toast.message("Anda otomatis keluar karena tidak aktif");
    navigate({ to: LOGIN_PATH });
  }, [navigate, queryClient]);
  useIdleLogout(onIdle);

  const navLinks = (
    <>
      {NAV.map(({ to, key, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            isActive(to) && "bg-sidebar-accent text-sidebar-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          {t(key)}
        </Link>
      ))}
    </>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Brain className="h-4 w-4" />
          </div>
          <span className="font-semibold tracking-tight">Second Brain</span>
        </div>
        <div className="space-y-2 px-3 pb-3">
          <Button className="w-full justify-start" size="sm" onClick={() => setCapture(true)}>
            <Plus /> {t("quickCapture")}
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            size="sm"
            onClick={() => setQuick(true)}
          >
            <Zap /> {t("quickTask")}{" "}
            <kbd className="ml-auto rounded border px-1.5 text-[10px] font-normal text-muted-foreground">
              Q
            </kbd>
          </Button>
          <button
            onClick={() => setCmd(true)}
            className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
          >
            <Search className="h-4 w-4" /> {t("search")}{" "}
            <kbd className="ml-auto rounded border px-1.5 text-[10px]">Ctrl K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">{navLinks}</nav>
        <div className="border-t p-3">
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="h-4 w-4" /> {t("signOut")}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <DemoBanner />
        <div className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/90 px-4 py-2.5 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Brain className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Second Brain</span>
          </div>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" onClick={() => setCmd(true)} aria-label="Cari">
              <Search />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMore(true)}
              aria-label="Menu lainnya"
            >
              <Menu />
            </Button>
          </div>
        </div>
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.filter((n) => MOBILE.includes(n.to))
          .slice(0, 2)
          .map((n) => (
            <MobileItem
              key={n.to}
              to={n.to}
              label={t(n.key)}
              icon={n.icon}
              active={isActive(n.to)}
            />
          ))}
        <button
          onClick={() => setCapture(true)}
          className="flex items-center justify-center"
          aria-label="Tangkap cepat"
        >
          <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
            <Plus className="h-6 w-6" />
          </span>
        </button>
        {NAV.filter((n) => MOBILE.includes(n.to))
          .slice(2)
          .map((n) => (
            <MobileItem
              key={n.to}
              to={n.to}
              label={t(n.key)}
              icon={n.icon}
              active={isActive(n.to)}
            />
          ))}
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t("menu")}</SheetTitle>
          </SheetHeader>
          <nav className="grid gap-0.5 py-2">{navLinks}</nav>
          <Button
            variant="ghost"
            onClick={signOut}
            className="w-full justify-start text-muted-foreground"
          >
            <LogOut /> {t("signOut")}
          </Button>
        </SheetContent>
      </Sheet>

      <Dialog open={capture} onOpenChange={setCapture}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Tangkap cepat</DialogTitle>
            <DialogDescription>
              Ketik, rekam suara, atau foto catatan. Semuanya masuk Inbox untuk dirapikan AI.
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<DialogFallback />}>
            {capture && <QuickCapture onCaptured={() => setCapture(false)} />}
          </Suspense>
          <button
            onClick={() => {
              setCapture(false);
              setQuick(true);
            }}
            className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Langsung jadi tugas dengan bahasa sehari-hari →
          </button>
          <button
            onClick={() => {
              setCapture(false);
              newTask();
            }}
            className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Atau buat tugas lengkap langsung →
          </button>
        </DialogContent>
      </Dialog>

      <Dialog open={quick} onOpenChange={setQuick}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Tugas cepat</DialogTitle>
            <DialogDescription>
              Ketik seperti biasa — tanggal, jam, tag, orang, dan prioritas dikenali otomatis.
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<DialogFallback />}>
            {quick && <QuickTask onDone={() => setQuick(false)} />}
          </Suspense>
        </DialogContent>
      </Dialog>

      {cmd && (
        <Suspense fallback={null}>
          <CommandMenu open={cmd} onOpenChange={setCmd} />
        </Suspense>
      )}
    </div>
  );
}

function MobileItem({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: typeof Sun;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground",
        active && "text-primary",
      )}
    >
      <Icon className="h-5 w-5" />
      {label}
    </Link>
  );
}

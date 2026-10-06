import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { id } from "date-fns/locale";
import { Activity, Filter } from "lucide-react";
import { useState } from "react";

import { LoadMore, usePaged } from "@/components/common/LoadMore";
import { VirtualList } from "@/components/common/VirtualList";
import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { RouteError } from "@/components/common/RouteError";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({
    meta: [
      { title: "Aktivitas — Second Brain" },
      { name: "description", content: "Riwayat aman perubahan dan aktivitas akun." },
      { property: "og:title", content: "Aktivitas — Second Brain" },
      { property: "og:description", content: "Riwayat aman perubahan dan aktivitas akun." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ActivityPage,
  errorComponent: RouteError,
});

function ActivityPage() {
  const [type, setType] = useState("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["activity-logs"],
    // Audit rows are written by DB triggers, never through the cache: always reload on visit.
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
  const types = [...new Set(data.map((row) => row.entity_type))];
  const shown = type === "all" ? data : data.filter((row) => row.entity_type === type);
  const paged = usePaged(shown, 30, type);
  return (
    <PageContainer>
      <PageHeader
        title="Aktivitas"
        subtitle="Log hanya menyimpan metadata perubahan, bukan isi catatan pribadi."
        actions={
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-44">
              <Filter />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua objek</SelectItem>
              {types.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <div className="overflow-hidden rounded-md border bg-card">
        {isLoading && <p className="p-6 text-sm text-muted-foreground">Memuat aktivitas…</p>}
        {!isLoading && shown.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">Belum ada aktivitas.</p>
        )}
        <VirtualList
          className="divide-y"
          items={paged.visible}
          getKey={(row) => row.id}
          estimateSize={64}
          renderItem={(row) => (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium capitalize">
                  {row.action.replaceAll("_", " ")} · {row.entity_type.replaceAll("_", " ")}
                </p>
                <p className="text-xs text-muted-foreground">Sumber: {row.source}</p>
              </div>
              <time className="col-start-2 text-xs text-muted-foreground sm:col-start-auto">
                {formatDistanceToNow(new Date(row.created_at), { addSuffix: true, locale: id })}
              </time>
            </div>
          )}
        />
      </div>
      <LoadMore shown={paged.visible.length} total={paged.total} onMore={paged.more} />
    </PageContainer>
  );
}

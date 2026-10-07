import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/preferences";

/** Client-side incremental pagination: shows `size` items, more on demand; resets when `resetKey` changes. */
export function usePaged<T>(items: T[], size = 20, resetKey: unknown = null) {
  const [count, setCount] = useState(size);
  // Reset when `resetKey`/`size` change (adjusted during render, not in an effect).
  const [prev, setPrev] = useState({ resetKey, size });
  if (prev.resetKey !== resetKey || prev.size !== size) {
    setPrev({ resetKey, size });
    setCount(size);
  }
  return {
    visible: items.slice(0, count),
    total: items.length,
    hasMore: items.length > count,
    more: () => setCount((c) => c + size),
  };
}

export function LoadMore({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  const { t } = useI18n();
  if (total <= shown) return null;
  return (
    <div className="flex flex-col items-center gap-1 py-3">
      <Button variant="outline" size="sm" onClick={onMore}>
        {t("wsLoadMore")}
      </Button>
      <span className="text-[11px] text-muted-foreground">
        {t("wsShowingOf", { shown, total })}
      </span>
    </div>
  );
}

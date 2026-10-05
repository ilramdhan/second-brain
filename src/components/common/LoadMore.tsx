import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** Client-side incremental pagination: shows `size` items, more on demand; resets when `resetKey` changes. */
export function usePaged<T>(items: T[], size = 20, resetKey: unknown = null) {
  const [count, setCount] = useState(size);
  useEffect(() => setCount(size), [resetKey, size]);
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
  if (total <= shown) return null;
  return (
    <div className="flex flex-col items-center gap-1 py-3">
      <Button variant="outline" size="sm" onClick={onMore}>
        Muat lebih banyak
      </Button>
      <span className="text-[11px] text-muted-foreground">
        Menampilkan {shown} dari {total}
      </span>
    </div>
  );
}

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { defaultRangeExtractor, useWindowVirtualizer, type Range } from "@tanstack/react-virtual";

import {
  shouldVirtualize,
  VIRTUALIZE_THRESHOLD,
  withPinnedIndex,
} from "@/components/common/virtual";

type Props<T> = {
  items: T[];
  getKey: (item: T, index: number) => string | number;
  /** Initial row height guess in px; real heights are measured once rows mount. */
  estimateSize: number;
  /** Renders a row's content. Keep it a memoised component so scrolling does not re-render it. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Vertical space between rows in px (replaces `space-y-*`, which breaks absolute rows). */
  gap?: number;
  /** `ul` wraps rows in `li`; `div` wraps them in `div`. */
  as?: "ul" | "div";
  className?: string | undefined;
  itemClassName?: ((item: T, index: number) => string | undefined) | undefined;
  threshold?: number;
};

/**
 * A list that renders every row up to `threshold` items (as before) and windows it above that,
 * mounting only rows near the viewport. It follows the page (window) scroll, so the surrounding
 * layout and a `LoadMore` button under the list keep working: pass `usePaged(...).visible`.
 * The row that holds keyboard focus stays mounted while scrolled away.
 */
export function VirtualList<T>(props: Props<T>) {
  const { items, threshold = VIRTUALIZE_THRESHOLD } = props;
  if (shouldVirtualize(items.length, threshold)) return <WindowedList {...props} />;
  const { getKey, renderItem, gap = 0, as: Tag = "ul", className, itemClassName } = props;
  const Item = Tag === "ul" ? "li" : "div";
  return (
    <Tag className={className} style={{ display: "flex", flexDirection: "column", gap }}>
      {items.map((item, i) => (
        <Item key={getKey(item, i)} className={itemClassName?.(item, i)}>
          {renderItem(item, i)}
        </Item>
      ))}
    </Tag>
  );
}

function WindowedList<T>({
  items,
  getKey,
  estimateSize,
  renderItem,
  gap = 0,
  as: Tag = "ul",
  className,
  itemClassName,
}: Props<T>) {
  const Item = Tag === "ul" ? "li" : "div";
  const listRef = useRef<HTMLElement | null>(null);
  const focusedRef = useRef<number | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Offset of the list from the top of the document. Content above it (headers, filters)
  // can change height, so re-check after every render.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
    if (top !== scrollMargin) setScrollMargin(top);
  });

  const rangeExtractor = useCallback(
    (range: Range) =>
      withPinnedIndex(defaultRangeExtractor(range), focusedRef.current, range.count),
    [],
  );
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateSize,
    overscan: 8,
    gap,
    scrollMargin,
    getItemKey: (i) => getKey(items[i] as T, i),
    rangeExtractor,
  });

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
    focusedRef.current = row ? Number(row.dataset["index"]) : null;
  };
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusedRef.current = null;
  };

  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        listRef.current = node;
      }}
      className={className}
      style={{ position: "relative", height: virtualizer.getTotalSize() }}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {virtualizer.getVirtualItems().map((v) => {
        const item = items[v.index] as T;
        return (
          <Item
            key={v.key}
            ref={virtualizer.measureElement}
            data-index={v.index}
            className={itemClassName?.(item, v.index)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${v.start - scrollMargin}px)`,
            }}
          >
            {renderItem(item, v.index)}
          </Item>
        );
      })}
    </Tag>
  );
}

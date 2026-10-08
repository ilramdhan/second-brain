import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { IconButton } from "@/components/ui/button";

import {
  KEYBOARD_CODES,
  columnNavigator,
  dndAnnouncements,
  droppableKeyboardCoordinates,
  screenReaderInstructions,
} from "@/lib/dnd-a11y";
import { NAV_ITEM_CLASS, navAttrs, type NavState } from "@/hooks/use-keyboard-nav";
import { useI18n } from "@/lib/preferences";
import { cn } from "@/lib/utils";

type Column = { id: string; label: string };

export function Kanban<T extends { id: string }>({
  columns,
  items,
  getColumn,
  renderCard,
  onMove,
  onAdd,
  onOpen,
  itemLabel,
  nav,
}: {
  columns: readonly Column[];
  items: T[];
  getColumn: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onMove: (item: T, columnId: string) => void;
  onAdd?: ((columnId: string) => void) | undefined;
  /** Called on Enter (keyboard activation of a card). */
  onOpen?: ((item: T) => void) | undefined;
  /** Accessible name of a card, used for its label and screen-reader announcements. */
  itemLabel: (item: T) => string;
  /** Keyboard selection (j/k, h/l, Enter) from `useKeyboardNav`. */
  nav?: NavState | undefined;
}) {
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: KEYBOARD_CODES,
      coordinateGetter: droppableKeyboardCoordinates(columnNavigator(columnIds), (id) => {
        const item = items.find((i) => i.id === id);
        return item ? getColumn(item) : null;
      }),
    }),
  );
  const [active, setActive] = useState<T | null>(null);
  const { t } = useI18n();
  const nameOf = (id: unknown) => {
    const item = items.find((i) => i.id === id);
    return item ? itemLabel(item) : t("taskKanbanCard");
  };
  const accessibility = {
    screenReaderInstructions,
    announcements: dndAnnouncements({
      itemName: (a) => nameOf(a.id),
      targetName: (id) =>
        t("taskKanbanColumnTarget", {
          name: columns.find((c) => c.id === id)?.label ?? String(id),
        }),
    }),
  };

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const item = items.find((i) => i.id === e.active.id);
    const col = e.over?.id as string | undefined;
    if (item && col && getColumn(item) !== col) onMove(item, col);
  }

  return (
    <DndContext
      sensors={sensors}
      accessibility={accessibility}
      onDragStart={(e) => setActive(items.find((i) => i.id === e.active.id) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="scrollbar-subtle -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {columns.map((c) => {
          const list = items.filter((i) => getColumn(i) === c.id);
          return (
            <KanbanColumn
              key={c.id}
              column={c}
              count={list.length}
              onAdd={onAdd ? () => onAdd(c.id) : undefined}
            >
              {list.map((i) => (
                <DraggableCard
                  key={i.id}
                  id={i.id}
                  label={itemLabel(i)}
                  nav={nav}
                  onOpen={onOpen ? () => onOpen(i) : undefined}
                >
                  {renderCard(i)}
                </DraggableCard>
              ))}
            </KanbanColumn>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? <div className="shadow-lg motion-safe:rotate-1">{renderCard(active)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  column,
  count,
  onAdd,
  children,
}: {
  column: Column;
  count: number;
  onAdd?: (() => void) | undefined;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const { t } = useI18n();
  return (
    <section
      ref={setNodeRef}
      aria-label={t("taskKanbanColumn", { name: column.label })}
      className={cn(
        "flex w-[78vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl border bg-secondary/40 p-2 motion-safe:transition-colors sm:w-72",
        isOver && "border-primary/40 bg-accent/60",
      )}
    >
      <header className="flex items-center justify-between px-2 py-1.5">
        <h3 className="text-sm font-semibold">
          {column.label} <span className="ml-1 font-normal text-muted-foreground">{count}</span>
        </h3>
        {onAdd && (
          <IconButton
            label={t("taskKanbanAddIn", { name: column.label })}
            size="icon-sm"
            className="text-muted-foreground"
            onClick={onAdd}
          >
            <Plus />
          </IconButton>
        )}
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 p-1">{children}</div>
    </section>
  );
}

function DraggableCard({
  id,
  label,
  nav,
  onOpen,
  children,
}: {
  id: string;
  label: string;
  nav?: NavState | undefined;
  onOpen?: (() => void) | undefined;
  children: React.ReactNode;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id,
    attributes: { roleDescription: "kartu yang dapat dipindah" },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      {...(nav ? navAttrs(id, nav.selectedId === id, nav.tabStopId === id) : {})}
      aria-label={label}
      onKeyDown={(e) => {
        listeners?.["onKeyDown"]?.(e);
        // Enter opens the card (Space is reserved for picking it up); ignored mid-drag,
        // where Enter drops the card instead.
        if (e.key === "Enter" && !isDragging && e.target === e.currentTarget && onOpen) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "touch-manipulation rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        nav && NAV_ITEM_CLASS,
        isDragging && "opacity-30",
      )}
    >
      {children}
    </div>
  );
}

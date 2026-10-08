import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Copy, GripVertical, Link2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BLOCK_TYPES,
  indexBlocks,
  newId,
  runQuery,
  shortcut,
  type Block,
  type BlockIndex,
  type BlockType,
} from "@/lib/blocks";
import { useNoteBlocks, useNotes, useProjects, useTasks } from "@/lib/data";
import { useI18n, type MessageKey } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { Button, pressableFocus } from "@/components/ui/button";
import { NoteLinksContext, noteTitleKey, useNoteLinks, useNoteLinksValue } from "./note-links";

type Menu = { kind: "slash" | "wiki" | "ref"; query: string; index: number } | null;
const CONTINUES: BlockType[] = ["bullet", "numbered", "todo"];
/** Display names of the block types (`BLOCK_TYPES.label` stays Indonesian for slash matching). */
const BLOCK_LABEL_KEYS: Record<BlockType, MessageKey> = {
  p: "noteBlockText",
  h1: "noteBlockH1",
  h2: "noteBlockH2",
  h3: "noteBlockH3",
  todo: "noteBlockTodo",
  bullet: "noteBlockBullet",
  numbered: "noteBlockNumbered",
  quote: "noteBlockQuote",
  code: "noteBlockCode",
  divider: "noteDivider",
  query: "noteBlockQuery",
  embed: "noteBlockEmbed",
};

/* ---------- inline rendering ---------- */
/**
 * Renders inline markup (links, refs, bold, code, URLs, tags). Note titles come from
 * `NoteLinksContext` (one memoised map per editor) instead of a `useNotes`
 * subscription per fragment; `memo` skips blocks whose text didn't change.
 */
export const InlineText = memo(function InlineText({
  text,
  index,
  depth = 0,
}: {
  text: string;
  index: BlockIndex;
  depth?: number;
}) {
  const { titles, openTitle } = useNoteLinks();
  const { t } = useI18n();
  const parts = useMemo(
    () =>
      text.split(
        /(\[\[[^\]\n]+?\]\]|\(\([a-z0-9]{6,10}\)\)|\*\*[^*]+\*\*|`[^`]+`|https?:\/\/\S+|(?:^|\s)#[\p{L}\p{N}_-]+)/u,
      ),
    [text],
  );
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith("[[")) {
          const [target, alias] = p.slice(2, -2).split("|");
          const exists = titles.has(noteTitleKey(target!));
          return (
            // eslint-disable-next-line no-restricted-syntax -- exception: inline [[wiki link]] inside rendered text
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                openTitle(target!);
              }}
              type="button"
              className={cn(
                "rounded-sm font-medium underline decoration-primary/40 underline-offset-2 hover:decoration-primary",
                pressableFocus,
                exists ? "text-primary" : "text-muted-foreground decoration-dashed",
              )}
            >
              {alias ?? target}
            </button>
          );
        }
        if (p.startsWith("((")) {
          const ref = index.get(p.slice(2, -2));
          if (!ref)
            return (
              <span key={i} className="rounded bg-destructive/10 px-1 text-xs text-destructive">
                {t("noteBlockNotFound")}
              </span>
            );
          return (
            <Link
              key={i}
              to="/notes/$noteId"
              params={{ noteId: ref.note.id }}
              onClick={(e) => e.stopPropagation()}
              className="rounded bg-accent/70 px-1 text-accent-foreground hover:bg-accent"
              title={t("noteRefFrom", { title: ref.note.title })}
            >
              {depth > 2 ? (
                ref.block.text
              ) : (
                <InlineText text={ref.block.text} index={index} depth={depth + 1} />
              )}
            </Link>
          );
        }
        if (p.startsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`"))
          return (
            <code key={i} className="rounded bg-secondary px-1 font-mono text-[0.9em]">
              {p.slice(1, -1)}
            </code>
          );
        if (/^https?:\/\//.test(p))
          return (
            <a
              key={i}
              href={p}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-primary underline underline-offset-2"
            >
              {p}
            </a>
          );
        if (/^\s?#/.test(p))
          return (
            <Fragment key={i}>
              {p.startsWith(" ") ? " " : ""}
              <span className="text-primary/80">{p.trim()}</span>
            </Fragment>
          );
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
});

function QueryView({ query }: { query: string }) {
  const { data: notes = [] } = useNotes();
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { t, intl } = useI18n();
  const res = useMemo(
    () => runQuery(query, notes, tasks, projects),
    [query, notes, tasks, projects],
  );
  if (!query.trim())
    return (
      <p className="text-sm text-muted-foreground">
        {t("noteQueryHint")}{" "}
        <code>TABLE rating FROM #buku WHERE rating &gt; 4 SORT rating DESC</code>
      </p>
    );
  if (res.error) return <p className="text-sm text-destructive">{res.error}</p>;
  const linkFor = (id: string, title: string) =>
    res.source === "notes" ? (
      <Link
        to="/notes/$noteId"
        params={{ noteId: id }}
        className="font-medium text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {title}
      </Link>
    ) : (
      <span className="font-medium">{title}</span>
    );
  const fmt = (v: unknown) =>
    Array.isArray(v)
      ? v.join(", ")
      : v === null || v === undefined
        ? "–"
        : typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)
          ? new Date(v).toLocaleDateString(intl)
          : String(v);
  return (
    <div className="overflow-x-auto rounded-lg border">
      {res.mode === "table" ? (
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t(res.source === "notes" ? "noteQueryNotes" : "noteQueryTasks")}
              </th>
              {res.columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-1.5">{linkFor(r.id, r.title)}</td>
                {res.columns.map((c) => (
                  <td key={c} className="px-3 py-1.5">
                    {fmt(r.values[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="list-disc space-y-0.5 py-2 pl-8 text-sm">
          {res.rows.map((r) => (
            <li key={r.id}>{linkFor(r.id, r.title)}</li>
          ))}
        </ul>
      )}
      {res.rows.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("noteQueryNoResults")}</p>
      )}
      <p className="border-t bg-secondary/30 px-3 py-1 text-[10px] text-muted-foreground">
        {t("noteQueryResults", { count: res.rows.length })}
      </p>
    </div>
  );
}

/* ---------- editor ---------- */
export function BlockEditor({
  noteId,
  blocks,
  onChange,
}: {
  noteId: string;
  blocks: Block[];
  onChange: (b: Block[]) => void;
}) {
  const noteLinks = useNoteLinksValue();
  const { t } = useI18n();
  /** Block type names come from `BLOCK_TYPES` (ID, also used for slash matching); shown translated. */
  const blockLabel = (type: BlockType) => t(BLOCK_LABEL_KEYS[type]);
  const blockHint = (type: BlockType, hint: string) =>
    type === "p" ? t("noteBlockHintText") : type === "embed" ? t("noteBlockHintEmbed") : hint;
  const { data: notes = [] } = useNotes();
  // Block refs/embeds need every note's blocks; the list cache (`useNotes`) has no blocks.
  const { data: blockNotes = [] } = useNoteBlocks();
  const index = useMemo(() => indexBlocks(blockNotes), [blockNotes]);
  const [focus, setFocus] = useState<{ id: string; caret: number } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [drag, setDrag] = useState<{ from: string; over: string | null } | null>(null);
  const refs = useRef(new Map<string, HTMLTextAreaElement>());

  useLayoutEffect(() => {
    if (!focus) return;
    const el = refs.current.get(focus.id);
    if (el && document.activeElement !== el) {
      el.focus();
      const c = Math.min(focus.caret, el.value.length);
      el.setSelectionRange(c, c);
    }
  }, [focus, blocks]);

  const set = (id: string, patch: Partial<Block>) =>
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const insertAfter = (id: string, b: Block) => {
    const i = blocks.findIndex((x) => x.id === id);
    const next = [...blocks];
    next.splice(i + 1, 0, b);
    onChange(next);
    setFocus({ id: b.id, caret: 0 });
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const remove = (id: string) => {
    const i = blocks.findIndex((x) => x.id === id);
    const next = blocks.filter((b) => b.id !== id);
    onChange(next.length ? next : [{ id: newId(), type: "p", text: "" }]);
    const prev = next[Math.max(0, i - 1)];
    if (prev) setFocus({ id: prev.id, caret: prev.text.length });
  };

  const menuItems = (() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    if (menu.kind === "slash")
      return BLOCK_TYPES.filter(
        (bt) =>
          !q ||
          bt.keys.some((k) => k.startsWith(q)) ||
          bt.label.toLowerCase().includes(q) ||
          blockLabel(bt.id).toLowerCase().includes(q),
      ).map((bt) => ({ key: bt.id, label: blockLabel(bt.id), hint: blockHint(bt.id, bt.hint) }));
    if (menu.kind === "wiki") {
      const list = notes
        .filter((n) => n.id !== noteId && n.title.toLowerCase().includes(q))
        .slice(0, 8)
        .map((n) => ({ key: n.title, label: n.title, hint: t("noteMenuHintNote") }));
      if (q && !notes.some((n) => n.title.toLowerCase() === q))
        list.push({
          key: menu.query,
          label: t("noteMenuCreate", { title: menu.query }),
          hint: t("noteMenuHintNew"),
        });
      return list;
    }
    return [...index.values()]
      .filter(
        ({ block, note }) =>
          block.text.trim() &&
          block.type !== "embed" &&
          (note.id !== noteId || true) &&
          block.text.toLowerCase().includes(q),
      )
      .slice(0, 8)
      .map(({ block, note }) => ({
        key: block.id,
        label: block.text.slice(0, 80),
        hint: note.title,
      }));
  })();

  function pick(b: Block, el: HTMLTextAreaElement, key: string) {
    const caret = el.selectionStart;
    if (menu?.kind === "slash") {
      const type = key as BlockType;
      set(b.id, { type, text: "", ...(type === "todo" ? { checked: false } : {}) });
      if (type === "divider") insertAfter(b.id, { id: newId(), type: "p", text: "" });
      else setFocus({ id: b.id, caret: 0 });
    } else if (menu?.kind === "wiki" || menu?.kind === "ref") {
      if (b.type === "embed" && menu.kind === "ref") {
        set(b.id, { text: key });
        setFocus(null);
      } else {
        const before = el.value.slice(0, caret);
        const open = menu.kind === "wiki" ? "[[" : "((";
        const close = menu.kind === "wiki" ? "]]" : "))";
        const start = before.lastIndexOf(open);
        const after = el.value.slice(caret).replace(/^[^\s\])]*(\]\]|\)\))?/, "");
        const text = before.slice(0, start) + open + key + close + after;
        set(b.id, { text });
        setFocus({ id: b.id, caret: start + open.length + key.length + 2 });
      }
    }
    setMenu(null);
  }

  function onInput(b: Block, el: HTMLTextAreaElement) {
    const text = el.value;
    const caret = el.selectionStart;
    if (b.type === "p") {
      const s = shortcut(text);
      if (s) {
        set(b.id, s);
        setFocus({ id: b.id, caret: s.text.length });
        setMenu(null);
        return;
      }
    }
    set(b.id, { text });
    const before = text.slice(0, caret);
    if (b.type !== "code" && b.type !== "query" && /^\/[\w-]*$/.test(text))
      setMenu({ kind: "slash", query: text.slice(1), index: 0 });
    else if (/\[\[([^\]\n]*)$/.test(before))
      setMenu({ kind: "wiki", query: /\[\[([^\]\n]*)$/.exec(before)![1]!, index: 0 });
    else if (/\(\(([^)\n]*)$/.test(before))
      setMenu({ kind: "ref", query: /\(\(([^)\n]*)$/.exec(before)![1]!, index: 0 });
    else if (b.type === "embed")
      setMenu({ kind: "ref", query: text.replace(/^\(\(/, ""), index: 0 });
    else setMenu(null);
  }

  function onKey(b: Block, e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (menu && menuItems.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenu({ ...menu, index: (menu.index + 1) % menuItems.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenu({ ...menu, index: (menu.index - 1 + menuItems.length) % menuItems.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(b, el, menuItems[menu.index]!.key);
        return;
      }
    }
    if (e.key === "Escape") {
      setMenu(null);
      setFocus(null);
      el.blur();
      return;
    }
    const i = blocks.findIndex((x) => x.id === b.id);
    if (e.key === "Enter" && !e.shiftKey && b.type !== "code" && b.type !== "query") {
      e.preventDefault();
      if (CONTINUES.includes(b.type) && !b.text.trim()) {
        set(b.id, { type: "p" });
        return;
      }
      const c = el.selectionStart;
      const head = el.value.slice(0, c),
        tail = el.value.slice(c);
      const nb: Block = {
        id: newId(),
        type: CONTINUES.includes(b.type) ? b.type : "p",
        text: tail,
        ...(b.type === "todo" ? { checked: false } : {}),
      };
      const next = blocks.map((x) => (x.id === b.id ? { ...x, text: head } : x));
      next.splice(i + 1, 0, nb);
      onChange(next);
      setFocus({ id: nb.id, caret: 0 });
      return;
    }
    if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (b.type !== "p") {
        e.preventDefault();
        set(b.id, { type: "p" });
        return;
      }
      const prev = blocks[i - 1];
      if (prev && prev.type !== "divider" && prev.type !== "embed" && prev.type !== "query") {
        e.preventDefault();
        onChange(
          blocks
            .filter((x) => x.id !== b.id)
            .map((x) => (x.id === prev.id ? { ...x, text: x.text + b.text } : x)),
        );
        setFocus({ id: prev.id, caret: prev.text.length });
      } else if (prev && !b.text) {
        e.preventDefault();
        remove(b.id);
      }
      return;
    }
    if (e.key === "ArrowUp" && el.selectionStart === 0 && i > 0) {
      e.preventDefault();
      setFocus({ id: blocks[i - 1]!.id, caret: blocks[i - 1]!.text.length });
    }
    if (e.key === "ArrowDown" && el.selectionStart === el.value.length && i < blocks.length - 1) {
      e.preventDefault();
      setFocus({ id: blocks[i + 1]!.id, caret: 0 });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && b.type === "todo") {
      e.preventDefault();
      set(b.id, { checked: !b.checked });
    }
  }

  function drop(targetId: string) {
    if (!drag || drag.from === targetId) return setDrag(null);
    const from = blocks.find((b) => b.id === drag.from)!;
    const rest = blocks.filter((b) => b.id !== drag.from);
    const ti = rest.findIndex((b) => b.id === targetId);
    rest.splice(ti, 0, from);
    onChange(rest);
    setDrag(null);
  }

  // Running number for consecutive "numbered" blocks (resets on any other block type).
  const numbers: number[] = [];
  blocks.forEach((b, i) => {
    numbers.push(b.type === "numbered" ? (i > 0 ? numbers[i - 1]! : 0) + 1 : 0);
  });
  return (
    <NoteLinksContext.Provider value={noteLinks}>
      <div className="space-y-0.5 pb-24" onDragEnd={() => setDrag(null)}>
        {blocks.map((b, bi) => {
          const num = numbers[bi];
          const editing = focus?.id === b.id;
          const textCls = {
            p: "text-[15px] leading-relaxed",
            h1: "text-2xl font-semibold tracking-tight mt-3",
            h2: "text-xl font-semibold tracking-tight mt-2",
            h3: "text-base font-semibold mt-1",
            todo: "text-[15px]",
            bullet: "text-[15px]",
            numbered: "text-[15px]",
            quote: "text-[15px] italic text-muted-foreground",
            code: "font-mono text-sm",
            divider: "",
            query: "font-mono text-sm",
            embed: "font-mono text-sm",
          }[b.type];
          return (
            <div
              key={b.id}
              id={`b-${b.id}`}
              className={cn(
                "group relative flex items-start gap-1 rounded-md",
                drag?.over === b.id && drag.from !== b.id && "border-t-2 border-primary",
              )}
              onDragOver={(e) => {
                if (drag) {
                  e.preventDefault();
                  if (drag.over !== b.id) setDrag({ ...drag, over: b.id });
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(b.id);
              }}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/* eslint-disable-next-line no-restricted-syntax -- exception: drag handle (draggable menu trigger) */}
                  <button
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDrag({ from: b.id, over: null });
                    }}
                    type="button"
                    className="tap-target mt-1 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/50 opacity-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 pointer-coarse:md:opacity-100"
                    aria-label={t("noteBlockHandle")}
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuLabel className="text-xs">{t("noteTurnInto")}</DropdownMenuLabel>
                  <div className="grid grid-cols-2 gap-0.5 px-1 pb-1">
                    {BLOCK_TYPES.filter((bt) => bt.id !== "embed").map((bt) => (
                      <Button
                        key={bt.id}
                        variant="tertiary"
                        size="sm"
                        aria-pressed={b.type === bt.id}
                        onClick={() => set(b.id, { type: bt.id })}
                        className={cn(
                          "justify-start px-2 font-normal",
                          b.type === bt.id && "bg-accent",
                        )}
                      >
                        {blockLabel(bt.id)}
                      </Button>
                    ))}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      navigator.clipboard?.writeText(`((${b.id}))`);
                      toast.success(t("noteRefCopied"));
                    }}
                  >
                    <Copy /> {t("noteCopyRef")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => insertAfter(b.id, { id: newId(), type: "p", text: "" })}
                  >
                    <Plus /> {t("noteBlockBelow")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => move(b.id, -1)}>
                    <ArrowUp /> {t("noteMoveUp")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => move(b.id, 1)}>
                    <ArrowDown /> {t("noteMoveDown")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => remove(b.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 /> {t("noteDeleteBlock")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="relative min-w-0 flex-1">
                {b.type === "divider" ? (
                  // eslint-disable-next-line no-restricted-syntax -- exception: divider block, focusable row
                  <button
                    type="button"
                    className={cn("block w-full rounded-sm py-3", pressableFocus)}
                    onClick={() => setFocus({ id: b.id, caret: 0 })}
                    aria-label={t("noteDivider")}
                  >
                    <hr />
                  </button>
                ) : (
                  <div
                    className={cn(
                      "flex items-start gap-2",
                      b.type === "quote" && "border-l-2 border-primary/40 pl-3",
                      b.type === "code" && "rounded-lg bg-secondary/70 p-3",
                    )}
                  >
                    {b.type === "todo" && (
                      <input
                        type="checkbox"
                        checked={!!b.checked}
                        onChange={() => set(b.id, { checked: !b.checked })}
                        className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                        aria-label={t("noteCheck")}
                      />
                    )}
                    {b.type === "bullet" && (
                      <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" />
                    )}
                    {b.type === "numbered" && (
                      <span className="mt-0.5 w-5 shrink-0 text-right text-[15px] text-muted-foreground">
                        {num}.
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      {editing || (!b.text && b.type !== "query" && b.type !== "embed") ? (
                        <AutoTextarea
                          textareaRef={(el) => {
                            if (el) refs.current.set(b.id, el);
                            else refs.current.delete(b.id);
                          }}
                          value={b.text}
                          rows={1}
                          onFocus={(e) => {
                            if (focus?.id !== b.id)
                              setFocus({ id: b.id, caret: e.currentTarget.selectionStart });
                          }}
                          onBlur={() =>
                            setTimeout(
                              () =>
                                setFocus((f) =>
                                  f?.id === b.id &&
                                  document.activeElement !== refs.current.get(b.id)
                                    ? null
                                    : f,
                                ),
                              150,
                            )
                          }
                          onChange={(e) => onInput(b, e.currentTarget)}
                          onKeyDown={(e) => onKey(b, e)}
                          placeholder={
                            b.type === "query"
                              ? "TABLE rating FROM #buku WHERE rating > 4"
                              : b.type === "embed"
                                ? t("noteEmbedPlaceholder")
                                : blocks.length === 1
                                  ? t("noteStartWriting")
                                  : b.type === "p"
                                    ? ""
                                    : blockLabel(b.type)
                          }
                          className={cn(
                            "block w-full resize-none overflow-hidden bg-transparent py-0.5 outline-none placeholder:text-muted-foreground/60",
                            textCls,
                            b.type === "todo" && b.checked && "text-muted-foreground line-through",
                          )}
                        />
                      ) : (
                        <div
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("a,button,input")) return;
                            setFocus({ id: b.id, caret: b.text.length });
                          }}
                          className={cn(
                            "min-h-[1.6rem] cursor-text whitespace-pre-wrap break-words py-0.5",
                            textCls,
                            b.type === "query" || b.type === "embed" ? "font-sans text-[15px]" : "",
                            b.type === "todo" && b.checked && "text-muted-foreground line-through",
                          )}
                        >
                          {b.type === "query" ? (
                            <QueryView query={b.text} />
                          ) : b.type === "embed" ? (
                            <EmbedView id={b.text} index={index} />
                          ) : b.type === "code" ? (
                            b.text
                          ) : (
                            <InlineText text={b.text} index={index} />
                          )}
                        </div>
                      )}
                      {editing && b.type === "query" && (
                        <div className="mt-2">
                          <QueryView query={b.text} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {editing && menu && menuItems.length > 0 && (
                  <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
                    <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {menu.kind === "slash"
                        ? t("noteMenuBlocks")
                        : menu.kind === "wiki"
                          ? t("noteMenuLink")
                          : t("noteMenuRef")}
                    </p>
                    {menuItems.map((it, i) => (
                      // eslint-disable-next-line no-restricted-syntax -- exception: slash-menu option (combobox item, mouse-down)
                      <button
                        key={it.key + i}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const el = refs.current.get(b.id);
                          if (el) pick(b, el, it.key);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                          i === menu.index ? "bg-accent" : "hover:bg-accent/60",
                        )}
                      >
                        <span className="truncate">{it.label}</span>
                        <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                          {it.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <Button
          variant="tertiary"
          size="sm"
          className="ml-6 gap-1.5 px-1 text-muted-foreground"
          onClick={() => {
            const last = blocks[blocks.length - 1];
            if (last && !last.text && last.type === "p") setFocus({ id: last.id, caret: 0 });
            else {
              const nb: Block = { id: newId(), type: "p", text: "" };
              onChange([...blocks, nb]);
              setFocus({ id: nb.id, caret: 0 });
            }
          }}
        >
          <Plus /> {t("noteAddBlock")}
        </Button>
      </div>
    </NoteLinksContext.Provider>
  );
}

function EmbedView({ id, index }: { id: string; index: BlockIndex }) {
  const ref = index.get(id);
  const { t } = useI18n();
  if (!id) return <p className="text-sm text-muted-foreground">{t("noteEmbedPick")}</p>;
  if (!ref) return <p className="text-sm text-destructive">{t("noteEmbedMissing")}</p>;
  return (
    <div className="rounded-lg border-l-2 border-primary bg-accent/40 px-3 py-2">
      <div className="whitespace-pre-wrap">
        <InlineText text={ref.block.text} index={index} depth={1} />
      </div>
      <Link
        to="/notes/$noteId"
        params={{ noteId: ref.note.id }}
        hash={`b-${id}`}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
      >
        <Link2 className="h-3 w-3" /> {ref.note.title}
      </Link>
    </div>
  );
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * Textarea that grows with its content. It resizes only itself, and only when its own
 * value or styling changes, instead of the editor measuring every textarea after
 * every render (each measurement forces a synchronous layout).
 */
export function AutoTextarea({
  textareaRef,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const { value, className } = props;
  useLayoutEffect(() => {
    if (own.current) autosize(own.current);
  }, [value, className]);
  return (
    <textarea
      {...props}
      ref={(el) => {
        own.current = el;
        textareaRef?.(el);
      }}
    />
  );
}

# Accessibility

Second Brain should be usable by everyone, including people who rely on a keyboard, screen
reader, magnification, voice control or reduced motion. This document states our target, what
the code does today, the gaps we know about, and how we test.

## Target

**[WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA** for all authenticated pages and the
login page, in both light and dark themes, on desktop and mobile widths, and as an installed PWA.

We are **not yet fully conformant**. The [known gaps](#known-gaps) below are the main blockers.
New features must not add new gaps, and PRs that close existing ones are very welcome.

## Current state

This assessment comes from reading the source (components, styles and routes). It has not yet
been confirmed by a full manual audit with assistive technology.

### Foundations that work well

- **Accessible primitives.** Dialogs, sheets, popovers, dropdown menus, selects, tabs, switches,
  checkboxes, tooltips and similar widgets come from shadcn/ui on top of
  [Radix UI](https://www.radix-ui.com/) (`src/components/ui`). They provide focus trapping and
  restoration, `Escape` to close, arrow-key navigation, and correct ARIA roles and states.
- **Named dialogs.** The global task editor (`TaskDialogProvider`) and the mobile navigation sheet
  render a `DialogTitle` / `SheetTitle`, so screen readers announce what opened.
- **Mobile-first dialogs and sheets.** `src/components/ui/dialog.tsx` and `sheet.tsx` render a
  rounded card (an inset card for dialogs, a `rounded-t-2xl` bottom sheet) capped to the dynamic
  viewport minus the safe-area insets. The content scrolls between a sticky header (title and a
  44×44 px close button, labelled "Tutup" by default) and a sticky footer (actions). On phones the
  footer stacks full-width 44 px buttons with the primary action on top. The close button comes last
  in the DOM, so focus still starts in the first form field.
- **Back to top.** Every authenticated page and the landing page share
  `src/components/common/BackToTop.tsx`. It appears after one viewport of scrolling, is hidden from
  the tab order until then, scrolls instantly with `prefers-reduced-motion`, moves focus to
  `<main id="main">`, and sits above the mobile bottom bar and its capture button.
- **Landmarks.** The app shell (`src/routes/_authenticated.tsx`) uses `<aside>`, `<nav>` (desktop
  sidebar, mobile bottom bar and mobile menu) and a single `<main>`.
- **Language.** `<html lang="id">` by default, and `src/lib/preferences.tsx` updates
  `document.documentElement.lang` when the user switches to English.
- **Visible focus.** Buttons and form controls use `focus-visible:ring` styles with the `--ring`
  token.
- **Icon-only buttons are labelled.** About 46 `aria-label`s outside `components/ui` cover controls
  such as calendar previous/next, graph zoom, kanban "add in column", canvas delete and timeline
  controls.
- **Zoom allowed.** The viewport meta is `width=device-width, initial-scale=1` with no
  `maximum-scale` or `user-scalable=no`.
- **Keyboard shortcuts** for power users, defined once in `src/lib/shortcuts.ts` and listed in the
  `?` cheat-sheet: `Cmd/Ctrl+K` command palette (cmdk, accessible combobox; search plus actions,
  pages and actions for the selected item), `Q` quick task, and in the task list, kanban boards,
  Upcoming tab, Today page, timeline rows and notes `j`/`k` (arrows while focused), `h`/`l` between
  kanban columns (and between cards of a notes grid row, where `j`/`k` move a whole row for the
  column count of the current breakpoint), `Enter`/`o` open, `e` edit, `x` toggle done, `Esc`
  clear. In the calendar month/week grid the day cells use a roving tabindex: `h`/`j`/`k`/`l`
  (arrows while a cell is focused) move by a day or a week, `Enter` adds a task on that day, `t`
  jumps to today and `[`/`]` page to the previous/next period. The selection uses a roving
  tabindex (one tab stop per list), `aria-current` and a visible ring, and follows focus.
  Single-key shortcuts are ignored while a modifier key is held, while focus is in an input,
  textarea, select or contenteditable element, and while a dialog or menu is open, and they can
  be turned off (2.1.4 Character Key Shortcuts) with Settings → Tampilan → "Pintasan satu
  tombol" (stored per device): every one-character binding stops, while `Cmd/Ctrl+K` and the
  arrow/`Enter`/`Home`/`End`/`Esc` keys of a focused list or calendar grid keep working, and the
  cheat-sheet then lists only the bindings that still apply.
- **Keyboard drag and drop** (2.1.1, 2.5.7). Kanban boards (tasks, notes, projects) and calendar
  chips register dnd-kit's `KeyboardSensor` with a custom coordinate getter
  (`src/lib/dnd-a11y.ts`, used instead of `sortableKeyboardCoordinates` because
  `@dnd-kit/sortable` isn't installed): focus a card or chip, press `Space` to pick it up, use
  the arrow keys to jump to the next column (`←`/`→`) or day (`←`/`→` one day, `↑`/`↓` one
  week), then `Space` or `Enter` to drop or `Escape` to cancel. `Enter` on a card or chip that
  isn't being dragged opens it. The calendar chip's "change due date" handle is a separate
  draggable that works the same way. Screen readers get Indonesian instructions and
  live-region announcements (picked up / over column or date / dropped / cancelled) through
  dnd-kit's `accessibility` prop.
- **Keyboard timeline** (2.1.1, 2.5.7). Timeline bars are focusable buttons named
  "<task>, <date range>": `←`/`→` move the task a day, `Shift`+`←`/`→` change the due date,
  `Enter`/`Space` open the editor. A visible hint below the chart describes the keys and a
  polite live region announces the new range.
- **Alternative to drag and drop.** Every task can also be opened in the full editor, where
  status, dates, project and milestone can be changed with standard form controls.
- **Notes editor** blocks are native `<textarea>` elements, so typing, selection and screen
  reader editing behave natively.

### Color contrast

Theme tokens are defined in OKLCH in `src/styles.css` (`:root` and `.dark`). Phase 8.3 adjusted
the tokens that failed WCAG AA; computed ratios (alpha tints composited over `card`):

| Pair                                                         | Light     | Dark      | Result                                           |
| ------------------------------------------------------------ | --------- | --------- | ------------------------------------------------ |
| `foreground` on `background`                                 | 15.8:1    | 16.0:1    | Pass                                             |
| `muted-foreground` on `background` / `card`                  | 5.3:1     | 5.9:1     | Pass                                             |
| `muted-foreground` on `secondary`                            | 4.8:1     | 5.2:1     | Pass                                             |
| `primary-foreground` on `primary`                            | 6.8:1     | 7.5:1     | Pass                                             |
| `primary` on `background` (links, accents)                   | 6.9:1     | 7.7:1     | Pass                                             |
| `destructive-foreground` on `destructive`                    | 5.1:1     | 5.5:1     | Pass (dark was 3.3:1; foreground is now dark)    |
| `success` / `warning` as text on `card`                      | 5.7 / 4.8 | 5.5 / 7.5 | Pass (light warning was 2.7:1, success-fg 4.4:1) |
| `priority-high` / `priority-medium` badge (text on 15% tint) | 4.8 / 5.0 | 4.7 / 5.7 | Pass (light medium was 2.4:1)                    |
| project tone text on its 15% tint (7 tones)                  | ≥ 4.7     | ≥ 4.6     | Pass (light tones were 2.5–4.3:1)                |
| `primary-foreground` on solid tone (timeline bars)           | ≥ 5.4     | ≥ 6.3     | Pass (light amber/rose/green were 2.8–4.4:1)     |
| `input` (form-control border) on `background`                | 3.2:1     | 3.2:1     | Pass 1.4.11 non-text 3:1 (was 1.25 / 1.5)        |
| `border` on `background`                                     | 1.25:1    | 1.3:1     | Decorative separators only; controls use `input` |

The e2e suite runs axe `color-contrast` on `/` and `/login` in both themes (see Testing).
Reduced-opacity text such as `text-muted-foreground/60` placeholders and `opacity-50` /
`opacity-60` for completed tasks is still not covered and may fall below 4.5:1.

### Motion

`prefers-reduced-motion: reduce` is respected:

- A global rule at the end of `src/styles.css` shortens all CSS animations and transitions
  (tw-animate-css dialog/popover enter/exit, Tailwind `transition-*`) to ~0 ms and turns off
  smooth scrolling. Durations are near-zero rather than `none` so Radix still receives the
  `animationend` events it uses to unmount closed content.
- Decorative animation uses `motion-safe:` (landing mockups, the auth loading pulse, the tilted
  kanban drag overlay, subtask progress bar).
- The note graph (`/graph`) settles its d3-force layout synchronously (`sim.tick(n)`) and paints
  once instead of animating, and dragging a node moves only that node without re-heating the
  simulation (`usePrefersReducedMotion`, `src/hooks/use-reduced-motion.ts`).

## Known gaps

Ordered roughly by impact. Each item names the WCAG success criterion it relates to.

1. **Kanban card wrappers nest interactive content** (4.1.2). The draggable wrapper
   (`role="button"`, named after the card) contains clickable content such as project card links,
   so some cards have two tab stops. Flattening the card into one control would be cleaner.
2. **Timeline start-date resize is pointer only** (2.5.7). `Shift`+arrows change the due date; the
   start date can still be changed in the task editor.
3. **Graph view is not accessible** (1.1.1, 2.1.1). The note graph is an SVG of `<g>` nodes with
   pointer handlers only: no focusable nodes, no names, no text alternative. Provide a list of
   notes and links as an alternative and make nodes focusable with accessible names.
4. **Canvas boards** rely on pointer dragging to position cards (2.1.1, 2.5.7).
5. **Low-contrast states** such as faded completed tasks and placeholder text at 60% opacity
   (1.4.3). The calendar day "add" button is still hidden until hover, but now also appears on
   keyboard focus within the day.
6. **No skip link** to the main content (2.4.1). The sidebar has many links before `<main>`.
7. **Mixed-language UI.** Many strings and `aria-label`s are hard-coded in Indonesian and are not
   translated when English is selected (3.1.2 Language of Parts).
8. **Live updates aren't announced** (4.1.3 Status Messages). Toasts use Sonner, which has a live
   region, but realtime collaboration changes, AI processing progress and "load more" results are
   not announced.
9. **Focus outline on note blocks.** The block `<textarea>` uses `outline-none` without a
   replacement focus style, which relies on the caret alone (2.4.7, 2.4.11 Focus Not Obscured).
10. **Single-key shortcuts** (`Q`, `?`, `j`/`k`/`h`/`l`/`o`/`e`/`x`, calendar `t`/`[`/`]`; 2.1.4
    Character Key Shortcuts) can be turned off in Settings ("Pintasan satu tombol"), which meets
    2.1.4. Remaining gap: they cannot be remapped, and the setting is per device (localStorage),
    not per account.
11. **Target size** (2.5.8). Task check circles and switches have a 44 px hit area, segmented
    tabs are 44 px tall on phones, and dialog fields are 44 px tall below `sm`. The small icon
    buttons (calendar day "add", note block handle, project tree expander, canvas card and
    template delete) use the `tap-target` utility (`src/styles.css`): on coarse pointers an
    invisible `::after` grows the hit area to at least 44×44 px without changing the look, and
    the calendar "add" button and block handle stay visible there instead of appearing on hover.
    Mouse users keep the compact `h-7`/`p-0.5` buttons, which meet the 24×24 px minimum through
    the spacing exception. Use `tap-target` for new icon buttons smaller than 44 px (the `Button` sizes `sm`/`icon-sm` already include it as `tap-area`; `md`/`lg`/`icon` are 44 px tall on coarse pointers). Remaining
    gap: neighbouring touch hit areas can overlap in dense rows (e.g. the project tree), where
    the later element wins.

## Testing approach

### Automated

- **Component tests**: query by role and accessible name with Testing Library
  (`getByRole("button", { name: "…" })`). A component that can't be found that way is usually
  not accessible either.
- **Unit tests** for the keyboard drag-and-drop helpers (coordinate getter, column/day
  navigation, Indonesian announcements, timeline keys) are in `src/lib/dnd-a11y.test.ts`.
- **axe-core in CI**: `e2e/public.spec.ts` runs [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm)
  (WCAG 2.x A/AA tags) on `/` and `/login` in light and dark themes and fails on serious or
  critical violations (`.github/workflows/e2e.yml`, see
  [CONTRIBUTING.md](CONTRIBUTING.md#end-to-end-tests)). Authenticated pages aren't scanned yet;
  run the [axe DevTools](https://www.deque.com/axe/devtools/) extension on pages you change.
- **Lighthouse** accessibility audit as a quick smoke check (not a substitute for manual
  testing).

### Manual keyboard pass (every UI PR)

1. Unplug the mouse (or don't touch it). Start at the address bar and `Tab` through the page.
2. Every interactive element is reachable, in a logical order, with a clearly visible focus
   indicator that isn't hidden behind sticky headers or the mobile bottom bar.
3. Everything that works with a click works with `Enter` / `Space`; menus and lists work with
   arrow keys; `Escape` closes dialogs and popovers and focus returns to the trigger.
4. No keyboard traps.

### Screen readers

Test the flows you changed with at least one of:

- **VoiceOver** + Safari (macOS, iOS, including the installed PWA)
- **NVDA** + Firefox or Chrome (Windows)
- **TalkBack** + Chrome (Android)

Check that controls have meaningful names, that dialogs announce their title, and that state
changes (task completed, moved, deleted) are communicated.

### Visual

- Light and dark themes; 200% browser zoom; 320 CSS px width (1.4.10 Reflow);
  `prefers-reduced-motion: reduce`; forced colors / Windows High Contrast mode.
- Check contrast of any new color combination with a contrast checker. Use theme tokens rather
  than hard-coded colors.

## Contributor guidelines

- Prefer existing `src/components/ui` primitives over custom widgets.
- Use semantic elements (`<button>`, `<a>`, `<label>`, headings in order) before ARIA.
- Give icon-only buttons an `aria-label` (in the current UI language).
- Never remove focus outlines without providing a visible replacement.
- Anything that can be dragged must also be possible with the keyboard or through the task editor.
- Respect `prefers-reduced-motion` for new animations (`motion-safe:` / `motion-reduce:`).
- Don't convey information by color alone (priority, project, status): pair color with text or
  an icon.

## Reporting accessibility issues

Please open a [bug report](../../issues/new?template=bug_report.yml) and choose
**Accessibility** as the area. Include:

- The page and the action you were trying to perform.
- Your assistive technology, browser and operating system (for example NVDA 2026.x + Firefox on
  Windows 11).
- What happened and what you expected.

Accessibility bugs that block a core task (capturing, creating, completing or finding a task or
note) are treated as high priority.

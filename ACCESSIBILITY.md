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
- **Keyboard shortcuts** for power users: `Cmd/Ctrl+K` command menu (cmdk, accessible combobox)
  and `Q` for quick task. `Q` is ignored while a modifier key is held, while focus is in an input,
  textarea, select or contenteditable element, and while a dialog is open.
- **Alternative to drag and drop.** Every task can be opened in the full editor, where status,
  dates, project and milestone can be changed with standard form controls. This is the
  non-dragging alternative WCAG 2.5.7 asks for, as long as the card itself can be opened from the
  keyboard (see gaps).
- **Notes editor** blocks are native `<textarea>` elements, so typing, selection and screen
  reader editing behave natively.

### Color contrast

Theme tokens are defined in OKLCH in `src/styles.css` (`:root` and `.dark`). Computed contrast
ratios for the main pairs:

| Pair                                       | Light  | Dark      | AA (4.5:1 text)                                                      |
| ------------------------------------------ | ------ | --------- | -------------------------------------------------------------------- |
| `foreground` on `background`               | 15.8:1 | 16.0:1    | Pass                                                                 |
| `muted-foreground` on `background`         | 5.3:1  | 6.4:1     | Pass                                                                 |
| `muted-foreground` on `card`               | 5.5:1  | 5.9:1     | Pass                                                                 |
| `primary-foreground` on `primary`          | 6.8:1  | 7.5:1     | Pass                                                                 |
| `primary` on `background` (links, accents) | 6.9:1  | 7.7:1     | Pass                                                                 |
| `destructive-foreground` on `destructive`  | 5.1:1  | **3.3:1** | Light pass, **dark fails** for normal text                           |
| `border` on `background`                   | 1.25:1 | n/a       | Decorative only; fails 3:1 if used as the only boundary of a control |

Reduced-opacity text such as `text-muted-foreground/60` placeholders, `opacity-50` / `opacity-60`
for completed tasks and timeline bars, and project color tints on cards **is not covered by the
table** and is likely below 4.5:1 in places.

### Motion

Animations come from `tw-animate-css` (dialog and popover enter/exit) and Tailwind `transition-*`
utilities. Neither respects `prefers-reduced-motion` automatically, and the app does not add
`motion-reduce:` variants or a global reduced-motion rule yet. The graph view runs a d3-force
simulation that animates on load.

## Known gaps

Ordered roughly by impact. Each item names the WCAG success criterion it relates to.

1. **Kanban and calendar drag and drop are pointer and touch only** (2.1.1 Keyboard).
   `Kanban.tsx` and `calendar.tsx` register only `PointerSensor` and `TouchSensor`. Adding
   dnd-kit's `KeyboardSensor` (with `sortableKeyboardCoordinates` or custom coordinates) and
   screen-reader `announcements` would make moves keyboard-operable.
2. **Calendar task chips can't be opened from the keyboard** (2.1.1, 4.1.2). The chip is a `<div>`
   with dnd-kit attributes (`role="button"`, `tabIndex=0`) and an `onClick`, but no `Enter`/`Space`
   handler, so it receives focus but does nothing on activation. Kanban cards are wrapped in the
   same kind of focusable dnd-kit `<div>` (`DraggableCard`), which adds an extra, unnamed tab
   stop around each card.
3. **Timeline bars use raw pointer events only** (2.1.1, 2.5.7). Moving or resizing a bar needs a
   pointer. The row label button opens the task editor, which is the current alternative. A
   keyboard model (for example arrow keys to move, `Shift`+arrows to resize) is still missing.
4. **Graph view is not accessible** (1.1.1, 2.1.1). The note graph is an SVG of `<g>` nodes with
   pointer handlers only: no focusable nodes, no names, no text alternative. Provide a list of
   notes and links as an alternative and make nodes focusable with accessible names.
5. **Canvas boards** rely on pointer dragging to position cards (2.1.1, 2.5.7).
6. **No reduced-motion support** (2.3.3 Animation from Interactions, AAA, but expected by many
   users). Add a global `@media (prefers-reduced-motion: reduce)` rule and stop the graph
   simulation from animating.
7. **Destructive buttons in dark mode** have 3.3:1 contrast (1.4.3). Darken `--destructive` or
   change `--destructive-foreground` in `.dark`.
8. **Low-contrast states** such as faded completed tasks, placeholder text at 60% opacity, and
   hover-only "add" buttons in calendar days (`opacity-0 group-hover:opacity-100`, invisible
   until hover, but still focusable) (1.4.3, 1.4.11, 2.4.7).
9. **No skip link** to the main content (2.4.1). The sidebar has many links before `<main>`.
10. **Mixed-language UI.** Many strings and `aria-label`s are hard-coded in Indonesian and are not
    translated when English is selected (3.1.2 Language of Parts).
11. **Live updates aren't announced** (4.1.3 Status Messages). Toasts use Sonner, which has a live
    region, but realtime collaboration changes, AI processing progress and "load more" results are
    not announced.
12. **Focus outline on note blocks.** The block `<textarea>` uses `outline-none` without a
    replacement focus style, which relies on the caret alone (2.4.7, 2.4.11 Focus Not Obscured).
13. **Global `Q` shortcut** (2.1.4 Character Key Shortcuts) cannot be turned off or remapped. It is
    already suppressed in editable fields and dialogs, which limits accidental activation by
    speech-input users, but 2.1.4 also expects a way to disable or remap it.
14. **Target size** (2.5.8). Some icon buttons are `h-7 w-7` (28px) or smaller (for example
    `p-0.5` icon buttons in calendar cells), close to or below the 24×24 CSS px minimum when the
    spacing exception doesn't apply.

## Testing approach

### Automated

- **Component tests**: query by role and accessible name with Testing Library
  (`getByRole("button", { name: "…" })`). A component that can't be found that way is usually
  not accessible either.
- **axe-core**: we plan to add [`vitest-axe`](https://github.com/chaance/vitest-axe) /
  `jest-axe` checks to component tests, and `@axe-core/playwright` for end-to-end checks of the
  main pages in both themes. Until then, run the
  [axe DevTools](https://www.deque.com/axe/devtools/) browser extension on pages you change.
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

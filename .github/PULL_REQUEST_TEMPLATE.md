<!--
Thanks for contributing! Please read CONTRIBUTING.md first.
Use a Conventional Commit style title, e.g. "feat(tasks): add bulk archive".
-->

## Summary

<!-- What does this PR change, and why? -->

Closes #

## Type of change

- [ ] `feat` – new feature
- [ ] `fix` – bug fix
- [ ] `refactor` / `perf` – no behavior change / performance
- [ ] `docs` / `test` / `chore` / `ci`
- [ ] Breaking change (describe the migration path below)

## How to test

<!-- Steps a reviewer can follow. Include the view(s) affected: list, kanban, calendar, timeline, notes... -->

1.

## Screenshots / recordings

<!-- For UI changes: before/after, light and dark mode, mobile width if relevant. -->

## Checklist

- [ ] `bun run lint`, `bunx tsc --noEmit` and `bun run test` pass locally
- [ ] `bun run build` passes (required for routing, server function or config changes)
- [ ] Follows the architecture rules in `AGENTS.md` (data hooks in `src/lib/data.ts`, task edits via `TaskDialogProvider`/`useTaskActions`, `PageContainer`, soft delete, …)
- [ ] Database changes: new migration in `drizzle/migrations/` registered in `meta/_journal.json`, RLS enabled with policies + grants, `src/integrations/supabase/types.ts` regenerated
- [ ] No secrets, tokens or personal data in code, logs, fixtures or screenshots
- [ ] Server-only secrets stay in `*.server.ts` / server functions and are never exposed via `VITE_*`
- [ ] Accessibility considered: keyboard reachable, labelled controls, visible focus, sufficient contrast (see `ACCESSIBILITY.md`)
- [ ] UI strings added for both Indonesian and English where the i18n layer applies
- [ ] PR title follows Conventional Commits (it drives the version bump and `CHANGELOG.md`; don't edit the changelog by hand)
- [ ] Docs updated (`README.md`, `AGENTS.md` if an architecture rule changed)
- [ ] No force-push / history rewrite of commits already on `main` (keep published history intact)

## Notes for reviewers

<!-- Trade-offs, follow-ups, areas you want extra eyes on. -->

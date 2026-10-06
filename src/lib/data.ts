/**
 * Compatibility barrel. The data layer lives in `src/features/<entity>/{api,hooks,types}.ts`
 * (shared query keys, CRUD cache helpers, session and date helpers in `src/features/shared`).
 * Existing `@/lib/data` imports keep working; new code may import from the feature modules.
 */
export { qk } from "@/features/shared/query-keys";
export { getUid, meQuery, useMe } from "@/features/shared/session";
export { preloadQueries } from "@/features/shared/preload";
export { dateToIso, dayKey, isoToDate, shiftIso, taskRange } from "@/features/shared/dates";

export type { Task } from "@/features/tasks/types";
export { TASK_COLS, tasksQuery } from "@/features/tasks/api";
export { useTaskActions, useTasks } from "@/features/tasks/hooks";

export type { Person, Project } from "@/features/projects/types";
export { PROJECT_COLS, projectsQuery } from "@/features/projects/api";
export { usePeople, useProjectActions, useProjects } from "@/features/projects/hooks";

export type { Backlink, Note, NoteBlocks, NoteDetail, NoteSummary } from "@/features/notes/types";
export {
  NOTE_BLOCK_COLS,
  NOTE_DETAIL_COLS,
  NOTE_LIST_COLS,
  backlinksQuery,
  noteBlocksQuery,
  noteQuery,
  noteSearchQuery,
  notesQuery,
} from "@/features/notes/api";
export {
  useBacklinks,
  useNote,
  useNoteActions,
  useNoteBlocks,
  useNoteSearch,
  useNotes,
} from "@/features/notes/hooks";

export type { Milestone } from "@/features/milestones/types";
export { MILESTONE_COLS, milestonesQuery } from "@/features/milestones/api";
export { useMilestoneActions, useMilestones } from "@/features/milestones/hooks";

export type { Dependency } from "@/features/dependencies/types";
export { DEP_COLS, depsQuery, openBlockers } from "@/features/dependencies/api";
export { useDependencyActions, useDeps } from "@/features/dependencies/hooks";

export type { Automation } from "@/features/automations/types";
export { AUTOMATION_COLS, automationsQuery } from "@/features/automations/api";
export { useAutomationActions, useAutomations } from "@/features/automations/hooks";

export type { SearchHit, SearchResults, SemanticHit } from "@/features/search/hooks";
export { useSearch, useSemanticSearch, useSemanticStatus } from "@/features/search/hooks";

/**
 * TanStack Query keys for the shared entity caches. Every view (list, kanban, calendar,
 * timeline...) reads the same keys, so one optimistic update keeps them all in sync.
 */
export const qk = {
  tasks: ["tasks"] as const,
  projects: ["projects"] as const,
  notes: ["notes"] as const,
  note: (id: string) => ["notes", "detail", id] as const,
  noteBlocks: ["notes", "blocks"] as const,
  milestones: ["milestones"] as const,
  deps: ["deps"] as const,
  automations: ["automations"] as const,
  shares: ["shares"] as const,
};

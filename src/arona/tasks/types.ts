/**
 * arona/tasks/types.ts
 *
 * Types for Arona's chat-based task manager.
 * Tasks are lightweight todo items that Sensei can create, complete,
 * and manage through natural conversation.
 */

export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskStatus = "pending" | "done" | "cancelled";

export interface AronaTask {
  /** Unique task ID (monotonically increasing). */
  id: number;
  /** Task title / description. */
  title: string;
  /** Priority level. */
  priority: TaskPriority;
  /** Current status. */
  status: TaskStatus;
  /** ISO timestamp when the task was created. */
  createdAt: string;
  /** ISO timestamp when the task was completed/cancelled (if applicable). */
  completedAt?: string;
  /** Optional due date (ISO date string, e.g. "2026-04-08"). */
  dueDate?: string;
  /** Optional due time (HH:mm format, e.g. "14:30"). */
  dueTime?: string;
  /** Optional tags for categorization. */
  tags?: string[];
  /** Optional notes / extra context. */
  notes?: string;
}

export interface TaskStore {
  /** Auto-incrementing ID counter. */
  nextId: number;
  /** All tasks (active + completed). */
  tasks: AronaTask[];
}

/** Default empty store. */
export function createEmptyStore(): TaskStore {
  return { nextId: 1, tasks: [] };
}

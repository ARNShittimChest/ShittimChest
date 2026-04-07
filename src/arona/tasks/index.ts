/**
 * arona/tasks/index.ts
 *
 * Barrel export for Arona's task manager.
 */

export type { AronaTask, TaskPriority, TaskStatus, TaskStore } from "./types.js";
export {
  initTaskStore,
  addTask,
  completeTask,
  cancelTask,
  updateTask,
  deleteTask,
  getPendingTasks,
  getTasksDueToday,
  getOverdueTasks,
  getAllTasks,
  getTask,
  getPendingCount,
  buildTaskPromptContext,
} from "./task-store.js";
export type { AddTaskOptions } from "./task-store.js";

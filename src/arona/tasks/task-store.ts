/**
 * arona/tasks/task-store.ts
 *
 * Persistent task store for Arona's chat-based task manager.
 *
 * Storage: `.arona/tasks.json` (atomic write — tmp file + rename).
 * In-memory cache for fast reads; disk writes are synchronous and best-effort.
 *
 * This module is intentionally simple — it provides CRUD operations.
 * The LLM handles natural-language parsing ("remind me to send the report on Friday")
 * and calls these functions through the cron/tool system.
 */

import fs from "node:fs";
import path from "node:path";
import type { AronaTask, TaskPriority, TaskStore } from "./types.js";
import { createEmptyStore } from "./types.js";

// ── In-memory state ─────────────────────────────────────────────

let store: TaskStore | null = null;
let storePath: string | null = null;

// ── Persistence ─────────────────────────────────────────────────

function ensureLoaded(): TaskStore {
  if (store) return store;
  store = createEmptyStore();
  return store;
}

function saveToDisk(): void {
  if (!storePath || !store) return;
  try {
    const dir = path.dirname(storePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${storePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, storePath);
  } catch {
    // Best-effort — don't crash the server
  }
}

function loadFromDisk(): void {
  if (!storePath) return;
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw) as TaskStore;
    if (parsed && Array.isArray(parsed.tasks) && typeof parsed.nextId === "number") {
      store = parsed;
    }
  } catch {
    // File doesn't exist or is corrupt — start fresh
    store = createEmptyStore();
  }
}

// ── Initialization ──────────────────────────────────────────────

/**
 * Initialize the task store. Must be called once at startup.
 * Loads existing tasks from disk or creates an empty store.
 */
export function initTaskStore(workspaceDir: string): void {
  storePath = path.join(workspaceDir, ".arona", "tasks.json");
  loadFromDisk();
}

// ── CRUD Operations ─────────────────────────────────────────────

export interface AddTaskOptions {
  title: string;
  priority?: TaskPriority;
  dueDate?: string;
  dueTime?: string;
  tags?: string[];
  notes?: string;
}

/** Add a new task. Returns the created task. */
export function addTask(opts: AddTaskOptions): AronaTask {
  const s = ensureLoaded();
  const task: AronaTask = {
    id: s.nextId++,
    title: opts.title,
    priority: opts.priority ?? "normal",
    status: "pending",
    createdAt: new Date().toISOString(),
    dueDate: opts.dueDate,
    dueTime: opts.dueTime,
    tags: opts.tags,
    notes: opts.notes,
  };
  s.tasks.push(task);
  saveToDisk();
  return task;
}

/** Mark a task as done. Returns the updated task or null if not found. */
export function completeTask(taskId: number): AronaTask | null {
  const s = ensureLoaded();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "pending") return null;
  task.status = "done";
  task.completedAt = new Date().toISOString();
  saveToDisk();
  return task;
}

/** Cancel a task. Returns the updated task or null if not found. */
export function cancelTask(taskId: number): AronaTask | null {
  const s = ensureLoaded();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "pending") return null;
  task.status = "cancelled";
  task.completedAt = new Date().toISOString();
  saveToDisk();
  return task;
}

/** Update a task's fields. Returns updated task or null if not found. */
export function updateTask(
  taskId: number,
  updates: Partial<
    Pick<AronaTask, "title" | "priority" | "dueDate" | "dueTime" | "tags" | "notes">
  >,
): AronaTask | null {
  const s = ensureLoaded();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  if (updates.title !== undefined) task.title = updates.title;
  if (updates.priority !== undefined) task.priority = updates.priority;
  if (updates.dueDate !== undefined) task.dueDate = updates.dueDate;
  if (updates.dueTime !== undefined) task.dueTime = updates.dueTime;
  if (updates.tags !== undefined) task.tags = updates.tags;
  if (updates.notes !== undefined) task.notes = updates.notes;
  saveToDisk();
  return task;
}

/** Delete a task permanently. Returns true if found and deleted. */
export function deleteTask(taskId: number): boolean {
  const s = ensureLoaded();
  const idx = s.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return false;
  s.tasks.splice(idx, 1);
  saveToDisk();
  return true;
}

// ── Query Operations ────────────────────────────────────────────

/** Get all pending tasks, sorted by priority (urgent first) then by due date. */
export function getPendingTasks(): AronaTask[] {
  const s = ensureLoaded();
  const priorityOrder: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return s.tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      // Then by due date (tasks with due date first)
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return a.id - b.id;
    });
}

/** Get tasks due today. */
export function getTasksDueToday(): AronaTask[] {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  return getPendingTasks().filter((t) => t.dueDate === today);
}

/** Get overdue tasks (due before today, still pending). */
export function getOverdueTasks(): AronaTask[] {
  const today = new Date().toISOString().slice(0, 10);
  return getPendingTasks().filter((t) => t.dueDate && t.dueDate < today);
}

/** Get all tasks (including completed/cancelled). */
export function getAllTasks(): AronaTask[] {
  return ensureLoaded().tasks;
}

/** Get a single task by ID. */
export function getTask(taskId: number): AronaTask | null {
  return ensureLoaded().tasks.find((t) => t.id === taskId) ?? null;
}

/** Count pending tasks. */
export function getPendingCount(): number {
  return ensureLoaded().tasks.filter((t) => t.status === "pending").length;
}

// ── Prompt Context Builder ──────────────────────────────────────

/**
 * Build a concise task summary for injection into the system prompt.
 * Returns empty string if no pending tasks.
 *
 * Example output:
 * ```
 * [Sensei's Tasks]
 * 📋 3 pending tasks (1 overdue, 1 due today)
 *
 * ⚠️ Overdue:
 * - #2 [high] Send weekly report (due: 2026-04-06)
 *
 * 📅 Due today:
 * - #5 Team meeting at 14:30
 *
 * 📝 Upcoming:
 * - #3 Buy birthday gift (due: 2026-04-10)
 * - #4 Review PR backend
 * ```
 */
export function buildTaskPromptContext(): string {
  const pending = getPendingTasks();
  if (pending.length === 0) return "";

  const today = new Date().toISOString().slice(0, 10);
  const overdue = pending.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = pending.filter((t) => t.dueDate === today);
  const upcoming = pending.filter((t) => !t.dueDate || t.dueDate > today);

  const lines: string[] = ["[Sensei's Tasks]"];

  // Summary line
  const parts: string[] = [`${pending.length} pending task${pending.length > 1 ? "s" : ""}`];
  if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
  if (dueToday.length > 0) parts.push(`${dueToday.length} due today`);
  lines.push(`📋 ${parts.join(", ")}`);
  lines.push("");

  const formatTask = (t: AronaTask): string => {
    const priorityMark = t.priority === "urgent" ? "🔴" : t.priority === "high" ? "🟠" : "";
    const pLabel = priorityMark ? `${priorityMark} ` : "";
    const due = t.dueDate ? ` (due: ${t.dueDate}${t.dueTime ? " " + t.dueTime : ""})` : "";
    return `- #${t.id} ${pLabel}${t.title}${due}`;
  };

  if (overdue.length > 0) {
    lines.push("⚠️ Overdue:");
    overdue.forEach((t) => lines.push(formatTask(t)));
    lines.push("");
  }

  if (dueToday.length > 0) {
    lines.push("📅 Due today:");
    dueToday.forEach((t) => lines.push(formatTask(t)));
    lines.push("");
  }

  // Show max 5 upcoming tasks to keep prompt compact
  if (upcoming.length > 0) {
    lines.push("📝 Upcoming:");
    upcoming.slice(0, 5).forEach((t) => lines.push(formatTask(t)));
    if (upcoming.length > 5) {
      lines.push(`  ... and ${upcoming.length - 5} more`);
    }
    lines.push("");
  }

  lines.push(
    "Arona can help manage tasks: add, complete (#id), cancel, or list tasks through chat.",
  );

  return lines.join("\n");
}

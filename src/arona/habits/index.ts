/**
 * arona/habits/index.ts
 *
 * Barrel export for the User Habit Learning System.
 */

export * from "./types.js";
export { HabitTracker, getHabitTracker } from "./habit-tracker.js";
export {
  applyScheduleToSubsystems,
  setSubsystemHandles,
  type SubsystemHandles,
} from "./schedule-applicator.js";

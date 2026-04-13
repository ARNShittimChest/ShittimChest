/**
 * arona/habits/types.ts
 *
 * Type definitions for the User Habit Learning System.
 *
 * Arona learns Sensei's sleep/wake cycle from chat activity patterns
 * and adjusts health reminders, proactive messages, and dreaming timing
 * to match their actual routine.
 *
 * Priority chain: explicit user override > learned pattern > defaults.
 */

// ── Activity Recording ──────────────────────────────────────────

/** A single activity record — when Sensei sent a message. */
export interface ActivityRecord {
  /** Unix timestamp ms. */
  timestampMs: number;
  /** Hour of day 0-23 (pre-computed for fast histogram building). */
  hour: number;
}

// ── Learned Schedule ────────────────────────────────────────────

/** Schedule detected by the Longest Quiet Gap algorithm. */
export interface LearnedSchedule {
  /** Detected wake hour (e.g., 7.5 = 7:30 AM). */
  wakeHour: number;
  /** Detected sleep hour (e.g., 23.5 = 11:30 PM). */
  sleepHour: number;
  /** Confidence 0–1 (based on data quantity + clarity + consistency). */
  confidence: number;
  /** ISO timestamp of last analysis run. */
  lastAnalyzedAt: string;
  /** Number of distinct days of data used in the analysis. */
  dataPointDays: number;
}

// ── Explicit Override ───────────────────────────────────────────

/** User-specified schedule override (highest priority). */
export interface ExplicitSchedule {
  /** Wake hour (0–23). Undefined = not overridden. */
  wakeHour?: number;
  /** Sleep hour (0–23). Undefined = not overridden. */
  sleepHour?: number;
  /** ISO timestamp when user set this override. */
  setAt: string;
  /** What user said (for audit/debug). */
  reason: string;
}

// ── Persisted State ─────────────────────────────────────────────

/** Persisted state in `.arona/user-habits.json`. */
export interface HabitData {
  /** Rolling 14-day activity log (older entries auto-pruned). */
  recentActivity: ActivityRecord[];
  /** Longest Quiet Gap algorithm output. */
  learned: LearnedSchedule | null;
  /** User-specified overrides (highest priority). */
  explicit: ExplicitSchedule | null;
  /** Schema version for future migration. */
  version: 1;
}

// ── Resolved Schedule ───────────────────────────────────────────

/** The final answer used by all subsystems after applying the priority chain. */
export interface ResolvedSchedule {
  /** Wake hour (0–23, decimal). Default: 7. */
  wakeHour: number;
  /** Sleep hour (0–23, decimal). Default: 23. */
  sleepHour: number;
  /** Which source determined these values. */
  source: "explicit" | "learned" | "default";
  /** 1.0 for explicit, algorithm confidence for learned, 0 for default. */
  confidence: number;
}

// ── Defaults ────────────────────────────────────────────────────

/** Default schedule — matches current hardcoded values across all subsystems. */
export const DEFAULT_SCHEDULE: Readonly<ResolvedSchedule> = {
  wakeHour: 7,
  sleepHour: 23,
  source: "default",
  confidence: 0,
};

/** How many days of activity data to keep (rolling window). */
export const ACTIVITY_RETENTION_DAYS = 14;

/** Minimum quiet gap hours to count as "sleep". */
export const MIN_SLEEP_GAP_HOURS = 4;

/** Minimum confidence to use learned schedule over defaults. */
export const MIN_LEARNED_CONFIDENCE = 0.5;

/** Minimum hour change to apply a new learned schedule (hysteresis). */
export const HYSTERESIS_HOURS = 1;

/** Minimum confidence improvement to force a schedule update despite hysteresis. */
export const HYSTERESIS_CONFIDENCE_DELTA = 0.15;

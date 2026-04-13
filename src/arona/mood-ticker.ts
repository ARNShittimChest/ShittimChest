/**
 * arona/mood-ticker.ts
 *
 * Autonomous background mood ticker for Arona companion.
 *
 * Periodically (every 15 minutes) evaluates environmental context
 * — time of day, weather, user absence — and updates the emotional
 * state WITHOUT requiring a chat message.
 *
 * This makes Arona feel "alive": her mood shifts organically based on
 * the passage of time and environmental changes, not just when the user
 * talks to her.
 */

import type { EmotionalState, Mood, MoodTrigger } from "../companion/emotional-state.js";
import { applyTrigger, decayMood } from "../companion/emotional-state.js";
import { loadOrCreateMoodState, saveMoodState } from "../companion/mood-persistence.js";
import { getWeatherData } from "./weather/weather-store.js";
import { analyzeWeatherMoodTrigger } from "./weather/weather-mood.js";

// ── Constants ────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const INITIAL_DELAY_MS = 30_000; // 30s — wait for weather + location to load

// Absence thresholds (no chat messages)
const ABSENCE_MILD_MS = 3 * 60 * 60 * 1000; // 3 hours → mild loneliness
const ABSENCE_HEAVY_MS = 8 * 60 * 60 * 1000; // 8 hours → deeper sadness/worried
const ABSENCE_MAX_MS = 24 * 60 * 60 * 1000; // 24 hours → cap the absence effect

// ── Types ────────────────────────────────────────────────────────

export interface MoodTickerOptions {
  /** Workspace directory for mood persistence. */
  workspaceDir: string;
  /** Called after each mood tick with the updated state. */
  onMoodUpdate?: (state: EmotionalState, triggers: MoodTrigger[]) => void;
  /** Function that returns the timestamp (ms) of the last user message. */
  getLastInteractionMs?: () => number | null;
}

export interface MoodTickerHandle {
  /** Stop the ticker and clean up timers. */
  stop: () => void;
  /** Force an immediate tick (e.g., after weather change). */
  tick: () => void;
}

// ── Time-of-day mood analysis ────────────────────────────────────

// Schedule-relative offsets (updated by habit learning)
let scheduleWakeHour = 7;
let scheduleSleepHour = 23;

/**
 * Update the schedule hours used by the mood ticker to shift time mode boundaries.
 * Call this after learning a new user schedule.
 */
export function setScheduleHours(wakeHour: number, sleepHour: number): void {
  scheduleWakeHour = wakeHour;
  scheduleSleepHour = sleepHour;
}

type TimeMode =
  | "early-morning" // around wake -1h to wake
  | "morning" // wake to wake+3
  | "midday" // wake+3 to wake+6
  | "afternoon" // wake+6 to wake+9
  | "late-afternoon" // wake+9 to wake+12
  | "evening" // sleep-5 to sleep-2
  | "night" // sleep-2 to sleep
  | "late-night" // sleep to sleep+3
  | "deep-night"; // sleep+3 to wake-1

/**
 * Determine the time mode relative to the user's schedule.
 *
 * Uses wake and sleep hours to scale the daytime modes proportionally.
 * Night modes are anchored around sleep time.
 */
function getTimeMode(hour: number): TimeMode {
  const wake = Math.round(scheduleWakeHour);
  const sleep = Math.round(scheduleSleepHour);

  // Calculate hours relative to wake time (handling wrap-around)
  const hoursAfterWake = (hour - wake + 24) % 24;
  const hoursBeforeSleep = (sleep - hour + 24) % 24;
  const hoursAfterSleep = (hour - sleep + 24) % 24;

  // Night modes (anchored to sleep time)
  // Late-night: sleep to sleep+3
  if (hoursAfterSleep >= 0 && hoursAfterSleep < 3) {
    // But only if we're NOT in the waking period
    if (hoursAfterWake > 20 || hoursAfterWake < 1) {
      return "late-night";
    }
  }

  // Deep-night: sleep+3 to wake-1
  if (hoursAfterSleep >= 3 && hoursAfterWake > 1) {
    // Only applies in the sleeping period
    const awakeDuration = (sleep - wake + 24) % 24;
    if (hoursAfterWake >= awakeDuration) {
      return "deep-night";
    }
  }

  // Early morning: wake-1 to wake
  if (hoursAfterWake >= 23 || hoursAfterWake === 0) {
    if (hoursAfterWake >= 23) return "early-morning";
  }

  // Daytime modes — scale proportionally across waking hours
  const awakeDuration = (sleep - wake + 24) % 24;

  if (hoursAfterWake < 0 || hoursAfterWake >= awakeDuration) {
    // Outside waking hours
    if (hoursAfterSleep < 3) return "late-night";
    return "deep-night";
  }

  // Map waking hours to daytime modes proportionally
  const dayProgress = hoursAfterWake / awakeDuration;

  if (dayProgress < 0.05) return "early-morning"; // First ~5% — just woke up
  if (dayProgress < 0.2) return "morning"; // 5-20%
  if (dayProgress < 0.38) return "midday"; // 20-38%
  if (dayProgress < 0.55) return "afternoon"; // 38-55%
  if (dayProgress < 0.7) return "late-afternoon"; // 55-70%
  if (dayProgress < 0.85) return "evening"; // 70-85%
  return "night"; // 85-100% — approaching sleep
}

function analyzeTimeMood(hour: number): MoodTrigger | null {
  const mode = getTimeMode(hour);

  const timeMoodMap: Partial<
    Record<TimeMode, { delta: Partial<Record<Mood, number>>; source: string }>
  > = {
    "early-morning": {
      delta: { sleepy: 0.35, caring: 0.1 },
      source: "time-early-morning",
    },
    morning: {
      delta: { happy: 0.2, excited: 0.1, curious: 0.05 },
      source: "time-morning",
    },
    midday: {
      delta: { focused: 0.15, neutral: 0.1 },
      source: "time-midday",
    },
    afternoon: {
      delta: { focused: 0.1, bored: 0.05, caring: 0.05 },
      source: "time-afternoon",
    },
    evening: {
      delta: { caring: 0.2, nostalgic: 0.1, neutral: 0.05 },
      source: "time-evening",
    },
    night: {
      delta: { sleepy: 0.2, caring: 0.15, nostalgic: 0.05 },
      source: "time-night",
    },
    "late-night": {
      delta: { sleepy: 0.4, worried: 0.15 },
      source: "time-late-night",
    },
    "deep-night": {
      delta: { sleepy: 0.5, worried: 0.1 },
      source: "time-deep-night",
    },
  };

  const rule = timeMoodMap[mode];
  if (!rule) return null;

  return {
    type: "time",
    source: rule.source,
    delta: rule.delta,
  };
}

// ── Absence analysis ─────────────────────────────────────────────

function analyzeAbsenceMood(lastInteractionMs: number | null): MoodTrigger | null {
  if (lastInteractionMs === null) return null;

  const elapsed = Date.now() - lastInteractionMs;
  if (elapsed < ABSENCE_MILD_MS) return null;

  // Scale factor: 0 at MILD threshold, 1 at MAX threshold
  const factor = Math.min(1, (elapsed - ABSENCE_MILD_MS) / (ABSENCE_MAX_MS - ABSENCE_MILD_MS));

  if (elapsed >= ABSENCE_HEAVY_MS) {
    return {
      type: "absence",
      source: "absence-heavy",
      delta: {
        sad: 0.2 + factor * 0.2, // 0.2 → 0.4
        worried: 0.1 + factor * 0.15, // 0.1 → 0.25
        caring: 0.15, // caring stays constant — Arona still wants to care
      },
    };
  }

  // Mild absence (3-8 hours)
  return {
    type: "absence",
    source: "absence-mild",
    delta: {
      bored: 0.15 + factor * 0.1,
      caring: 0.1 + factor * 0.1,
      sad: 0.05 + factor * 0.05,
    },
  };
}

// ── Core tick ────────────────────────────────────────────────────

export function runMoodTick(opts: MoodTickerOptions, nowMs?: number): void {
  const now = nowMs ?? Date.now();
  const hour = new Date(now).getHours();

  // Load current state and apply natural decay first
  let state = loadOrCreateMoodState(opts.workspaceDir);
  state = decayMood(state, now);

  const appliedTriggers: MoodTrigger[] = [];

  // 1. Time-of-day trigger
  const timeTrigger = analyzeTimeMood(hour);
  if (timeTrigger) {
    state = applyTrigger(state, timeTrigger);
    appliedTriggers.push(timeTrigger);
  }

  // 2. Weather trigger (if weather data is available)
  const weather = getWeatherData();
  if (weather) {
    const weatherTrigger = analyzeWeatherMoodTrigger(weather);
    if (weatherTrigger) {
      state = applyTrigger(state, weatherTrigger);
      appliedTriggers.push(weatherTrigger);
    }
  }

  // 3. Absence trigger (if we know last interaction time)
  const lastInteraction = opts.getLastInteractionMs?.() ?? null;
  const absenceTrigger = analyzeAbsenceMood(lastInteraction);
  if (absenceTrigger) {
    state = applyTrigger(state, absenceTrigger);
    appliedTriggers.push(absenceTrigger);
  }

  // Persist updated state
  saveMoodState(opts.workspaceDir, state);

  // Notify caller
  if (appliedTriggers.length > 0) {
    opts.onMoodUpdate?.(state, appliedTriggers);
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Start the autonomous mood ticker.
 *
 * Ticks every 15 minutes, evaluating environmental data and updating
 * mood state. The first tick fires after a 30-second delay to allow
 * other subsystems (weather, location) to initialize.
 *
 * @returns Handle with `stop()` to clean up and `tick()` to force evaluation.
 */
export function startMoodTicker(opts: MoodTickerOptions): MoodTickerHandle {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let initialTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const safeTick = () => {
    try {
      runMoodTick(opts);
    } catch {
      // Mood ticker should never crash the server
    }
  };

  // Initial tick after delay
  initialTimeoutId = setTimeout(() => {
    if (stopped) return;
    initialTimeoutId = null;
    safeTick();

    // Then schedule periodic ticks
    intervalId = setInterval(() => {
      if (stopped) return;
      safeTick();
    }, TICK_INTERVAL_MS);
    // Allow process to exit even if mood ticker is still scheduled.
    intervalId.unref();
  }, INITIAL_DELAY_MS);
  // Allow process to exit even if initial timeout is pending.
  initialTimeoutId.unref();

  return {
    stop() {
      stopped = true;
      if (initialTimeoutId !== null) {
        clearTimeout(initialTimeoutId);
        initialTimeoutId = null;
      }
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    tick() {
      if (stopped) return;
      safeTick();
    },
  };
}

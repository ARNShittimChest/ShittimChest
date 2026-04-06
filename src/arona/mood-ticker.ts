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

type TimeMode =
  | "early-morning" // 4-6
  | "morning" // 6-9
  | "midday" // 9-12
  | "afternoon" // 12-15
  | "late-afternoon" // 15-18
  | "evening" // 18-21
  | "night" // 21-23
  | "late-night" // 23-2
  | "deep-night"; // 2-4

function getTimeMode(hour: number): TimeMode {
  if (hour >= 4 && hour < 6) return "early-morning";
  if (hour >= 6 && hour < 9) return "morning";
  if (hour >= 9 && hour < 12) return "midday";
  if (hour >= 12 && hour < 15) return "afternoon";
  if (hour >= 15 && hour < 18) return "late-afternoon";
  if (hour >= 18 && hour < 21) return "evening";
  if (hour >= 21 && hour < 23) return "night";
  if (hour >= 23 || hour < 2) return "late-night";
  return "deep-night"; // 2-4
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
      delta: { happy: 0.2, excited: 0.1 },
      source: "time-morning",
    },
    midday: {
      delta: { neutral: 0.15 },
      source: "time-midday",
    },
    afternoon: {
      delta: { neutral: 0.1, caring: 0.05 },
      source: "time-afternoon",
    },
    evening: {
      delta: { caring: 0.2, neutral: 0.1 },
      source: "time-evening",
    },
    night: {
      delta: { sleepy: 0.2, caring: 0.15 },
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
      caring: 0.15 + factor * 0.1,
      sad: 0.05 + factor * 0.1,
    },
  };
}

// ── Core tick ────────────────────────────────────────────────────

function runMoodTick(opts: MoodTickerOptions): void {
  const now = Date.now();
  const hour = new Date().getHours();

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
  }, INITIAL_DELAY_MS);

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

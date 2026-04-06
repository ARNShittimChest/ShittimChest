/**
 * Weather scheduler — periodically fetches weather and applies mood triggers.
 *
 * Runs every 30 minutes in the background:
 * 1. Gets current GPS location from location store
 * 2. Refreshes weather data if stale
 * 3. Analyzes weather → generates mood trigger
 * 4. Calls the mood callback so the companion engine can apply the trigger
 *
 * Initial fetch is delayed 5s to allow location to load from disk on startup.
 */

import type { MoodTrigger } from "../../companion/emotional-state.js";
import { getUserLocation } from "../location-store.js";
import { refreshWeatherIfNeeded, getWeatherData } from "./weather-store.js";
import { analyzeWeatherMoodTrigger } from "./weather-mood.js";

// ── Constants ─────────────────────────────────────────────────────

const SCHEDULER_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const INITIAL_DELAY_MS = 5_000; // 5 seconds — wait for location to load

// ── Types ─────────────────────────────────────────────────────────

export interface WeatherSchedulerOptions {
  /**
   * Callback invoked when weather produces a mood trigger.
   * The caller should apply this trigger to the emotional state engine.
   */
  onMoodTrigger?: (trigger: MoodTrigger) => void;

  /**
   * Callback invoked after each successful weather fetch.
   * Useful for logging or updating UI.
   */
  onWeatherUpdate?: () => void;
}

export interface WeatherSchedulerHandle {
  /** Stop the scheduler and clean up timers. */
  stop: () => void;
}

// ── Core ──────────────────────────────────────────────────────────

async function runWeatherTick(opts: WeatherSchedulerOptions): Promise<void> {
  const location = getUserLocation();
  if (!location) return; // No GPS fix yet — skip

  const weather = await refreshWeatherIfNeeded(location.lat, location.lon);
  if (!weather) return; // Both APIs failed — skip

  // Update location name on weather data if geocoded place is available
  if (location.place) {
    weather.locationName = location.place.displayName;
  }

  opts.onWeatherUpdate?.();

  // Generate and emit mood trigger
  const trigger = analyzeWeatherMoodTrigger(weather);
  if (trigger) {
    opts.onMoodTrigger?.(trigger);
  }
}

/**
 * Start the weather scheduler.
 *
 * @returns Handle with `stop()` method to clean up timers.
 */
export function startWeatherScheduler(opts: WeatherSchedulerOptions = {}): WeatherSchedulerHandle {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let initialTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  // Initial fetch after short delay
  initialTimeoutId = setTimeout(() => {
    if (stopped) return;
    initialTimeoutId = null;
    void runWeatherTick(opts);

    // Then schedule periodic refreshes
    intervalId = setInterval(() => {
      if (stopped) return;
      void runWeatherTick(opts);
    }, SCHEDULER_INTERVAL_MS);
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
  };
}

/**
 * Manually trigger a weather check (e.g., after location update).
 * Does NOT reset the scheduler interval.
 */
export async function triggerWeatherCheck(opts: WeatherSchedulerOptions = {}): Promise<void> {
  await runWeatherTick(opts);
}

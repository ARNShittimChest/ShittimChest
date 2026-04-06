/**
 * Weather module — Arona Weather Core Feature.
 *
 * Re-exports all weather functionality for convenient imports.
 */

// Types
export type {
  WeatherCategory,
  WeatherCondition,
  CurrentWeather,
  DailyForecast,
  WeatherData,
} from "./types.js";

// WMO code lookup
export { lookupWmoCode, categorizeWeather } from "./wmo-codes.js";

// Fetcher
export { fetchWeather, fetchFromWttrIn, fetchFromOpenMeteo } from "./fetcher.js";

// Store
export {
  getWeatherData,
  isWeatherStale,
  refreshWeatherIfNeeded,
  forceRefreshWeather,
  setWeatherData,
} from "./weather-store.js";

// Weather → Mood
export {
  analyzeWeatherMoodTrigger,
  buildWeatherPromptContext,
  buildWeatherShortSummary,
} from "./weather-mood.js";

// Scheduler
export { startWeatherScheduler, triggerWeatherCheck } from "./weather-scheduler.js";
export type { WeatherSchedulerOptions, WeatherSchedulerHandle } from "./weather-scheduler.js";

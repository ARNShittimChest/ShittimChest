/**
 * Weather data store with in-memory caching.
 *
 * Caches weather data for 30 minutes to avoid excessive API calls.
 * Deduplicates concurrent fetch requests.
 * Provides sync getters for system prompt injection.
 */

import type { WeatherData } from "./types.js";
import { fetchWeather } from "./fetcher.js";

// ── Constants ─────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour — data too old to use

// ── Module-level state ────────────────────────────────────────────

let cachedWeather: WeatherData | null = null;

/** In-flight fetch promise for deduplication. */
let pendingFetch: Promise<WeatherData | null> | null = null;

// ── Public API ────────────────────────────────────────────────────

/**
 * Get the currently cached weather data (sync).
 * Returns null if no data is cached or data is stale (>1h old).
 * Used by system prompt builder for zero-latency injection.
 */
export function getWeatherData(): WeatherData | null {
  if (!cachedWeather) return null;
  if (Date.now() - cachedWeather.fetchedAt > STALE_THRESHOLD_MS) return null;
  return cachedWeather;
}

/**
 * Check if cached weather needs refreshing.
 */
export function isWeatherStale(): boolean {
  if (!cachedWeather) return true;
  return Date.now() - cachedWeather.fetchedAt > CACHE_TTL_MS;
}

/**
 * Refresh weather data if the cache is stale.
 * Deduplicates concurrent calls — if a fetch is already in progress,
 * returns the same promise.
 *
 * @returns Fresh weather data, or null on failure
 */
export async function refreshWeatherIfNeeded(
  lat: number,
  lon: number,
): Promise<WeatherData | null> {
  // Cache hit — still fresh
  if (!isWeatherStale()) {
    return cachedWeather;
  }

  // Deduplicate concurrent fetches
  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = (async () => {
    try {
      const data = await fetchWeather(lat, lon);
      if (data) {
        cachedWeather = data;
      }
      return data;
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

/**
 * Force refresh weather data, bypassing cache TTL.
 * Used when location changes significantly or user explicitly requests weather.
 */
export async function forceRefreshWeather(lat: number, lon: number): Promise<WeatherData | null> {
  // Clear cache to force re-fetch
  cachedWeather = null;
  return refreshWeatherIfNeeded(lat, lon);
}

/**
 * Set weather data directly (useful for testing or pre-seeding).
 */
export function setWeatherData(data: WeatherData | null): void {
  cachedWeather = data;
}

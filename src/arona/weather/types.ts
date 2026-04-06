/**
 * Weather data types for Arona weather core feature.
 *
 * Shared type definitions used across weather fetcher, store, mood integration,
 * and system prompt injection.
 */

// ── Weather condition categories ──────────────────────────────────

/**
 * High-level weather categories used for mood mapping and prompt context.
 * Derived from WMO codes + temperature analysis.
 */
export type WeatherCategory =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm"
  | "extreme-hot"
  | "extreme-cold"
  | "pleasant";

// ── Weather condition info ────────────────────────────────────────

export interface WeatherCondition {
  /** WMO weather code (0–99) or synthetic code */
  code: number;
  /** Human-readable description (English) */
  description: string;
  /** Emoji representation */
  emoji: string;
  /** High-level category for mood mapping */
  category: WeatherCategory;
}

// ── Current weather snapshot ──────────────────────────────────────

export interface CurrentWeather {
  /** Temperature in Celsius */
  temperatureC: number;
  /** Feels-like / apparent temperature in Celsius */
  feelsLikeC: number;
  /** Relative humidity (0–100%) */
  humidity: number;
  /** Wind speed in km/h */
  windSpeedKmh: number;
  /** Weather condition details */
  condition: WeatherCondition;
  /** Observation time (ISO string or Date) */
  observedAt: string;
}

// ── Daily forecast ────────────────────────────────────────────────

export interface DailyForecast {
  /** Date string (YYYY-MM-DD) */
  date: string;
  /** Max temperature in Celsius */
  maxTempC: number;
  /** Min temperature in Celsius */
  minTempC: number;
  /** Dominant weather condition for the day */
  condition: WeatherCondition;
}

// ── Combined weather data ─────────────────────────────────────────

export interface WeatherData {
  /** Current conditions */
  current: CurrentWeather;
  /** Daily forecasts (today + next 2 days) */
  forecast: DailyForecast[];
  /** Location name (from geocoding, if available) */
  locationName?: string;
  /** When this data was fetched */
  fetchedAt: number;
  /** Data source ("wttr.in" | "open-meteo") */
  source: string;
}

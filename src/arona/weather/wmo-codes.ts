/**
 * WMO Weather Interpretation Codes (WW 0–99) mapping.
 *
 * Maps standard WMO codes used by Open-Meteo to human-readable
 * descriptions, emojis, and weather categories for mood analysis.
 *
 * Reference: https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM
 */

import type { WeatherCategory, WeatherCondition } from "./types.js";

// ── WMO code table ────────────────────────────────────────────────

interface WmoEntry {
  description: string;
  emoji: string;
  category: WeatherCategory;
}

const WMO_TABLE: Record<number, WmoEntry> = {
  // Clear
  0: { description: "Clear sky", emoji: "☀️", category: "clear" },
  1: { description: "Mainly clear", emoji: "🌤️", category: "clear" },
  2: { description: "Partly cloudy", emoji: "⛅", category: "partly-cloudy" },
  3: { description: "Overcast", emoji: "☁️", category: "cloudy" },

  // Fog
  45: { description: "Foggy", emoji: "🌫️", category: "fog" },
  48: { description: "Depositing rime fog", emoji: "🌫️", category: "fog" },

  // Drizzle
  51: { description: "Light drizzle", emoji: "🌦️", category: "drizzle" },
  53: { description: "Moderate drizzle", emoji: "🌦️", category: "drizzle" },
  55: { description: "Dense drizzle", emoji: "🌧️", category: "drizzle" },

  // Freezing drizzle
  56: { description: "Light freezing drizzle", emoji: "🌧️", category: "drizzle" },
  57: { description: "Dense freezing drizzle", emoji: "🌧️", category: "drizzle" },

  // Rain
  61: { description: "Slight rain", emoji: "🌧️", category: "rain" },
  63: { description: "Moderate rain", emoji: "🌧️", category: "rain" },
  65: { description: "Heavy rain", emoji: "🌧️", category: "rain" },

  // Freezing rain
  66: { description: "Light freezing rain", emoji: "🌧️", category: "rain" },
  67: { description: "Heavy freezing rain", emoji: "🌧️", category: "rain" },

  // Snowfall
  71: { description: "Slight snow", emoji: "🌨️", category: "snow" },
  73: { description: "Moderate snow", emoji: "🌨️", category: "snow" },
  75: { description: "Heavy snow", emoji: "❄️", category: "snow" },

  // Snow grains
  77: { description: "Snow grains", emoji: "🌨️", category: "snow" },

  // Rain showers
  80: { description: "Slight rain showers", emoji: "🌦️", category: "rain" },
  81: { description: "Moderate rain showers", emoji: "🌧️", category: "rain" },
  82: { description: "Violent rain showers", emoji: "⛈️", category: "storm" },

  // Snow showers
  85: { description: "Slight snow showers", emoji: "🌨️", category: "snow" },
  86: { description: "Heavy snow showers", emoji: "❄️", category: "snow" },

  // Thunderstorm
  95: { description: "Thunderstorm", emoji: "⛈️", category: "storm" },
  96: { description: "Thunderstorm with slight hail", emoji: "⛈️", category: "storm" },
  99: { description: "Thunderstorm with heavy hail", emoji: "⛈️", category: "storm" },
};

/** Fallback for unknown WMO codes. */
const UNKNOWN_ENTRY: WmoEntry = {
  description: "Unknown",
  emoji: "❓",
  category: "cloudy",
};

// ── Public API ────────────────────────────────────────────────────

/**
 * Look up a WMO weather code and return its condition info.
 */
export function lookupWmoCode(code: number): WeatherCondition {
  const entry = WMO_TABLE[code] ?? UNKNOWN_ENTRY;
  return {
    code,
    description: entry.description,
    emoji: entry.emoji,
    category: entry.category,
  };
}

/**
 * Categorize weather based on both WMO code and temperature.
 * Temperature extremes override the code-based category.
 *
 * - ≥ 38°C → extreme-hot (regardless of sky condition)
 * - ≤ 0°C  → extreme-cold (unless already snow/storm)
 * - 18–28°C + clear/partly-cloudy → pleasant
 */
export function categorizeWeather(tempC: number, wmoCode: number): WeatherCondition {
  const base = lookupWmoCode(wmoCode);

  // Extreme heat overrides everything
  if (tempC >= 38) {
    return {
      ...base,
      category: "extreme-hot",
    };
  }

  // Extreme cold (only override if not already snow/storm — those are more specific)
  if (tempC <= 0 && base.category !== "snow" && base.category !== "storm") {
    return {
      ...base,
      category: "extreme-cold",
    };
  }

  // Pleasant weather: comfortable temp + nice sky
  if (
    tempC >= 18 &&
    tempC <= 28 &&
    (base.category === "clear" || base.category === "partly-cloudy")
  ) {
    return {
      ...base,
      category: "pleasant",
    };
  }

  return base;
}

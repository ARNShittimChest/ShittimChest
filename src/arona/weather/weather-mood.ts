/**
 * Weather → Mood integration for Arona emotional state engine.
 *
 * Analyzes current weather conditions and generates mood triggers
 * so Arona reacts naturally to weather (e.g., caring when it rains,
 * excited when it snows, worried when it's extremely hot).
 *
 * Also builds weather context strings for system prompt injection.
 */

import type { MoodTrigger, Mood } from "../../companion/emotional-state.js";
import type { WeatherData, WeatherCategory, DailyForecast } from "./types.js";

// ── Weather → Mood mapping ────────────────────────────────────────

interface WeatherMoodRule {
  delta: Partial<Record<Mood, number>>;
  source: string;
}

const WEATHER_MOOD_MAP: Record<WeatherCategory, WeatherMoodRule> = {
  clear: {
    delta: { happy: 0.2, excited: 0.1, playful: 0.1 },
    source: "weather-clear",
  },
  "partly-cloudy": {
    delta: { happy: 0.15 },
    source: "weather-partly-cloudy",
  },
  cloudy: {
    delta: { neutral: 0.1, nostalgic: 0.1 },
    source: "weather-cloudy",
  },
  fog: {
    delta: { caring: 0.2, nostalgic: 0.15, worried: 0.1 },
    source: "weather-fog",
  },
  drizzle: {
    delta: { caring: 0.3, nostalgic: 0.1 },
    source: "weather-drizzle",
  },
  rain: {
    delta: { caring: 0.4, nostalgic: 0.15, sad: 0.1 },
    source: "weather-rain",
  },
  snow: {
    delta: { excited: 0.4, happy: 0.3, playful: 0.2 },
    source: "weather-snow",
  },
  storm: {
    delta: { worried: 0.4, caring: 0.2 },
    source: "weather-storm",
  },
  "extreme-hot": {
    delta: { worried: 0.3, caring: 0.2, bored: 0.1 },
    source: "weather-hot",
  },
  "extreme-cold": {
    delta: { caring: 0.4, worried: 0.2 },
    source: "weather-cold",
  },
  pleasant: {
    delta: { happy: 0.3, playful: 0.15, excited: 0.1 },
    source: "weather-nice",
  },
};

// ── Public API ────────────────────────────────────────────────────

/**
 * Generate a mood trigger based on current weather conditions.
 * Returns null if weather data is unavailable.
 */
export function analyzeWeatherMoodTrigger(weather: WeatherData): MoodTrigger | null {
  const category = weather.current.condition.category;
  const rule = WEATHER_MOOD_MAP[category];

  if (!rule) return null;

  return {
    type: "event",
    source: rule.source,
    delta: rule.delta,
  };
}

/**
 * Build a weather context string for system prompt injection.
 *
 * Output example:
 * ```
 * [Current Weather]
 * Quận 7, Hồ Chí Minh: ⛅ Partly cloudy, 32°C (feels like 35°C), humidity 75%, wind 12 km/h
 * Forecast: Tomorrow ☀️ 28-34°C, Wed 🌧️ 25-30°C
 *
 * Use this info naturally — mention weather if relevant to conversation.
 * Don't force weather into every reply, but acknowledge it when it makes sense.
 * ```
 */
export function buildWeatherPromptContext(weather: WeatherData): string {
  const cur = weather.current;
  const cond = cur.condition;

  // Current weather line
  const locationPrefix = weather.locationName ? `${weather.locationName}: ` : "";
  const currentLine =
    `${locationPrefix}${cond.emoji} ${cond.description}, ` +
    `${cur.temperatureC}°C (feels like ${cur.feelsLikeC}°C), ` +
    `humidity ${cur.humidity}%, wind ${cur.windSpeedKmh} km/h`;

  const lines = ["[Current Weather]", currentLine];

  // Forecast lines (skip today = index 0, show next 2 days)
  const futureDays = weather.forecast.slice(1, 3);
  if (futureDays.length > 0) {
    const forecastParts = futureDays.map((day) => formatForecastDay(day));
    lines.push(`Forecast: ${forecastParts.join(", ")}`);
  }

  lines.push("");
  lines.push(
    "Use this info naturally — mention weather if relevant to conversation. " +
      "Don't force weather into every reply, but acknowledge it when it makes sense " +
      "(e.g., remind Sensei to bring umbrella if rain, suggest staying hydrated if hot).",
  );

  return lines.join("\n");
}

/**
 * Build a short weather summary for proactive messages (morning/lunch prompts).
 * Compact format: "⛅ 28°C, humidity 75%"
 */
export function buildWeatherShortSummary(weather: WeatherData): string {
  const cur = weather.current;
  return `${cur.condition.emoji} ${cur.temperatureC}°C, humidity ${cur.humidity}%`;
}

// ── Helpers ───────────────────────────────────────────────────────

function formatForecastDay(day: DailyForecast): string {
  const dayName = getDayName(day.date);
  return `${dayName} ${day.condition.emoji} ${day.minTempC}-${day.maxTempC}°C`;
}

function getDayName(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.getTime() === today.getTime()) return "Today";
    if (date.getTime() === tomorrow.getTime()) return "Tomorrow";

    return date.toLocaleDateString("en-US", { weekday: "short" });
  } catch {
    return dateStr;
  }
}

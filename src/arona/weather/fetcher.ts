/**
 * Weather data fetcher for Arona weather core feature.
 *
 * Fetches current weather + 3-day forecast from two free services:
 * - Primary: wttr.in (format=j1 JSON mode)
 * - Fallback: Open-Meteo API
 *
 * No API keys required for either service.
 */

import type { CurrentWeather, DailyForecast, WeatherData } from "./types.js";
import { categorizeWeather, lookupWmoCode } from "./wmo-codes.js";

const FETCH_TIMEOUT_MS = 8_000;

// ── wttr.in types ─────────────────────────────────────────────────

interface WttrCurrentCondition {
  temp_C?: string;
  FeelsLikeC?: string;
  humidity?: string;
  windspeedKmph?: string;
  weatherCode?: string;
  weatherDesc?: Array<{ value: string }>;
}

interface WttrWeatherDay {
  date?: string;
  maxtempC?: string;
  mintempC?: string;
  hourly?: Array<{ weatherCode?: string }>;
}

interface WttrResponse {
  current_condition?: WttrCurrentCondition[];
  weather?: WttrWeatherDay[];
}

// ── Open-Meteo types ──────────────────────────────────────────────

interface OpenMeteoCurrent {
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  wind_speed_10m?: number;
  weather_code?: number;
  time?: string;
}

interface OpenMeteoDaily {
  time?: string[];
  weather_code?: number[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
  daily?: OpenMeteoDaily;
}

// ── Fetch helpers ─────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Arona-CLW/1.0" },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Map wttr.in's weatherCode (string) to a WMO-compatible integer.
 * wttr.in uses WWO codes which differ from WMO — map the common ones.
 */
function wwoToWmo(wwoCode: string): number {
  const code = parseInt(wwoCode, 10);
  // WWO → WMO approximate mapping (wttr.in uses WWO codes)
  const map: Record<number, number> = {
    113: 0, // Clear/Sunny
    116: 2, // Partly cloudy
    119: 3, // Cloudy
    122: 3, // Overcast
    143: 45, // Mist
    176: 80, // Patchy rain nearby
    179: 71, // Patchy snow nearby
    182: 66, // Patchy sleet nearby
    185: 56, // Patchy freezing drizzle nearby
    200: 95, // Thundery outbreaks nearby
    227: 77, // Blowing snow
    230: 75, // Blizzard
    248: 45, // Fog
    260: 48, // Freezing fog
    263: 51, // Patchy light drizzle
    266: 53, // Light drizzle
    281: 56, // Freezing drizzle
    284: 57, // Heavy freezing drizzle
    293: 61, // Patchy light rain
    296: 61, // Light rain
    299: 63, // Moderate rain at times
    302: 63, // Moderate rain
    305: 65, // Heavy rain at times
    308: 65, // Heavy rain
    311: 66, // Light freezing rain
    314: 67, // Moderate or heavy freezing rain
    317: 66, // Light sleet
    320: 67, // Moderate or heavy sleet
    323: 71, // Patchy light snow
    326: 71, // Light snow
    329: 73, // Patchy moderate snow
    332: 73, // Moderate snow
    335: 75, // Patchy heavy snow
    338: 75, // Heavy snow
    350: 77, // Ice pellets
    353: 80, // Light rain shower
    356: 81, // Moderate or heavy rain shower
    359: 82, // Torrential rain shower
    362: 85, // Light sleet showers
    365: 86, // Moderate or heavy sleet showers
    368: 85, // Light snow showers
    371: 86, // Moderate or heavy snow showers
    374: 77, // Light showers of ice pellets
    377: 77, // Moderate or heavy showers of ice pellets
    386: 95, // Patchy light rain in area with thunder
    389: 99, // Moderate or heavy rain in area with thunder
    392: 95, // Patchy light snow in area with thunder
    395: 99, // Moderate or heavy snow in area with thunder
  };
  return map[code] ?? 3; // Default to overcast if unknown
}

// ── Primary: wttr.in ──────────────────────────────────────────────

/**
 * Fetch weather from wttr.in JSON API.
 * URL: wttr.in/{lat},{lon}?format=j1
 */
export async function fetchFromWttrIn(lat: number, lon: number): Promise<WeatherData | null> {
  try {
    const url = `https://wttr.in/${lat},${lon}?format=j1`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;

    const data = (await res.json()) as WttrResponse;
    const cc = data.current_condition?.[0];
    if (!cc) return null;

    const tempC = parseFloat(cc.temp_C ?? "0");
    const wmoCode = wwoToWmo(cc.weatherCode ?? "0");
    const condition = categorizeWeather(tempC, wmoCode);

    const current: CurrentWeather = {
      temperatureC: tempC,
      feelsLikeC: parseFloat(cc.FeelsLikeC ?? cc.temp_C ?? "0"),
      humidity: parseInt(cc.humidity ?? "0", 10),
      windSpeedKmh: parseInt(cc.windspeedKmph ?? "0", 10),
      condition,
      observedAt: new Date().toISOString(),
    };

    const forecast: DailyForecast[] = (data.weather ?? []).slice(0, 3).map((day) => {
      const dayWmoCode = wwoToWmo(day.hourly?.[4]?.weatherCode ?? "0");
      const maxTemp = parseFloat(day.maxtempC ?? "0");
      return {
        date: day.date ?? "",
        maxTempC: maxTemp,
        minTempC: parseFloat(day.mintempC ?? "0"),
        condition: categorizeWeather(maxTemp, dayWmoCode),
      };
    });

    return {
      current,
      forecast,
      fetchedAt: Date.now(),
      source: "wttr.in",
    };
  } catch {
    return null;
  }
}

// ── Fallback: Open-Meteo ──────────────────────────────────────────

/**
 * Fetch weather from Open-Meteo API.
 * Free, no key, returns WMO codes directly.
 */
export async function fetchFromOpenMeteo(lat: number, lon: number): Promise<WeatherData | null> {
  try {
    const params = [
      `latitude=${lat}`,
      `longitude=${lon}`,
      `current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`,
      `daily=weather_code,temperature_2m_max,temperature_2m_min`,
      `forecast_days=3`,
      `timezone=auto`,
    ].join("&");

    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;

    const data = (await res.json()) as OpenMeteoResponse;
    const cur = data.current;
    if (!cur) return null;

    const tempC = cur.temperature_2m ?? 0;
    const wmoCode = cur.weather_code ?? 0;
    const condition = categorizeWeather(tempC, wmoCode);

    const current: CurrentWeather = {
      temperatureC: tempC,
      feelsLikeC: cur.apparent_temperature ?? tempC,
      humidity: cur.relative_humidity_2m ?? 0,
      windSpeedKmh: cur.wind_speed_10m ?? 0,
      condition,
      observedAt: cur.time ?? new Date().toISOString(),
    };

    const daily = data.daily;
    const forecast: DailyForecast[] = [];

    if (daily?.time) {
      for (let i = 0; i < Math.min(3, daily.time.length); i++) {
        const dayCode = daily.weather_code?.[i] ?? 0;
        const maxTemp = daily.temperature_2m_max?.[i] ?? 0;
        forecast.push({
          date: daily.time[i]!,
          maxTempC: maxTemp,
          minTempC: daily.temperature_2m_min?.[i] ?? 0,
          condition: categorizeWeather(maxTemp, dayCode),
        });
      }
    }

    return {
      current,
      forecast,
      fetchedAt: Date.now(),
      source: "open-meteo",
    };
  } catch {
    return null;
  }
}

// ── Combined fetch with fallback ──────────────────────────────────

/**
 * Fetch weather data: try wttr.in first, fall back to Open-Meteo.
 * Returns null if both sources fail (graceful degradation).
 */
export async function fetchWeather(lat: number, lon: number): Promise<WeatherData | null> {
  // Try primary
  const primary = await fetchFromWttrIn(lat, lon);
  if (primary) return primary;

  // Fallback
  const fallback = await fetchFromOpenMeteo(lat, lon);
  return fallback;
}

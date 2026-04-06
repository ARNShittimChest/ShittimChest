/**
 * Reverse geocoding service using Nominatim (OpenStreetMap).
 * Converts GPS coordinates → human-readable place names.
 * FREE, no API key required. Rate limit: 1 req/sec (we call rarely).
 */

import type { GeocodedPlace, UserLocation } from "./location-store.js";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "Arona-CLW/1.0"; // Required by Nominatim ToS
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 8_000;

// ── In-memory cache ────────────────────────────────────────────────

interface GeocodeCache {
  key: string;
  place: GeocodedPlace;
  cachedAt: number;
}

let cache: GeocodeCache | null = null;

/** Round coordinate to ~111m precision for cache key. */
function roundCoord(v: number): string {
  return v.toFixed(3);
}

function cacheKey(lat: number, lon: number): string {
  return `${roundCoord(lat)},${roundCoord(lon)}`;
}

// ── Nominatim response types ───────────────────────────────────────

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city_district?: string;
  country?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
  display_name?: string;
}

// ── Core functions ─────────────────────────────────────────────────

/**
 * Reverse geocode lat/lon → place name using Nominatim (OpenStreetMap).
 * Returns cached result if coordinates haven't moved significantly.
 * Returns null on API failure (graceful degradation).
 */
export async function reverseGeocode(lat: number, lon: number): Promise<GeocodedPlace | null> {
  const key = cacheKey(lat, lon);

  // Check cache
  if (cache && cache.key === key && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    return cache.place;
  }

  try {
    const url =
      `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lon}` +
      `&format=json&zoom=14&accept-language=vi,en`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as NominatimResponse;
    const addr = data.address;
    if (!addr) return null;

    const city =
      addr.city ??
      addr.town ??
      addr.village ??
      addr.municipality ??
      addr.county ??
      addr.state ??
      "Unknown";

    const district =
      addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? addr.city_district ?? undefined;

    const country = addr.country ?? "Unknown";

    const displayParts = [district, city, country].filter(Boolean);
    const displayName = displayParts.join(", ");

    const place: GeocodedPlace = { city, district, country, displayName };

    // Update cache
    cache = { key, place, cachedAt: Date.now() };

    return place;
  } catch {
    return null;
  }
}

/**
 * Build a human-readable location string for prompt injection.
 * Falls back to raw coords if no geocoded place available.
 */
export function formatLocationForPrompt(
  location: Pick<UserLocation, "lat" | "lon" | "place">,
): string {
  const latDir = location.lat >= 0 ? "N" : "S";
  const lonDir = location.lon >= 0 ? "E" : "W";
  const coordStr = `${Math.abs(location.lat).toFixed(3)}°${latDir}, ${Math.abs(location.lon).toFixed(3)}°${lonDir}`;

  if (location.place) {
    return `${location.place.displayName} (${coordStr})`;
  }

  return `Lat ${location.lat.toFixed(4)}, Lon ${location.lon.toFixed(4)}`;
}

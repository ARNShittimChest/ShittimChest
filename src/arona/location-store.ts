/**
 * Enhanced Location Store for Arona companion system.
 *
 * Stores user GPS coordinates + reverse-geocoded place name.
 * Persists to disk (.arona/location.json) so location survives server restarts.
 */

import fs from "node:fs";
import path from "node:path";

// ── Types ──────────────────────────────────────────────────────────

export interface GeocodedPlace {
  city: string;
  district?: string;
  country: string;
  displayName: string;
}

export interface UserLocation {
  lat: number;
  lon: number;
  updatedAt: Date;
  /** Reverse-geocoded place name (null if geocoding hasn't run or failed). */
  place: GeocodedPlace | null;
  /** When the geocoded place was last resolved. */
  placeUpdatedAt: Date | null;
}

// ── Module-level state ─────────────────────────────────────────────

let currentUserLocation: UserLocation | null = null;

// ── Getters / Setters ──────────────────────────────────────────────

export function getUserLocation(): UserLocation | null {
  return currentUserLocation;
}

export function setUserLocation(lat: number, lon: number): void {
  currentUserLocation = {
    lat,
    lon,
    updatedAt: new Date(),
    place: currentUserLocation?.place ?? null,
    placeUpdatedAt: currentUserLocation?.placeUpdatedAt ?? null,
  };
}

/** Update only the geocoded place info (called after reverse geocoding completes). */
export function setUserPlace(place: GeocodedPlace): void {
  if (!currentUserLocation) return;
  currentUserLocation = {
    ...currentUserLocation,
    place,
    placeUpdatedAt: new Date(),
  };
}

// ── Coordinate change detection ────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Check if new coordinates differ significantly from the current stored location.
 * Used to decide whether to re-geocode after receiving a new GPS fix.
 * Returns true if no location exists yet (first fix).
 */
export function hasLocationChanged(newLat: number, newLon: number, thresholdKm = 0.5): boolean {
  if (!currentUserLocation) return true;
  return (
    haversineDistanceKm(currentUserLocation.lat, currentUserLocation.lon, newLat, newLon) >=
    thresholdKm
  );
}

// ── Persistence ────────────────────────────────────────────────────

const STATE_DIR = ".arona";
const LOCATION_FILE = "location.json";

function resolveLocationPath(workspaceDir: string): string {
  return path.join(workspaceDir, STATE_DIR, LOCATION_FILE);
}

interface LocationOnDisk {
  lat: number;
  lon: number;
  updatedAt: string;
  place: GeocodedPlace | null;
  placeUpdatedAt: string | null;
}

/** Save current location to disk (atomic write: tmp → rename). */
export function saveLocation(workspaceDir: string): void {
  if (!currentUserLocation) return;
  const filePath = resolveLocationPath(workspaceDir);
  const dir = path.dirname(filePath);

  try {
    fs.mkdirSync(dir, { recursive: true });
    const payload: LocationOnDisk = {
      lat: currentUserLocation.lat,
      lon: currentUserLocation.lon,
      updatedAt: currentUserLocation.updatedAt.toISOString(),
      place: currentUserLocation.place,
      placeUpdatedAt: currentUserLocation.placeUpdatedAt?.toISOString() ?? null,
    };
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Best-effort: don't crash if we can't persist location
  }
}

/** Load location from disk into memory. Returns the loaded location or null. */
export function loadLocation(workspaceDir: string): UserLocation | null {
  const filePath = resolveLocationPath(workspaceDir);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as LocationOnDisk;

    if (typeof parsed.lat !== "number" || typeof parsed.lon !== "number") {
      return null;
    }

    const location: UserLocation = {
      lat: parsed.lat,
      lon: parsed.lon,
      updatedAt: new Date(parsed.updatedAt),
      place: parsed.place ?? null,
      placeUpdatedAt: parsed.placeUpdatedAt ? new Date(parsed.placeUpdatedAt) : null,
    };

    return location;
  } catch {
    return null;
  }
}

/**
 * Load persisted location into memory on startup.
 * No-op if no persisted file exists.
 */
export function loadOrInitLocation(workspaceDir: string): void {
  const loaded = loadLocation(workspaceDir);
  if (loaded) {
    currentUserLocation = loaded;
  }
}

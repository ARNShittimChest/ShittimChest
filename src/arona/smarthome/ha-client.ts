/**
 * arona/smarthome/ha-client.ts
 *
 * Home Assistant REST API client.
 * Uses native fetch() to communicate with the HA instance.
 *
 * Endpoints used:
 *   GET  /api/              — Check API status
 *   GET  /api/states        — List all entity states
 *   GET  /api/states/:id    — Get single entity state
 *   POST /api/services/:domain/:service — Call a service
 */

import { getHAConfig, recordAudit } from "./ha-config.js";

// ── Types ────────────────────────────────────────────────────────

export interface HAEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HAServiceCallResult {
  success: boolean;
  states?: HAEntityState[];
  error?: string;
}

interface HAApiStatus {
  message: string;
}

// ── Internal helpers ────────────────────────────────────────────

class HATimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Home Assistant request timed out after ${timeoutMs}ms: ${url}`);
    this.name = "HATimeoutError";
  }
}

async function haFetch<T>(method: "GET" | "POST", endpoint: string, body?: unknown): Promise<T> {
  const cfg = getHAConfig();
  if (!cfg.enabled || !cfg.baseUrl || !cfg.accessToken) {
    throw new Error(
      "Home Assistant chưa được cấu hình. Sensei cần cung cấp baseUrl và accessToken trước.",
    );
  }

  const url = `${cfg.baseUrl}${endpoint}`;
  const timeoutMs = cfg.timeoutMs || 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.accessToken}`,
  };
  // Only set Content-Type for requests with a body
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HA API error ${response.status}: ${text || response.statusText}`);
    }

    return (await response.json()) as T;
  } catch (err) {
    // Convert AbortError to a descriptive timeout error
    if (err instanceof Error && err.name === "AbortError") {
      throw new HATimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ──────────────────────────────────────────────────

/** Check if the Home Assistant instance is reachable. */
export async function checkConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const status = await haFetch<HAApiStatus>("GET", "/api/");
    return { ok: true, message: status.message || "API running" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Get the state of a single entity. */
export async function getEntityState(entityId: string): Promise<HAEntityState> {
  return await haFetch<HAEntityState>("GET", `/api/states/${encodeURIComponent(entityId)}`);
}

/**
 * Call a Home Assistant service.
 *
 * Examples:
 *   callService("light", "turn_on", "light.living_room", { brightness: 255 })
 *   callService("climate", "set_temperature", "climate.bedroom", { temperature: 24 })
 *   callService("lock", "lock", "lock.front_door")
 */
export async function callService(
  domain: string,
  service: string,
  entityId: string,
  data?: Record<string, unknown>,
): Promise<HAServiceCallResult> {
  const action = `${domain}.${service}`;
  try {
    const payload: Record<string, unknown> = {
      entity_id: entityId,
      ...data,
    };

    const result = await haFetch<HAEntityState[]>(
      "POST",
      `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
      payload,
    );

    recordAudit({ action, entityId, success: true });

    return {
      success: true,
      states: Array.isArray(result) ? result : undefined,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    recordAudit({ action, entityId, success: false, error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/** Simplified entity info returned by discovery. */
export interface DiscoveredEntity {
  entityId: string;
  state: string;
  friendlyName: string;
  domain: string;
  /** Device class from HA (e.g. "temperature", "motion", "door"). */
  deviceClass?: string;
  /** Area/room name resolved from HA registries. */
  area?: string;
}

// ── Registry types (HA REST API responses) ─────────────────────

interface HAAreaRegistryEntry {
  area_id: string;
  name: string;
  /** Optional Vietnamese or user-set alias. */
  aliases?: string[];
}

interface HADeviceRegistryEntry {
  id: string;
  area_id: string | null;
  name: string | null;
  name_by_user: string | null;
}

interface HAEntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  area_id: string | null;
  name: string | null;
  original_name: string | null;
  platform: string;
}

/**
 * Fetch HA area registry. Returns a map of area_id → area name.
 * Falls back to empty map on error (non-critical).
 */
async function fetchAreaRegistry(): Promise<Map<string, string>> {
  try {
    const areas = await haFetch<HAAreaRegistryEntry[]>("GET", "/api/config/area_registry/list");
    const map = new Map<string, string>();
    for (const a of areas) {
      map.set(a.area_id, a.name);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Fetch HA device registry. Returns a map of device_id → area_id.
 * Falls back to empty map on error (non-critical).
 */
async function fetchDeviceRegistry(): Promise<Map<string, string | null>> {
  try {
    const devices = await haFetch<HADeviceRegistryEntry[]>(
      "GET",
      "/api/config/device_registry/list",
    );
    const map = new Map<string, string | null>();
    for (const d of devices) {
      map.set(d.id, d.area_id);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Fetch HA entity registry. Returns entries with area_id and device_id.
 * Falls back to empty array on error (non-critical).
 */
async function fetchEntityRegistry(): Promise<HAEntityRegistryEntry[]> {
  try {
    return await haFetch<HAEntityRegistryEntry[]>("GET", "/api/config/entity_registry/list");
  } catch {
    return [];
  }
}

/**
 * Resolve area name for an entity using HA registries.
 *
 * Priority: entity's own area_id → device's area_id → state attributes fallback.
 */
function resolveArea(
  entityId: string,
  entityRegistry: Map<string, HAEntityRegistryEntry>,
  deviceRegistry: Map<string, string | null>,
  areaRegistry: Map<string, string>,
  stateAttrs: Record<string, unknown>,
): string | undefined {
  const entityEntry = entityRegistry.get(entityId);

  // 1. Entity has a direct area_id
  if (entityEntry?.area_id) {
    const name = areaRegistry.get(entityEntry.area_id);
    if (name) return name;
  }

  // 2. Entity's parent device has an area_id
  if (entityEntry?.device_id) {
    const deviceAreaId = deviceRegistry.get(entityEntry.device_id);
    if (deviceAreaId) {
      const name = areaRegistry.get(deviceAreaId);
      if (name) return name;
    }
  }

  // 3. Fallback: attributes (some custom integrations)
  const fallback = stateAttrs.area_name ?? stateAttrs.room ?? stateAttrs.area;
  if (typeof fallback === "string" && fallback) return fallback;

  return undefined;
}

/**
 * Discover entities from Home Assistant.
 * Fetches all states + area/device/entity registries for accurate area mapping.
 */
export async function discoverEntities(): Promise<DiscoveredEntity[]> {
  // Fetch states and registries in parallel
  const [states, areaRegistry, deviceRegistry, entityRegistryList] = await Promise.all([
    haFetch<HAEntityState[]>("GET", "/api/states"),
    fetchAreaRegistry(),
    fetchDeviceRegistry(),
    fetchEntityRegistry(),
  ]);

  // Index entity registry by entity_id for O(1) lookup
  const entityRegistry = new Map<string, HAEntityRegistryEntry>();
  for (const e of entityRegistryList) {
    entityRegistry.set(e.entity_id, e);
  }

  return states.map((s) => {
    const attrs = s.attributes;
    const result: DiscoveredEntity = {
      entityId: s.entity_id,
      state: s.state,
      friendlyName: (attrs.friendly_name as string) || s.entity_id,
      domain: s.entity_id.split(".")[0],
    };

    if (typeof attrs.device_class === "string" && attrs.device_class) {
      result.deviceClass = attrs.device_class;
    }

    const area = resolveArea(s.entity_id, entityRegistry, deviceRegistry, areaRegistry, attrs);
    if (area) result.area = area;

    return result;
  });
}

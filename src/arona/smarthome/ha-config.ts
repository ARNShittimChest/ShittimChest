/**
 * arona/smarthome/ha-config.ts
 *
 * Persistent configuration for Home Assistant integration.
 * Stores connection details (base URL, long-lived access token),
 * entity-to-friendly-name mappings, and scene definitions.
 *
 * Storage: `.arona/ha-config.json` (atomic write — tmp file + rename).
 */

import fs from "node:fs";
import path from "node:path";

// ── Types ────────────────────────────────────────────────────────

/** Valid device type identifiers matching the spec. */
export const HA_DEVICE_TYPES = [
  "LIGHT",
  "AC",
  "LOCK",
  "CAM",
  "SENSOR",
  "PLUG",
  "CURTAIN",
  "SPEAKER",
  "TV",
  "ROBOT",
  "OTHER",
] as const;

export type HADeviceType = (typeof HA_DEVICE_TYPES)[number];

/**
 * Map HA entity domain → Arona device type.
 * Used by auto-sync to classify discovered entities.
 */
export const DOMAIN_TO_DEVICE_TYPE: Readonly<Record<string, HADeviceType>> = {
  light: "LIGHT",
  climate: "AC",
  lock: "LOCK",
  camera: "CAM",
  sensor: "SENSOR",
  binary_sensor: "SENSOR",
  switch: "PLUG",
  cover: "CURTAIN",
  vacuum: "ROBOT",
  media_player: "SPEAKER",
  fan: "OTHER",
};

/** Domains we consider useful for smart home control. */
export const SYNCABLE_DOMAINS = new Set(Object.keys(DOMAIN_TO_DEVICE_TYPE));

export interface HAEntityMapping {
  /** Home Assistant entity_id, e.g. "light.living_room" */
  entityId: string;
  /** Friendly name in Vietnamese, e.g. "đèn phòng khách" */
  friendlyName: string;
  /** Device type for categorization */
  deviceType: HADeviceType;
  /** Room/area name, e.g. "phòng khách" */
  area?: string;
}

export interface HAScene {
  /** Scene identifier, e.g. "movie_mode" */
  id: string;
  /** Friendly name, e.g. "Chế độ xem phim" */
  name: string;
  /** List of service calls to execute for this scene */
  actions: HASceneAction[];
}

export interface HASceneAction {
  /** HA service domain, e.g. "light" */
  domain: string;
  /** HA service name, e.g. "turn_off" */
  service: string;
  /** Target entity_id */
  entityId: string;
  /** Optional service data (e.g. brightness, temperature) */
  data?: Record<string, unknown>;
}

export interface HAConfig {
  /** Home Assistant base URL, e.g. "http://192.168.1.100:8123" */
  baseUrl: string;
  /** Long-lived access token for authentication */
  accessToken: string;
  /** Whether the integration is enabled */
  enabled: boolean;
  /** Timeout for API calls in milliseconds */
  timeoutMs: number;
  /** Entity mappings (entity_id → friendly info) */
  entities: HAEntityMapping[];
  /** Predefined scenes */
  scenes: HAScene[];
  /** Whether to require confirmation before toggling locks/security */
  requireConfirmForSecurity: boolean;
}

/** Audit log entry for device actions */
export interface HAAuditEntry {
  /** Action performed */
  action: string;
  /** Target entity */
  entityId: string;
  /** Timestamp (epoch ms) */
  timestamp: number;
  /** Whether the action succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ── Defaults ────────────────────────────────────────────────────

const DEFAULT_HA_CONFIG: Readonly<HAConfig> = {
  baseUrl: "",
  accessToken: "",
  enabled: false,
  timeoutMs: 10_000,
  entities: [],
  scenes: [],
  requireConfirmForSecurity: true,
};

/** Create a fresh default config (deep copy so arrays aren't shared). */
function createDefaultConfig(): HAConfig {
  return { ...DEFAULT_HA_CONFIG, entities: [], scenes: [] };
}

// ── In-memory state ─────────────────────────────────────────────

let config: HAConfig | null = null;
let configPath: string | null = null;

/**
 * In-memory ring buffer backed by `.arona/audit.jsonl` on disk.
 * On startup, the last MAX_AUDIT_ENTRIES lines are loaded.
 * On each recordAudit(), the entry is appended to the file.
 */
const MAX_AUDIT_ENTRIES = 1000;
const MAX_AUDIT_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const auditLog: HAAuditEntry[] = [];
let auditFilePath: string | null = null;

// ── Validation helpers ──────────────────────────────────────────

function isValidEntityMapping(e: unknown): e is HAEntityMapping {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Record<string, unknown>;
  return (
    typeof obj.entityId === "string" &&
    obj.entityId.length > 0 &&
    typeof obj.friendlyName === "string" &&
    obj.friendlyName.length > 0 &&
    typeof obj.deviceType === "string" &&
    (HA_DEVICE_TYPES as readonly string[]).includes(obj.deviceType)
  );
}

function isValidSceneAction(a: unknown): a is HASceneAction {
  if (typeof a !== "object" || a === null) return false;
  const obj = a as Record<string, unknown>;
  return (
    typeof obj.domain === "string" &&
    obj.domain.length > 0 &&
    typeof obj.service === "string" &&
    obj.service.length > 0 &&
    typeof obj.entityId === "string" &&
    obj.entityId.length > 0
  );
}

function isValidScene(s: unknown): s is HAScene {
  if (typeof s !== "object" || s === null) return false;
  const obj = s as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    obj.id.length > 0 &&
    typeof obj.name === "string" &&
    obj.name.length > 0 &&
    Array.isArray(obj.actions) &&
    obj.actions.every(isValidSceneAction)
  );
}

// ── Persistence ─────────────────────────────────────────────────

function saveToDisk(): void {
  if (!configPath || !config) return;
  try {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${configPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, configPath);
  } catch {
    // Best-effort
  }
}

function loadFromDisk(): void {
  if (!configPath) return;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<HAConfig>;
    config = {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : "",
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
      timeoutMs:
        typeof parsed.timeoutMs === "number" && parsed.timeoutMs >= 1000
          ? parsed.timeoutMs
          : 10_000,
      requireConfirmForSecurity:
        typeof parsed.requireConfirmForSecurity === "boolean"
          ? parsed.requireConfirmForSecurity
          : true,
      // Validate each entity/scene — drop malformed entries silently
      entities: Array.isArray(parsed.entities) ? parsed.entities.filter(isValidEntityMapping) : [],
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes.filter(isValidScene) : [],
    };
  } catch {
    config = createDefaultConfig();
  }
}

// ── Public API ──────────────────────────────────────────────────

/** Initialize the HA config. Call once at startup. */
export function initHAConfig(workspaceDir: string): void {
  const aronaDir = path.join(workspaceDir, ".arona");
  configPath = path.join(aronaDir, "ha-config.json");
  auditFilePath = path.join(aronaDir, "audit.jsonl");
  loadFromDisk();
  loadAuditFromDisk();
}

/** Get the current HA config (returns defaults if not initialized). */
export function getHAConfig(): HAConfig {
  return config ?? createDefaultConfig();
}

/** Check if HA integration is properly configured and enabled. */
export function isHAConfigured(): boolean {
  const cfg = getHAConfig();
  return cfg.enabled && !!cfg.baseUrl && !!cfg.accessToken;
}

/** Fields that can be updated on the connection config. */
export type HAConfigUpdates = Partial<
  Pick<HAConfig, "baseUrl" | "accessToken" | "enabled" | "timeoutMs" | "requireConfirmForSecurity">
>;

/** Update HA connection settings. Returns the updated config. */
export function updateHAConfig(updates: HAConfigUpdates): HAConfig {
  if (!config) config = createDefaultConfig();
  if (updates.baseUrl !== undefined) config.baseUrl = updates.baseUrl.replace(/\/+$/, "");
  if (updates.accessToken !== undefined) config.accessToken = updates.accessToken;
  if (updates.enabled !== undefined) config.enabled = updates.enabled;
  if (updates.timeoutMs !== undefined) config.timeoutMs = Math.max(1000, updates.timeoutMs);
  if (updates.requireConfirmForSecurity !== undefined)
    config.requireConfirmForSecurity = updates.requireConfirmForSecurity;
  saveToDisk();
  return config;
}

/** Add or update an entity mapping. */
export function upsertEntity(entity: HAEntityMapping): HAConfig {
  if (!config) config = createDefaultConfig();
  const idx = config.entities.findIndex((e) => e.entityId === entity.entityId);
  if (idx >= 0) {
    config.entities[idx] = entity;
  } else {
    config.entities.push(entity);
  }
  saveToDisk();
  return config;
}

/** Remove an entity mapping. */
export function removeEntity(entityId: string): HAConfig {
  if (!config) config = createDefaultConfig();
  config.entities = config.entities.filter((e) => e.entityId !== entityId);
  saveToDisk();
  return config;
}

/** Result of a bulk sync operation. */
export interface SyncResult {
  added: string[];
  updated: string[];
  removed: string[];
  skipped: string[];
}

/**
 * Bulk-sync discovered entities into the config.
 *
 * - Upserts every entity in `incoming` (add new, update existing).
 * - Optionally removes entities that exist in config but NOT in `incoming`
 *   (controlled by `removeStale`).
 * - Saves to disk once at the end (not per-entity).
 */
export function syncEntities(incoming: HAEntityMapping[], removeStale = false): SyncResult {
  if (!config) config = createDefaultConfig();

  const result: SyncResult = { added: [], updated: [], removed: [], skipped: [] };
  const incomingIds = new Set(incoming.map((e) => e.entityId));

  for (const entity of incoming) {
    if (!entity.entityId || !entity.friendlyName) {
      result.skipped.push(entity.entityId || "(unknown)");
      continue;
    }
    const idx = config.entities.findIndex((e) => e.entityId === entity.entityId);
    if (idx >= 0) {
      config.entities[idx] = entity;
      result.updated.push(entity.entityId);
    } else {
      config.entities.push(entity);
      result.added.push(entity.entityId);
    }
  }

  if (removeStale) {
    const stale = config.entities.filter((e) => !incomingIds.has(e.entityId));
    result.removed = stale.map((e) => e.entityId);
    config.entities = config.entities.filter((e) => incomingIds.has(e.entityId));
  }

  saveToDisk();
  return result;
}

/** Add or update a scene. */
export function upsertScene(scene: HAScene): HAConfig {
  if (!config) config = createDefaultConfig();
  const idx = config.scenes.findIndex((s) => s.id === scene.id);
  if (idx >= 0) {
    config.scenes[idx] = scene;
  } else {
    config.scenes.push(scene);
  }
  saveToDisk();
  return config;
}

/** Remove a scene. */
export function removeScene(sceneId: string): HAConfig {
  if (!config) config = createDefaultConfig();
  config.scenes = config.scenes.filter((s) => s.id !== sceneId);
  saveToDisk();
  return config;
}

/**
 * Find entity by friendly name or entity_id.
 *
 * Priority: exact match (entity_id or friendlyName) → entity starts-with input
 * → friendlyName starts-with input. This avoids the false positives of
 * bidirectional substring matching.
 */
export function findEntityByName(name: string): HAEntityMapping | undefined {
  const cfg = getHAConfig();
  const lower = name.toLowerCase().trim();
  if (!lower) return undefined;

  // Pass 1 — exact match
  const exact = cfg.entities.find(
    (e) => e.friendlyName.toLowerCase() === lower || e.entityId.toLowerCase() === lower,
  );
  if (exact) return exact;

  // Pass 2 — friendlyName starts with input (e.g. "đèn" matches "đèn phòng khách")
  const startsWith = cfg.entities.find((e) => e.friendlyName.toLowerCase().startsWith(lower));
  if (startsWith) return startsWith;

  // Pass 3 — input starts with friendlyName (e.g. "đèn phòng khách chính" matches "đèn phòng khách")
  return cfg.entities.find((e) => lower.startsWith(e.friendlyName.toLowerCase()));
}

/** Find scene by id or name. */
export function findScene(idOrName: string): HAScene | undefined {
  const cfg = getHAConfig();
  const lower = idOrName.toLowerCase().trim();
  if (!lower) return undefined;

  // Exact match first
  const exact = cfg.scenes.find(
    (s) => s.id.toLowerCase() === lower || s.name.toLowerCase() === lower,
  );
  if (exact) return exact;

  // Then prefix match
  return cfg.scenes.find((s) => s.name.toLowerCase().startsWith(lower));
}

// ── Audit Log (disk-backed) ───────────────────────────────────

/** Load recent audit entries from `.arona/audit.jsonl`. */
function loadAuditFromDisk(): void {
  if (!auditFilePath) return;
  try {
    const raw = fs.readFileSync(auditFilePath, "utf-8");
    const cutoff = Date.now() - MAX_AUDIT_AGE_MS;
    const lines = raw.split("\n").filter(Boolean);

    // Parse and filter out entries older than 30 days
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as HAAuditEntry;
        if (
          typeof entry.action === "string" &&
          typeof entry.entityId === "string" &&
          typeof entry.timestamp === "number" &&
          entry.timestamp >= cutoff
        ) {
          auditLog.push(entry);
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Trim to max entries (keep most recent)
    while (auditLog.length > MAX_AUDIT_ENTRIES) {
      auditLog.shift();
    }

    // If we filtered out old entries, rewrite the file
    if (auditLog.length < lines.length) {
      rewriteAuditFile();
    }
  } catch {
    // File doesn't exist yet — that's fine
  }
}

/** Append a single audit entry to the JSONL file. */
function appendAuditToDisk(entry: HAAuditEntry): void {
  if (!auditFilePath) return;
  try {
    const dir = path.dirname(auditFilePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(auditFilePath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Best-effort
  }
}

/** Rewrite the entire audit file (used after rotation/cleanup). */
function rewriteAuditFile(): void {
  if (!auditFilePath) return;
  try {
    const dir = path.dirname(auditFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${auditFilePath}.tmp-${process.pid}`;
    const content = auditLog.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, auditFilePath);
  } catch {
    // Best-effort
  }
}

/** Record an action in the audit log. Persists to disk. */
export function recordAudit(entry: Omit<HAAuditEntry, "timestamp">): void {
  const full: HAAuditEntry = { ...entry, timestamp: Date.now() };
  auditLog.push(full);

  // Rotate in-memory if needed
  let needsRewrite = false;
  while (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.shift();
    needsRewrite = true;
  }

  if (needsRewrite) {
    rewriteAuditFile();
  } else {
    appendAuditToDisk(full);
  }
}

/** Get recent audit entries, optionally filtered by time range. */
export function getRecentAudit(limit = 10, sinceMs?: number): HAAuditEntry[] {
  let entries = auditLog;
  if (sinceMs !== undefined) {
    entries = entries.filter((e) => e.timestamp >= sinceMs);
  }
  return entries.slice(-limit);
}

// ── System Prompt Context ──────────────────────────────────────

/** Format epoch ms → "HH:MM" in a simple way (no ICU dependency). */
function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Build a summary of smart home config for system prompt injection. */
export function buildSmartHomeContext(): string {
  const cfg = getHAConfig();

  if (!cfg.enabled || !cfg.baseUrl) {
    return "";
  }

  const lines: string[] = ["[Smart Home — Home Assistant]"];
  lines.push(`Status: ${isHAConfigured() ? "Connected" : "Not configured"}`);

  if (cfg.entities.length > 0) {
    lines.push("");
    lines.push("Available devices:");
    // Group by area
    const byArea = new Map<string, HAEntityMapping[]>();
    for (const e of cfg.entities) {
      const area = e.area || "Khác";
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area)!.push(e);
    }
    for (const [area, entities] of byArea) {
      lines.push(`  ${area}:`);
      for (const e of entities) {
        lines.push(`    - ${e.friendlyName} (${e.entityId}) [${e.deviceType}]`);
      }
    }
  }

  if (cfg.scenes.length > 0) {
    lines.push("");
    lines.push("Available scenes:");
    for (const s of cfg.scenes) {
      lines.push(`  - ${s.name} (${s.id}): ${s.actions.length} actions`);
    }
  }

  // Recent audit
  const recent = getRecentAudit(5);
  if (recent.length > 0) {
    lines.push("");
    lines.push("Recent actions:");
    for (const a of recent) {
      const time = formatTime(a.timestamp);
      const status = a.success ? "OK" : `FAIL${a.error ? ` (${a.error})` : ""}`;
      lines.push(`  - [${time}] ${a.action} → ${a.entityId} ${status}`);
    }
  }

  lines.push("");
  lines.push(
    'Sensei can control devices by telling Arona, e.g. "Tắt đèn phòng khách", "Bật điều hòa 24 độ", "Cho robot hút bụi đi".',
  );

  return lines.join("\n");
}

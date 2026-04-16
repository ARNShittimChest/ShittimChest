/**
 * agents/tools/home-assistant-tool.ts
 *
 * AI agent tool that lets Arona control smart home devices via Home Assistant.
 * Arona interprets Sensei's natural language commands and calls this tool to:
 *   - List available devices and their states
 *   - Turn devices on/off, set brightness/temperature
 *   - Activate scenes (movie mode, sleep mode, etc.)
 *   - Configure the HA connection
 *   - Discover new entities from Home Assistant
 *
 * Security:
 *   - ownerOnly: true — only Sensei can control devices
 *   - Locks/security require confirmation (handled by Arona's prompt)
 *   - All actions are logged in the audit trail
 */

import { Type } from "@sinclair/typebox";
import {
  getHAConfig,
  isHAConfigured,
  updateHAConfig,
  upsertEntity,
  removeEntity,
  findEntityByName,
  findScene,
  getRecentAudit,
  upsertScene,
  syncEntities,
  HA_DEVICE_TYPES,
  DOMAIN_TO_DEVICE_TYPE,
  SYNCABLE_DOMAINS,
  type HAEntityMapping,
  type HASceneAction,
} from "../../arona/smarthome/ha-config.js";
import {
  checkConnection,
  getEntityState,
  callService,
  discoverEntities,
  type DiscoveredEntity,
} from "../../arona/smarthome/ha-client.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

// ── Schema ─────────────────────────────────────────────────────

const HomeAssistantToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("get_devices"),
      Type.Literal("get_state"),
      Type.Literal("call_service"),
      Type.Literal("activate_scene"),
      Type.Literal("discover"),
      Type.Literal("sync"),
      Type.Literal("configure"),
      Type.Literal("check_connection"),
      Type.Literal("add_entity"),
      Type.Literal("remove_entity"),
      Type.Literal("add_scene"),
      Type.Literal("audit_log"),
    ],
    {
      description:
        "Action to perform. " +
        '"get_devices" — list configured devices and current states. ' +
        '"get_state" — get state of a specific device. ' +
        '"call_service" — control a device (turn on/off, set temperature, etc.). ' +
        '"activate_scene" — activate a predefined scene. ' +
        '"discover" — fetch all entities from Home Assistant (preview only). ' +
        '"sync" — auto-detect and import ALL devices from Home Assistant into Arona config. ' +
        '"configure" — set HA connection details (ONLY if Sensei explicitly provides new connection info — do NOT call this for normal device control). ' +
        '"check_connection" — test connection to Home Assistant. ' +
        '"add_entity" — add/update a device mapping. ' +
        '"remove_entity" — remove a device mapping. ' +
        '"add_scene" — add/update a scene definition. ' +
        '"audit_log" — view recent action history.',
    },
  ),

  entity_id: Type.Optional(
    Type.String({
      description:
        'Home Assistant entity_id (e.g. "light.living_room", "climate.bedroom"). ' +
        "Can also be a friendly name — Arona will resolve it.",
    }),
  ),

  // For call_service
  domain: Type.Optional(
    Type.String({
      description: 'Service domain (e.g. "light", "climate", "lock", "switch", "vacuum").',
    }),
  ),
  service: Type.Optional(
    Type.String({
      description:
        'Service to call (e.g. "turn_on", "turn_off", "toggle", "set_temperature", "lock", "unlock").',
    }),
  ),
  service_data: Type.Optional(Type.Unsafe<Record<string, unknown>>(Type.Object({}))),

  // ── Shorthand params for call_service (auto-merged into service_data) ──

  // Light controls
  brightness: Type.Optional(
    Type.Number({
      description: "Light brightness 0-255 (0=off, 255=max). Used with light.turn_on.",
    }),
  ),
  rgb_color: Type.Optional(
    Type.Array(Type.Number(), {
      description: "RGB color as [R, G, B] (0-255 each). E.g. [255, 0, 0] for red.",
    }),
  ),
  color_temp: Type.Optional(
    Type.Number({
      description:
        "Color temperature in mireds (153=cold white, 500=warm). Used with light.turn_on.",
    }),
  ),
  effect: Type.Optional(
    Type.String({
      description: 'Light effect name (e.g. "rainbow", "strobe", "colorloop").',
    }),
  ),
  transition: Type.Optional(
    Type.Number({
      description: "Transition duration in seconds for light changes.",
    }),
  ),

  // Climate controls
  temperature: Type.Optional(
    Type.Number({
      description: "Target temperature in degrees. Used with climate.set_temperature.",
    }),
  ),
  hvac_mode: Type.Optional(
    Type.String({
      description:
        'HVAC mode: "heat", "cool", "auto", "fan_only", "dry", "off". Used with climate.set_hvac_mode.',
    }),
  ),
  fan_mode: Type.Optional(
    Type.String({
      description: 'Fan mode: "auto", "low", "medium", "high". Used with climate.set_fan_mode.',
    }),
  ),
  preset_mode: Type.Optional(
    Type.String({
      description:
        'Climate preset: "eco", "away", "boost", "comfort", "sleep". Used with climate.set_preset_mode.',
    }),
  ),

  // Cover controls
  position: Type.Optional(
    Type.Number({
      description:
        "Cover/curtain position 0-100 (0=closed, 100=open). Used with cover.set_cover_position.",
    }),
  ),
  tilt_position: Type.Optional(
    Type.Number({
      description: "Cover tilt position 0-100. Used with cover.set_cover_tilt_position.",
    }),
  ),

  // Media player controls
  volume_level: Type.Optional(
    Type.Number({
      description: "Volume level 0.0-1.0. Used with media_player.volume_set.",
    }),
  ),
  media_content_id: Type.Optional(
    Type.String({
      description: "Media content ID or URL to play.",
    }),
  ),
  media_content_type: Type.Optional(
    Type.String({
      description: 'Media type: "music", "video", "playlist", "channel".',
    }),
  ),
  source: Type.Optional(
    Type.String({
      description:
        'Input source name (e.g. "HDMI 1", "Spotify", "TV"). Used with media_player.select_source.',
    }),
  ),

  // For activate_scene
  scene_id: Type.Optional(
    Type.String({
      description: 'Scene identifier or name (e.g. "movie_mode", "sleep_mode").',
    }),
  ),

  // For configure
  base_url: Type.Optional(
    Type.String({
      description:
        "Home Assistant base URL — use the ACTUAL configured URL from config, do NOT use example IPs. Only set this if Sensei explicitly provides a new URL.",
    }),
  ),
  access_token: Type.Optional(
    Type.String({
      description: "Home Assistant long-lived access token.",
    }),
  ),
  enabled: Type.Optional(
    Type.Boolean({
      description: "Enable or disable the Home Assistant integration.",
    }),
  ),

  // For add_entity
  friendly_name: Type.Optional(
    Type.String({
      description: 'Vietnamese friendly name for the device (e.g. "đèn phòng khách").',
    }),
  ),
  device_type: Type.Optional(
    Type.String({
      description: `Device type: ${HA_DEVICE_TYPES.join(", ")}.`,
    }),
  ),
  area: Type.Optional(
    Type.String({
      description: 'Room/area name (e.g. "phòng khách", "phòng ngủ").',
    }),
  ),

  // For sync
  remove_stale: Type.Optional(
    Type.Boolean({
      description:
        "When syncing, remove entities from Arona config that no longer exist in Home Assistant. " +
        "Default: false (only add/update, never remove).",
    }),
  ),

  // For add_scene
  scene_name: Type.Optional(
    Type.String({
      description: 'Scene display name (e.g. "Chế độ xem phim").',
    }),
  ),
  scene_actions: Type.Optional(
    Type.Array(
      Type.Object({
        domain: Type.String(),
        service: Type.String(),
        entityId: Type.String(),
        data: Type.Optional(Type.Unsafe<Record<string, unknown>>(Type.Object({}))),
      }),
      {
        description: "List of service calls for this scene.",
      },
    ),
  ),

  // For audit_log
  limit: Type.Optional(
    Type.Number({
      description: "Max number of audit entries to return. Default: 20, max: 100.",
    }),
  ),
  since_hours: Type.Optional(
    Type.Number({
      description: "Only return audit entries from the last N hours. E.g. 24 for last day.",
    }),
  ),
});

// ── Helpers ────────────────────────────────────────────────────

type Params = Record<string, unknown>;

/** HA entity_ids: `domain.object_id` — domain and object_id may contain a-z, 0-9, _ */
const HA_ENTITY_ID_RE = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;

/**
 * Resolve input to a HA entity_id.
 * Accepts a direct entity_id or a Vietnamese friendly name.
 */
function resolveEntityId(input: string): string {
  if (HA_ENTITY_ID_RE.test(input)) return input;
  const mapping = findEntityByName(input);
  return mapping ? mapping.entityId : input;
}

function domainOf(entityId: string): string {
  return entityId.split(".")[0];
}

/** Security-sensitive domains where ALL actions require confirmation. */
const SECURITY_DOMAINS = new Set(["lock", "alarm_control_panel"]);

/** Guard: require HA to be configured before proceeding. */
function requireConfigured() {
  if (!isHAConfigured()) {
    return jsonResult({
      success: false,
      error: "Home Assistant chưa được cấu hình. Dùng action 'configure' trước.",
    });
  }
  return null;
}

// ── Action handlers ───────────────────────────────────────────

async function handleConfigure(params: Params) {
  const baseUrl = readStringParam(params, "base_url");
  const accessToken = readStringParam(params, "access_token");
  const enabled = params.enabled;

  const hasUpdates =
    baseUrl !== undefined || accessToken !== undefined || typeof enabled === "boolean";

  if (!hasUpdates) {
    const cfg = getHAConfig();
    return jsonResult({
      success: true,
      config: {
        baseUrl: cfg.baseUrl,
        enabled: cfg.enabled,
        tokenSet: !!cfg.accessToken,
        entityCount: cfg.entities.length,
        sceneCount: cfg.scenes.length,
        requireConfirmForSecurity: cfg.requireConfirmForSecurity,
      },
    });
  }

  // Safety: warn and log if AI is overwriting an already-configured URL
  const currentCfg = getHAConfig();
  if (baseUrl !== undefined && currentCfg.baseUrl && currentCfg.baseUrl !== baseUrl) {
    console.warn(
      `[HA] WARNING: configure action changing baseUrl from "${currentCfg.baseUrl}" to "${baseUrl}"`,
    );
  }
  if (baseUrl !== undefined) {
    console.info(`[HA] configure: setting baseUrl to "${baseUrl}"`);
  }

  const updated = updateHAConfig({
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(accessToken !== undefined ? { accessToken } : {}),
    ...(typeof enabled === "boolean" ? { enabled } : {}),
  });

  return jsonResult({
    success: true,
    message: "Home Assistant configuration updated.",
    config: {
      baseUrl: updated.baseUrl,
      enabled: updated.enabled,
      tokenSet: !!updated.accessToken,
    },
  });
}

async function handleCheckConnection() {
  const result = await checkConnection();
  return jsonResult({ success: result.ok, message: result.message });
}

async function handleGetDevices() {
  const cfg = getHAConfig();
  if (cfg.entities.length === 0) {
    return jsonResult({
      success: true,
      devices: [],
      message:
        "Chưa có thiết bị nào được cấu hình. " +
        "Dùng action 'discover' để tìm thiết bị từ Home Assistant, " +
        "hoặc 'add_entity' để thêm thủ công.",
    });
  }

  // Fetch live states if connected
  if (isHAConfigured()) {
    try {
      const devicesWithState = await Promise.all(
        cfg.entities.map(async (e) => {
          try {
            const state = await getEntityState(e.entityId);
            return { ...e, currentState: state.state, attributes: state.attributes };
          } catch {
            return { ...e, currentState: "unknown" };
          }
        }),
      );
      return jsonResult({ success: true, devices: devicesWithState });
    } catch {
      // Fall through to config-only response
    }
  }

  return jsonResult({ success: true, devices: cfg.entities });
}

async function handleGetState(params: Params) {
  const guard = requireConfigured();
  if (guard) return guard;

  const entityInput = readStringParam(params, "entity_id", { required: true, label: "entity_id" });
  const entityId = resolveEntityId(entityInput);

  try {
    const state = await getEntityState(entityId);
    return jsonResult({
      success: true,
      entity_id: state.entity_id,
      state: state.state,
      attributes: state.attributes,
      last_changed: state.last_changed,
    });
  } catch (err) {
    return jsonResult({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Shorthand param keys that get auto-merged into service_data.
 * Only non-undefined values are merged; explicit service_data takes precedence.
 */
const SHORTHAND_SERVICE_KEYS = [
  // Light
  "brightness",
  "rgb_color",
  "color_temp",
  "effect",
  "transition",
  // Climate
  "temperature",
  "hvac_mode",
  "fan_mode",
  "preset_mode",
  // Cover
  "position",
  "tilt_position",
  // Media player
  "volume_level",
  "media_content_id",
  "media_content_type",
  "source",
] as const;

/** Build merged service_data from explicit service_data + shorthand params. */
function buildServiceData(params: Params): Record<string, unknown> | undefined {
  const explicit = (params.service_data as Record<string, unknown>) ?? {};
  const merged: Record<string, unknown> = { ...explicit };

  for (const key of SHORTHAND_SERVICE_KEYS) {
    if (params[key] !== undefined && !(key in merged)) {
      merged[key] = params[key];
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

async function handleCallService(params: Params) {
  const guard = requireConfigured();
  if (guard) return guard;

  const entityInput = readStringParam(params, "entity_id", { required: true, label: "entity_id" });
  const entityId = resolveEntityId(entityInput);
  const domain = readStringParam(params, "domain") || domainOf(entityId);
  const service = readStringParam(params, "service", { required: true, label: "service" });

  // Security gate: ALL actions on security domains require confirmation
  const cfg = getHAConfig();
  if (cfg.requireConfirmForSecurity && SECURITY_DOMAINS.has(domain)) {
    return jsonResult({
      success: false,
      requireConfirmation: true,
      message:
        `⚠️ Hành động bảo mật: ${domain}.${service} cho ${entityId}. ` +
        "Arona cần xác nhận từ Sensei trước khi thực hiện.",
      entity_id: entityId,
      domain,
      service,
    });
  }

  const serviceData = buildServiceData(params);
  const result = await callService(domain, service, entityId, serviceData);

  return jsonResult({
    success: result.success,
    ...(result.success
      ? {
          message: `Đã thực hiện ${domain}.${service} cho ${entityId}.`,
          entity_id: entityId,
          new_states: result.states?.map((s) => ({ entity_id: s.entity_id, state: s.state })),
        }
      : {
          error: result.error,
          entity_id: entityId,
        }),
  });
}

async function handleActivateScene(params: Params) {
  const guard = requireConfigured();
  if (guard) return guard;

  const sceneInput = readStringParam(params, "scene_id", { required: true, label: "scene_id" });

  // Check custom scene first
  const customScene = findScene(sceneInput);
  if (customScene) {
    const results = await Promise.all(
      customScene.actions.map(async (a) => {
        const r = await callService(a.domain, a.service, a.entityId, a.data);
        return {
          action: `${a.domain}.${a.service}`,
          entityId: a.entityId,
          success: r.success,
          ...(r.error ? { error: r.error } : {}),
        };
      }),
    );

    const allOk = results.every((r) => r.success);
    return jsonResult({
      success: allOk,
      message: allOk
        ? `Đã kích hoạt scene "${customScene.name}".`
        : `Scene "${customScene.name}" có lỗi ở một số thiết bị.`,
      scene: customScene.name,
      results,
    });
  }

  // Fallback: try as a HA scene entity
  const sceneEntityId = sceneInput.startsWith("scene.") ? sceneInput : `scene.${sceneInput}`;
  const result = await callService("scene", "turn_on", sceneEntityId);
  return jsonResult({
    success: result.success,
    message: result.success
      ? `Đã kích hoạt scene ${sceneEntityId}.`
      : `Lỗi khi kích hoạt scene: ${result.error}`,
  });
}

async function handleDiscover() {
  const guard = requireConfigured();
  if (guard) return guard;

  try {
    const entities = await discoverEntities();
    const filtered = entities.filter((e) => SYNCABLE_DOMAINS.has(e.domain));
    return jsonResult({
      success: true,
      totalEntities: entities.length,
      filteredEntities: filtered.length,
      entities: filtered.slice(0, 50),
      message:
        "Đây là danh sách thiết bị từ Home Assistant. " +
        "Dùng action 'sync' để tự động nhập TẤT CẢ vào Arona, " +
        "hoặc 'add_entity' để thêm thủ công từng thiết bị.",
    });
  } catch (err) {
    return jsonResult({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Infer HADeviceType from HA domain + device_class.
 * Special case: media_player with device_class "tv" → TV instead of SPEAKER.
 */
function inferDeviceType(entity: DiscoveredEntity): HAEntityMapping["deviceType"] {
  if (entity.domain === "media_player" && entity.deviceClass === "tv") {
    return "TV";
  }
  return DOMAIN_TO_DEVICE_TYPE[entity.domain] ?? "OTHER";
}

async function handleSync(params: Params) {
  const guard = requireConfigured();
  if (guard) return guard;

  const removeStale = params.remove_stale === true;

  try {
    const discovered = await discoverEntities();
    const syncable = discovered.filter((e) => SYNCABLE_DOMAINS.has(e.domain));

    if (syncable.length === 0) {
      return jsonResult({
        success: true,
        message: "Không tìm thấy thiết bị nào phù hợp từ Home Assistant.",
        totalFromHA: discovered.length,
        syncable: 0,
      });
    }

    // Convert discovered entities → HAEntityMapping
    const mappings: HAEntityMapping[] = syncable.map((e) => ({
      entityId: e.entityId,
      friendlyName: e.friendlyName,
      deviceType: inferDeviceType(e),
      ...(e.area ? { area: e.area } : {}),
    }));

    const result = syncEntities(mappings, removeStale);

    // Build a human-friendly summary grouped by device type
    const byType = new Map<string, string[]>();
    for (const m of mappings) {
      const list = byType.get(m.deviceType) ?? [];
      list.push(m.friendlyName);
      byType.set(m.deviceType, list);
    }
    const typeSummary = [...byType.entries()]
      .map(
        ([type, names]) =>
          `${type}: ${names.length} (${names.slice(0, 3).join(", ")}${names.length > 3 ? "..." : ""})`,
      )
      .join("; ");

    return jsonResult({
      success: true,
      message:
        `Đã đồng bộ ${mappings.length} thiết bị từ Home Assistant. ` +
        `Thêm mới: ${result.added.length}, cập nhật: ${result.updated.length}` +
        (removeStale ? `, xóa: ${result.removed.length}` : "") +
        (result.skipped.length > 0 ? `, bỏ qua: ${result.skipped.length}` : "") +
        ".",
      summary: typeSummary,
      totalFromHA: discovered.length,
      synced: mappings.length,
      added: result.added.length,
      updated: result.updated.length,
      removed: result.removed.length,
      skipped: result.skipped.length,
      ...(result.removed.length > 0 ? { removedEntities: result.removed } : {}),
    });
  } catch (err) {
    return jsonResult({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleAddEntity(params: Params) {
  const entityId = readStringParam(params, "entity_id", { required: true, label: "entity_id" });
  const friendlyName = readStringParam(params, "friendly_name", {
    required: true,
    label: "friendly_name",
  });
  const rawType = (readStringParam(params, "device_type") || "OTHER").toUpperCase();

  if (!(HA_DEVICE_TYPES as readonly string[]).includes(rawType)) {
    return jsonResult({
      success: false,
      error: `Invalid device_type "${rawType}". Must be one of: ${HA_DEVICE_TYPES.join(", ")}`,
    });
  }

  const entity: HAEntityMapping = {
    entityId,
    friendlyName,
    deviceType: rawType as HAEntityMapping["deviceType"],
    area: readStringParam(params, "area"),
  };

  upsertEntity(entity);
  return jsonResult({
    success: true,
    message: `Đã thêm/cập nhật thiết bị: ${friendlyName} (${entityId}).`,
    entity,
  });
}

async function handleRemoveEntity(params: Params) {
  const entityId = readStringParam(params, "entity_id", { required: true, label: "entity_id" });
  removeEntity(entityId);
  return jsonResult({ success: true, message: `Đã xóa thiết bị ${entityId}.` });
}

async function handleAddScene(params: Params) {
  const sceneId = readStringParam(params, "scene_id", { required: true, label: "scene_id" });
  const sceneName = readStringParam(params, "scene_name", { required: true, label: "scene_name" });
  const rawActions = params.scene_actions;

  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    return jsonResult({
      success: false,
      error: "scene_actions is required and must be a non-empty array.",
    });
  }

  // Validate each action has required fields
  const actions: HASceneAction[] = [];
  for (let i = 0; i < rawActions.length; i++) {
    const a = rawActions[i] as Record<string, unknown>;
    if (
      typeof a?.domain !== "string" ||
      typeof a?.service !== "string" ||
      typeof a?.entityId !== "string"
    ) {
      return jsonResult({
        success: false,
        error: `scene_actions[${i}] must have 'domain', 'service', and 'entityId' as strings.`,
      });
    }
    actions.push({
      domain: a.domain,
      service: a.service,
      entityId: a.entityId,
      ...(a.data && typeof a.data === "object" ? { data: a.data as Record<string, unknown> } : {}),
    });
  }

  upsertScene({ id: sceneId, name: sceneName, actions });
  return jsonResult({
    success: true,
    message: `Đã thêm/cập nhật scene: ${sceneName} (${sceneId}), ${actions.length} actions.`,
  });
}

async function handleAuditLog(params: Params) {
  const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;
  const sinceHours = readNumberParam(params, "since_hours");
  const sinceMs = sinceHours !== undefined ? Date.now() - sinceHours * 60 * 60 * 1000 : undefined;
  const entries = getRecentAudit(Math.min(limit, MAX_AUDIT_LIMIT), sinceMs);
  return jsonResult({ success: true, entries, count: entries.length });
}

const MAX_AUDIT_LIMIT = 100;

// ── Dispatch map ──────────────────────────────────────────────

type ActionHandler = (params: Params) => Promise<ReturnType<typeof jsonResult>>;

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  configure: handleConfigure,
  check_connection: handleCheckConnection,
  get_devices: handleGetDevices,
  get_state: handleGetState,
  call_service: handleCallService,
  activate_scene: handleActivateScene,
  discover: handleDiscover,
  sync: handleSync,
  add_entity: handleAddEntity,
  remove_entity: handleRemoveEntity,
  add_scene: handleAddScene,
  audit_log: handleAuditLog,
};

// ── Tool Factory ───────────────────────────────────────────────

export function createHomeAssistantTool(): AnyAgentTool {
  return {
    label: "Smart Home",
    name: "home_assistant",
    description:
      "Control smart home devices via Home Assistant. " +
      "IMPORTANT: HA connection is already pre-configured — do NOT call 'configure' unless Sensei explicitly provides a new URL or token. " +
      "For device control, just use 'call_service' directly. " +
      'Use "get_devices" to list devices, "call_service" to control them, ' +
      '"activate_scene" for predefined scenes, "sync" to auto-detect and import ALL devices from HA. ' +
      'Sensei says things like "Tắt đèn phòng khách", "Bật điều hòa 24 độ", "Cho robot hút bụi đi" — ' +
      "Arona translates to the right HA service call.",
    ownerOnly: true,
    parameters: HomeAssistantToolSchema,

    execute: async (_toolCallId, args) => {
      const params = args as Params;
      const action = readStringParam(params, "action", { required: true });
      const handler = ACTION_HANDLERS[action];
      if (!handler) {
        return jsonResult({
          success: false,
          error: `Unknown action "${action}". Valid actions: ${Object.keys(ACTION_HANDLERS).join(", ")}`,
        });
      }
      return handler(params);
    },
  };
}

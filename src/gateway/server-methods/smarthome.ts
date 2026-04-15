/**
 * gateway/server-methods/smarthome.ts
 *
 * RPC handlers for the Home Assistant smart home integration.
 * Exposes ha.config.get, ha.config.update, ha.connection.check,
 * ha.sync, and ha.audit to the dashboard UI.
 */

import {
  getHAConfig,
  updateHAConfig,
  syncEntities,
  getRecentAudit,
  isHAConfigured,
  DOMAIN_TO_DEVICE_TYPE,
  SYNCABLE_DOMAINS,
  type HAConfigUpdates,
  type HAEntityMapping,
} from "../../arona/smarthome/ha-config.js";
import { checkConnection, discoverEntities } from "../../arona/smarthome/ha-client.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

/** Redact access token for UI responses — never send the real token to the browser. */
function redactConfig(cfg: ReturnType<typeof getHAConfig>) {
  return {
    ...cfg,
    accessToken: cfg.accessToken ? "••••••••" : "",
  };
}

export const smarthomeHandlers: GatewayRequestHandlers = {
  /**
   * Get the current HA configuration (token redacted).
   * Returns: { config, configured }
   */
  "ha.config.get": async ({ respond }) => {
    try {
      const config = getHAConfig();
      respond(true, { config: redactConfig(config), configured: isHAConfigured() }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  /**
   * Update HA connection settings.
   * Params: { baseUrl?, accessToken?, enabled?, timeoutMs?, requireConfirmForSecurity? }
   * If accessToken is "••••••••" or empty, it is NOT updated (preserves existing).
   */
  "ha.config.update": async ({ params, respond }) => {
    try {
      const updates: HAConfigUpdates = {};

      if (typeof params.baseUrl === "string") {
        updates.baseUrl = params.baseUrl;
      }
      // Only update token if a real value was sent (not the redacted placeholder)
      if (
        typeof params.accessToken === "string" &&
        params.accessToken !== "" &&
        params.accessToken !== "••••••••"
      ) {
        updates.accessToken = params.accessToken;
      }
      if (typeof params.enabled === "boolean") {
        updates.enabled = params.enabled;
      }
      if (typeof params.timeoutMs === "number") {
        updates.timeoutMs = params.timeoutMs;
      }
      if (typeof params.requireConfirmForSecurity === "boolean") {
        updates.requireConfirmForSecurity = params.requireConfirmForSecurity;
      }

      if (Object.keys(updates).length === 0) {
        return respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "No valid fields to update"),
        );
      }

      const config = updateHAConfig(updates);
      respond(true, { config: redactConfig(config), configured: isHAConfigured() }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  /**
   * Test the HA connection.
   * Returns: { ok, message }
   */
  "ha.connection.check": async ({ respond }) => {
    try {
      if (!isHAConfigured()) {
        return respond(true, {
          ok: false,
          message: "Home Assistant chưa được cấu hình. Vui lòng nhập Base URL và Access Token.",
        });
      }
      const result = await checkConnection();
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  /**
   * Discover entities from HA and sync them into config.
   * Params: { removeStale? } — whether to remove entities no longer in HA.
   * Returns: { result: SyncResult, config }
   */
  "ha.sync": async ({ params, respond }) => {
    try {
      if (!isHAConfigured()) {
        return respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "Home Assistant chưa được cấu hình. Vui lòng cấu hình kết nối trước.",
          ),
        );
      }

      const discovered = await discoverEntities();
      const removeStale = params.removeStale === true;

      // Filter to syncable domains and map to HAEntityMapping
      const incoming: HAEntityMapping[] = discovered
        .filter((e) => SYNCABLE_DOMAINS.has(e.domain))
        .map((e) => ({
          entityId: e.entityId,
          friendlyName: e.friendlyName,
          deviceType: DOMAIN_TO_DEVICE_TYPE[e.domain] ?? "OTHER",
          area: e.area,
        }));

      const result = syncEntities(incoming, removeStale);
      const config = getHAConfig();

      respond(
        true,
        { result, config: redactConfig(config), configured: isHAConfigured() },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  /**
   * Get recent audit log entries.
   * Params: { limit?, sinceMs? }
   * Returns: { entries }
   */
  "ha.audit": async ({ params, respond }) => {
    try {
      const limit = typeof params.limit === "number" ? params.limit : 20;
      const sinceMs = typeof params.sinceMs === "number" ? params.sinceMs : undefined;
      const entries = getRecentAudit(limit, sinceMs);
      respond(true, { entries }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};

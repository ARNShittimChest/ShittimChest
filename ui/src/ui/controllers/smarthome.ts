import type { ShittimChestApp } from "../app.js";
import type {
  HAConfigGetResult,
  HAConfigUpdateResult,
  HAConnectionCheckResult,
  HASyncResponse,
  HAAuditResponse,
} from "../types.js";

export async function loadSmartHomeConfig(app: ShittimChestApp) {
  if (!app.client) return;
  app.smarthomeLoading = true;
  app.smarthomeError = null;
  try {
    const res = await app.client.request<HAConfigGetResult>("ha.config.get");
    app.smarthomeConfig = res;
  } catch (err: unknown) {
    app.smarthomeError = String((err as Error)?.message ?? err);
  } finally {
    app.smarthomeLoading = false;
  }
}

export async function updateSmartHomeConfig(
  app: ShittimChestApp,
  updates: Record<string, unknown>,
) {
  if (!app.client) return;
  app.smarthomeLoading = true;
  app.smarthomeError = null;
  try {
    const res = await app.client.request<HAConfigUpdateResult>("ha.config.update", updates);
    app.smarthomeConfig = res;
  } catch (err: unknown) {
    app.smarthomeError = String((err as Error)?.message ?? err);
  } finally {
    app.smarthomeLoading = false;
  }
}

export async function checkSmartHomeConnection(app: ShittimChestApp) {
  if (!app.client) return;
  app.smarthomeCheckLoading = true;
  app.smarthomeCheckResult = null;
  try {
    const res = await app.client.request<HAConnectionCheckResult>("ha.connection.check");
    app.smarthomeCheckResult = res;
  } catch (err: unknown) {
    app.smarthomeCheckResult = { ok: false, message: String((err as Error)?.message ?? err) };
  } finally {
    app.smarthomeCheckLoading = false;
  }
}

export async function syncSmartHomeDevices(app: ShittimChestApp, removeStale = false) {
  if (!app.client) return;
  app.smarthomeSyncLoading = true;
  app.smarthomeSyncResult = null;
  try {
    const res = await app.client.request<HASyncResponse>("ha.sync", { removeStale });
    app.smarthomeSyncResult = res.result;
    // Also refresh the config (entities list changed)
    app.smarthomeConfig = { config: res.config, configured: res.configured };
  } catch (err: unknown) {
    app.smarthomeError = String((err as Error)?.message ?? err);
  } finally {
    app.smarthomeSyncLoading = false;
  }
}

export async function loadSmartHomeAudit(app: ShittimChestApp, limit = 20) {
  if (!app.client) return;
  app.smarthomeAuditLoading = true;
  try {
    const res = await app.client.request<HAAuditResponse>("ha.audit", { limit });
    app.smarthomeAudit = res.entries;
  } catch (err: unknown) {
    // Non-critical, just log
    console.warn("Failed to load audit log:", err);
  } finally {
    app.smarthomeAuditLoading = false;
  }
}

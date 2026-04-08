import type { ShittimChestApp } from "../app.js";
import type { HealthConfig, HealthReminderConfig, HealthRemindersGetResult } from "../types.js";

export async function loadHealthConfig(app: ShittimChestApp) {
  if (!app.client) {
    return;
  }
  app.healthRemindersLoading = true;
  app.healthRemindersError = null;
  try {
    const res = await app.client.request<HealthRemindersGetResult>("health.config.get");
    app.healthRemindersResult = res;
  } catch (err: unknown) {
    app.healthRemindersError = String((err as Error)?.message ?? err);
  } finally {
    app.healthRemindersLoading = false;
  }
}

export async function updateHealthConfig(
  app: ShittimChestApp,
  type: keyof HealthConfig,
  enabled?: boolean,
  updates?: Partial<HealthReminderConfig>,
) {
  if (!app.client) {
    return;
  }
  app.healthRemindersLoading = true;
  app.healthRemindersError = null;
  try {
    const res = await app.client.request<HealthRemindersGetResult>("health.config.update", {
      type,
      enabled,
      updates,
    });
    app.healthRemindersResult = res;
  } catch (err: unknown) {
    app.healthRemindersError = String((err as Error)?.message ?? err);
  } finally {
    app.healthRemindersLoading = false;
  }
}

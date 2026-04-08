import {
  getHealthConfig,
  getLatestSteps,
  getHealthKitData,
  updateReminderConfig,
  toggleReminder,
  type HealthConfig,
  type HealthReminderConfig,
} from "../../arona/health/health-config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

interface HealthRemindersUpdateParams {
  type: keyof HealthConfig;
  updates?: Partial<HealthReminderConfig>;
  enabled?: boolean;
}

export const healthRemindersHandlers: GatewayRequestHandlers = {
  "health.config.get": async ({ respond }) => {
    try {
      const config = getHealthConfig();
      const steps = getLatestSteps();
      const healthKit = getHealthKitData();
      respond(true, { config, steps, healthKit }, undefined);
    } catch (err) {
      return respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "health.config.update": async ({ params, respond }) => {
    try {
      const parsedParams = params as unknown as HealthRemindersUpdateParams;
      if (!parsedParams.type || typeof parsedParams.type !== "string") {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing type"));
      }

      let updated: HealthConfig;
      if (typeof parsedParams.enabled === "boolean") {
        updated = toggleReminder(parsedParams.type, parsedParams.enabled);
      } else if (parsedParams.updates) {
        updated = updateReminderConfig(parsedParams.type, parsedParams.updates);
      } else {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing updates"));
      }

      const steps = getLatestSteps();
      const healthKit = getHealthKitData();
      respond(true, { config: updated, steps, healthKit }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};

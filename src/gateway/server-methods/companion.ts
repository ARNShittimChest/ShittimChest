/**
 * Companion handlers — exposes Arona's current emotional state,
 * weather data, and location info to the Control UI / iOS app
 * via the WebSocket gateway.
 */

import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { loadMoodState } from "../../companion/mood-persistence.js";
import { getUserLocation } from "../../arona/location-store.js";
import { getWeatherData } from "../../arona/weather/weather-store.js";
import {
  buildWeatherPromptContext,
  buildWeatherShortSummary,
} from "../../arona/weather/weather-mood.js";
import type { GatewayRequestHandlers } from "./types.js";

function resolveWorkspaceDir(): string {
  const cfg = loadConfig();
  const raw = cfg.agents?.defaults?.workspace ?? "~/.shittimchest/workspace";
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

export const companionHandlers: GatewayRequestHandlers = {
  "companion.mood": ({ respond }) => {
    try {
      const workspaceDir = resolveWorkspaceDir();
      const state = loadMoodState(workspaceDir);
      respond(true, state ?? null, undefined);
    } catch {
      respond(true, null, undefined);
    }
  },

  "companion.weather": ({ respond }) => {
    try {
      const weather = getWeatherData();
      if (!weather) {
        respond(true, null, undefined);
        return;
      }

      // Add location name if available
      const location = getUserLocation();
      if (location?.place) {
        weather.locationName = location.place.displayName;
      }

      respond(
        true,
        {
          current: weather.current,
          forecast: weather.forecast,
          locationName: weather.locationName,
          source: weather.source,
          fetchedAt: weather.fetchedAt,
          shortSummary: buildWeatherShortSummary(weather),
          promptContext: buildWeatherPromptContext(weather),
        },
        undefined,
      );
    } catch {
      respond(true, null, undefined);
    }
  },

  "companion.location": ({ respond }) => {
    try {
      const location = getUserLocation();
      if (!location) {
        respond(true, null, undefined);
        return;
      }

      respond(
        true,
        {
          lat: location.lat,
          lon: location.lon,
          updatedAt: location.updatedAt.toISOString(),
          place: location.place,
          placeUpdatedAt: location.placeUpdatedAt?.toISOString() ?? null,
        },
        undefined,
      );
    } catch {
      respond(true, null, undefined);
    }
  },
};

/**
 * Companion mood handler — exposes Arona's current emotional state
 * to the Control UI via the WebSocket gateway.
 */

import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { loadMoodState } from "../../companion/mood-persistence.js";
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
};

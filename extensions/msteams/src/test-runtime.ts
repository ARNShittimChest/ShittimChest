import os from "node:os";
import path from "node:path";
import type { PluginRuntime } from "shittimchest/plugin-sdk";

export const msteamsRuntimeStub = {
  state: {
    resolveStateDir: (env: NodeJS.ProcessEnv = process.env, homedir?: () => string) => {
      const override = env.SHITTIMCHEST_STATE_DIR?.trim() || env.SHITTIMCHEST_STATE_DIR?.trim();
      if (override) {
        return override;
      }
      const resolvedHome = homedir ? homedir() : os.homedir();
      return path.join(resolvedHome, ".shittimchest");
    },
  },
} as unknown as PluginRuntime;

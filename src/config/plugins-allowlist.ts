import type { ShittimChestConfig } from "./config.js";

export function ensurePluginAllowlisted(cfg: ShittimChestConfig, pluginId: string): ShittimChestConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}

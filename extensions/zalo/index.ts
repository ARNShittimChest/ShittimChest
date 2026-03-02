import type { ShittimChestPluginApi } from "shittimchest/plugin-sdk";
import { emptyPluginConfigSchema } from "shittimchest/plugin-sdk";
import { zaloDock, zaloPlugin } from "./src/channel.js";
import { handleZaloWebhookRequest } from "./src/monitor.js";
import { setZaloRuntime } from "./src/runtime.js";

const plugin = {
  id: "zalo",
  name: "Zalo",
  description: "Zalo channel plugin (Bot API)",
  configSchema: emptyPluginConfigSchema(),
  register(api: ShittimChestPluginApi) {
    setZaloRuntime(api.runtime);
    api.registerChannel({ plugin: zaloPlugin, dock: zaloDock });
    api.registerHttpHandler(handleZaloWebhookRequest);
  },
};

export default plugin;

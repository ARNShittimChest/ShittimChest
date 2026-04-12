import { defineConfig } from "tsdown";

const env = {
  NODE_ENV: "production",
};

export default defineConfig([
  {
    // Main entry points that all share the default outDir (dist/).
    entry: [
      "src/index.ts",
      "src/entry.ts",
      "src/cli/daemon-cli.ts",
      "src/infra/warning-filter.ts",
      "src/extensionAPI.ts",
      "src/hooks/bundled/*/handler.ts",
      "src/hooks/llm-slug-generator.ts",
    ],
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: ["src/plugin-sdk/index.ts", "src/plugin-sdk/account-id.ts"],
    outDir: "dist/plugin-sdk",
    env,
    fixedExtension: false,
    platform: "node",
  },
]);

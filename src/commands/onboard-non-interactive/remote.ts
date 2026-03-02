import { formatCliCommand } from "../../cli/command-format.js";
import type { ShittimChestConfig } from "../../config/config.js";
import { writeConfigFile } from "../../config/config.js";
import { logConfigUpdated } from "../../config/logging.js";
import type { RuntimeEnv } from "../../runtime.js";
import { applyWizardMetadata } from "../onboard-helpers.js";
import type { OnboardOptions } from "../onboard-types.js";

export async function runNonInteractiveOnboardingRemote(params: {
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  baseConfig: ShittimChestConfig;
}) {
  const { opts, runtime, baseConfig } = params;
  const mode = "remote" as const;

  const remoteUrl = opts.remoteUrl?.trim();
  if (!remoteUrl) {
    runtime.error("Missing --remote-url for remote mode.");
    runtime.exit(1);
    return;
  }

  let nextConfig: ShittimChestConfig = {
    ...baseConfig,
    gateway: {
      ...baseConfig.gateway,
      mode: "remote",
      remote: {
        url: remoteUrl,
        token: opts.remoteToken?.trim() || undefined,
      },
    },
  };
  nextConfig = applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await writeConfigFile(nextConfig);
  logConfigUpdated(runtime);

  const payload = {
    mode,
    remoteUrl,
    auth: opts.remoteToken ? "token" : "none",
  };
  if (opts.json) {
    runtime.log(JSON.stringify(payload, null, 2));
  } else {
    runtime.log(`Remote gateway: ${remoteUrl}`);
    runtime.log(`Auth: ${payload.auth}`);
    runtime.log(
      `Tip: run \`${formatCliCommand("shittimchest configure --section web")}\` to store your Brave API key for web_search. Docs: https://docs.shittimchest.ai/tools/web`,
    );
  }
}

/**
 * Onboarding step: Configure AI-based emotional analysis for the companion system.
 *
 * Reuses the existing model picker (same UI as main model selection)
 * so users can pick any provider + model they have configured.
 * If skipped → regex fallback is used automatically.
 */

import type { ShittimChestConfig } from "../config/config.js";
import type { WizardPrompter } from "../wizard/prompts.js";

export async function setupCompanionAnalysis(
  config: ShittimChestConfig,
  prompter: WizardPrompter,
): Promise<ShittimChestConfig> {
  const providers = config.models?.providers;
  const providerIds = providers ? Object.keys(providers) : [];

  if (providerIds.length === 0) {
    return config;
  }

  await prompter.note(
    [
      "Arona can use a lightweight AI model to understand the emotional",
      "meaning of your messages — detecting praise, frustration, jokes, etc.",
      "This makes her mood reactions more natural and accurate.",
      "",
      "It will reuse an existing provider you already configured (no extra API key).",
      "If skipped, Arona will use keyword-based pattern matching instead.",
    ].join("\n"),
    "🧠 Companion — AI Emotional Analysis",
  );

  const enable = await prompter.confirm({
    message: "Enable AI-based emotional analysis?",
    initialValue: false,
  });

  if (!enable) {
    return config;
  }

  // Reuse the same model picker as the main onboarding flow
  const { promptDefaultModel } = await import("./model-picker.js");

  const modelSelection = await promptDefaultModel({
    config,
    prompter,
    allowKeep: false,
    includeVllm: false,
    ignoreAllowlist: true,
    message: "Pick a lightweight model for emotional analysis",
  });

  if (!modelSelection.model) {
    return config;
  }

  // Extract provider from the "provider/model" format
  const slashIdx = modelSelection.model.indexOf("/");
  const provider = slashIdx > 0 ? modelSelection.model.slice(0, slashIdx) : modelSelection.model;
  const model = slashIdx > 0 ? modelSelection.model.slice(slashIdx + 1) : modelSelection.model;

  return {
    ...config,
    companion: {
      ...config.companion,
      affectionAnalysis: {
        enabled: true,
        provider,
        model,
      },
    },
  };
}

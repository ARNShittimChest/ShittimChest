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

/**
 * Onboarding step: Configure smart model routing for the companion system.
 *
 * Allows configuring per-tier models: "chat" tier gets a fast/cheap model,
 * "knowledge" tier can optionally use a different model, and "action" tier
 * always uses the primary model.
 *
 * When disabled, all queries use the single primary model (default behavior).
 */
export async function setupSmartRouting(
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
      "Smart routing automatically detects query complexity and routes",
      "each query to the most appropriate model:",
      "",
      "  • Chat tier — greetings, emotions, small talk → fast/cheap model",
      "  • Knowledge tier — explanations, advice, Q&A → configurable model",
      "  • Action tier — code, files, tools → always uses primary model",
      "",
      "This reduces token cost (~60-70%) and gives near-instant replies",
      "for casual messages. Disable to use a single model for everything.",
    ].join("\n"),
    "⚡ Companion — Smart Model Routing",
  );

  const enable = await prompter.confirm({
    message: "Enable smart model routing?",
    initialValue: false,
  });

  if (!enable) {
    return {
      ...config,
      companion: {
        ...config.companion,
        smartRouting: { enabled: false },
      },
    };
  }

  const { promptDefaultModel } = await import("./model-picker.js");

  // ── Chat tier model ────────────────────────────────────────────
  await prompter.note(
    [
      "Pick a fast, lightweight model for casual conversations.",
      "This model will handle greetings, emotions, and small talk.",
      "Recommended: gemini-2.0-flash, gpt-4o-mini, or a small local model.",
    ].join("\n"),
    "💬 Chat Tier Model",
  );

  const chatSelection = await promptDefaultModel({
    config,
    prompter,
    allowKeep: false,
    includeVllm: false,
    ignoreAllowlist: true,
    message: "Pick the model for the chat tier (fast/cheap)",
  });

  if (!chatSelection.model) {
    return config;
  }

  const chatSlashIdx = chatSelection.model.indexOf("/");
  const chatProvider =
    chatSlashIdx > 0 ? chatSelection.model.slice(0, chatSlashIdx) : chatSelection.model;
  const chatModel =
    chatSlashIdx > 0 ? chatSelection.model.slice(chatSlashIdx + 1) : chatSelection.model;

  // ── Knowledge tier model (optional) ────────────────────────────
  const configureKnowledge = await prompter.confirm({
    message: "Configure a separate model for the knowledge tier? (otherwise uses primary)",
    initialValue: false,
  });

  let knowledgeConfig: { provider?: string; model?: string } | undefined;

  if (configureKnowledge) {
    await prompter.note(
      [
        "Pick a model for knowledge queries (explanations, advice, Q&A).",
        "This model does NOT need tools — just strong reasoning.",
        "Leave as primary model if unsure.",
      ].join("\n"),
      "📚 Knowledge Tier Model",
    );

    const knowledgeSelection = await promptDefaultModel({
      config,
      prompter,
      allowKeep: false,
      includeVllm: false,
      ignoreAllowlist: true,
      message: "Pick the model for the knowledge tier",
    });

    if (knowledgeSelection.model) {
      const kSlashIdx = knowledgeSelection.model.indexOf("/");
      knowledgeConfig = {
        provider:
          kSlashIdx > 0 ? knowledgeSelection.model.slice(0, kSlashIdx) : knowledgeSelection.model,
        model:
          kSlashIdx > 0 ? knowledgeSelection.model.slice(kSlashIdx + 1) : knowledgeSelection.model,
      };
    }
  }

  // ── Routing classifier (optional LLM) ──────────────────────────
  await prompter.note(
    [
      "The routing classifier analyzes each message to decide which tier to use.",
      "",
      "  • Heuristic only — keyword-based, instant (0ms), free",
      "  • LLM-assisted — small model for ambiguous queries (~200ms)",
      "    More accurate for Vietnamese and mixed-language messages.",
      "    Only triggers when the heuristic is unsure (falls back safely).",
    ].join("\n"),
    "🤖 Routing Classifier",
  );

  const enableClassifier = await prompter.confirm({
    message: "Use LLM-assisted routing classifier?",
    initialValue: false,
  });

  let classifierConfig:
    | { enabled: boolean; provider?: string; model?: string; timeoutMs?: number }
    | undefined;

  if (enableClassifier) {
    await prompter.note(
      [
        "Pick a small, fast model for query classification.",
        "Recommended: gemini-2.0-flash-lite, gpt-4o-mini",
        "This model only outputs a single word (chat/knowledge/action).",
      ].join("\n"),
      "🤖 Classifier Model",
    );

    const classifierSelection = await promptDefaultModel({
      config,
      prompter,
      allowKeep: false,
      includeVllm: false,
      ignoreAllowlist: true,
      message: "Pick the model for routing classification",
    });

    if (classifierSelection.model) {
      const cSlashIdx = classifierSelection.model.indexOf("/");
      classifierConfig = {
        enabled: true,
        provider:
          cSlashIdx > 0 ? classifierSelection.model.slice(0, cSlashIdx) : classifierSelection.model,
        model:
          cSlashIdx > 0
            ? classifierSelection.model.slice(cSlashIdx + 1)
            : classifierSelection.model,
        timeoutMs: 300,
      };
    }
  }

  return {
    ...config,
    companion: {
      ...config.companion,
      smartRouting: {
        enabled: true,
        chat: { provider: chatProvider, model: chatModel },
        ...(knowledgeConfig ? { knowledge: knowledgeConfig } : {}),
        ...(classifierConfig ? { classifier: classifierConfig } : {}),
      },
    },
  };
}

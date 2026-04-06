import { createSubsystemLogger } from "../logging/subsystem.js";
import { completeSimple } from "@mariozechner/pi-ai";
import { resolveDefaultModelForAgent } from "./model-selection.js";
import { getApiKeyForModel } from "./model-auth.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import { getMemorySearchManager } from "../memory/index.js";
import type { MemoryIndexManager } from "../memory/manager.js";
import type { ShittimChestConfig } from "../config/config.js";

const log = createSubsystemLogger("memory-reflect");

/** Number of recent chat_log entries to pull per reflection run */
const REFLECT_BATCH_SIZE = 50;
/** Marker category stored in LanceDB to track last reflection timestamp */
const REFLECT_MARKER_SOURCE = "__reflect_marker__";

export async function runMemoryReflection(cfg: ShittimChestConfig, agentId: string) {
  log.info(`Starting scheduled memory reflection for agent ${agentId}`);

  // Resolve the LLM model to use for summarization
  const modelRef = resolveDefaultModelForAgent({ cfg, agentId });
  if (!modelRef) {
    log.warn("Cannot run memory reflection: No suitable model configured.");
    return;
  }

  const { manager, error } = await getMemorySearchManager({ cfg, agentId });
  if (!manager) {
    log.warn(`Cannot run memory reflection: Memory manager unavailable (${error})`);
    return;
  }

  const indexManager = manager as MemoryIndexManager;

  const lanceDbProvider = indexManager.getLanceDbProvider();
  if (!lanceDbProvider) {
    log.info("LanceDB not enabled or unavailable, skipping deep memory reflection.");
    return;
  }

  const embeddingProvider = indexManager.getEmbeddingProvider();
  if (!embeddingProvider) {
    log.warn(
      "Embedding provider is unavailable, cannot compute new memory vectors. Skipping reflection.",
    );
    return;
  }

  // Resolve model auth
  const resolved = resolveModel(modelRef.provider, modelRef.model, undefined, cfg);
  if (!resolved.model) {
    log.warn(`Cannot run memory reflection: ${resolved.error ?? "Unknown model"}`);
    return;
  }
  const auth = await getApiKeyForModel({ model: resolved.model, cfg });
  const apiKey = auth.apiKey;
  if (!apiKey) {
    log.warn(`Cannot run memory reflection: No API key for model ${resolved.model.id}`);
    return;
  }

  try {
    log.info("Aggregating recent chat logs for reflection...");

    // Pull the most recent chat_log entries for summarization.
    // We use a broad semantic search on "user preferences habits conversation" to pull
    // recent conversation chunks as a best-effort batch without a full table scan.
    const queryVec = await embeddingProvider
      .embedQuery("user preferences habits personality conversation")
      .catch(() => null);

    if (!queryVec || queryVec.length === 0) {
      log.warn("Cannot embed reflect query; skipping.");
      return;
    }

    const recentLogs = await lanceDbProvider.search(queryVec, REFLECT_BATCH_SIZE, {
      category: "chat_log",
    });

    if (recentLogs.length === 0) {
      log.info("No chat_log entries found; skipping reflection.");
      return;
    }

    // Build text for LLM summarization
    const chatText = recentLogs.map((r) => `[${r.entry.role}]: ${r.entry.text}`).join("\n");

    const prompt = `You are an AI memory summarization agent. Read the following recent conversation transcript and extract:
1. Key facts about the user (preferences, habits, personality traits, interests, dislikes)
2. Any important decisions or ongoing projects mentioned
3. Any commitments or reminders that were made

Format your response as a concise bulleted list of facts. Each fact should start with the entity it describes, e.g.:
- Sensei prefers TypeScript over Java
- Sensei wakes up at 6am daily
- Project X needs a deadline review

If there is nothing meaningful to summarize, respond with exactly: NONE

Conversation:
${chatText}`;

    log.debug(`Sending ${recentLogs.length} chat_log entries to LLM for reflection...`);

    const response = await completeSimple(
      resolved.model,
      {
        messages: [
          {
            role: "user",
            content: prompt.trim(),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        temperature: 0.1, // Low temperature for factual extraction
      },
    );

    const summary = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text.trim())
      .join("\n")
      .trim();

    if (!summary || summary === "NONE") {
      log.info("Memory reflection produced no new facts.");
      return;
    }

    log.debug(`Memory reflection summary:\n${summary}`);

    // Embed and store the entity summary
    const summaryText = `Memory Reflection Summary:\n${summary}`;
    const summaryVec = await embeddingProvider.embedQuery(summaryText).catch(() => []);

    await lanceDbProvider.store({
      role: "system",
      text: summaryText,
      vector: summaryVec,
      source_file: REFLECT_MARKER_SOURCE,
      category: "entity_summary",
      // High importance so these reflections surface first in searches
      importance: 1.8,
    });

    log.info("Memory reflection completed: entity_summary stored in LanceDB.");
  } catch (err) {
    log.error(`Memory reflection failed: ${String(err)}`);
  }
}

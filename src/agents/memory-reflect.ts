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
const REFLECT_BATCH_SIZE = 80;
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
      .embedQuery("user preferences habits personality conversation decisions projects")
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

    // Also pull existing entity_summary entries to avoid re-extracting known facts
    const existingSummaries = await lanceDbProvider.search(queryVec, 10, {
      category: "entity_summary",
    });
    const knownFacts =
      existingSummaries.length > 0
        ? existingSummaries
            .map((r) => r.entry.text.replace(/^Memory Reflection Summary:\n?/i, "").trim())
            .join("\n")
        : "";

    // Build text for LLM summarization
    const chatText = recentLogs.map((r) => `[${r.entry.role}]: ${r.entry.text}`).join("\n");

    const knownFactsSection =
      knownFacts.length > 0
        ? `\n\n## Already Known Facts (do NOT repeat these, only extract NEW information):\n${knownFacts}`
        : "";

    const prompt = `You are an AI memory consolidation agent for "Arona", a personal AI companion. Your job is to analyze recent conversations with the user ("Sensei") and extract knowledge that will help Arona remember and serve Sensei better across sessions.

Write all extracted facts in the same language Sensei primarily uses in the conversations below. If Sensei mixes languages, use the dominant one.

## Extract these types of information:

### 1. Key Facts About Sensei [fact/preference]
Personal preferences, daily routines, personality traits, values, communication patterns.
- GOOD: "[preference] Sensei always uses dark mode and dislikes bright UI themes"
- GOOD: "[fact] Sensei lives in Ho Chi Minh City, works as a backend developer"
- GOOD: "[habit] Sensei usually codes late at night (22:00-2:00) and sleeps until 9:00"
- BAD: "[fact] Sensei has preferences" (too vague, says nothing specific)
- BAD: "[fact] Sensei is tired today" (temporary state, not a persistent fact)

### 2. Ongoing Context [project/context]
Active projects, decisions made, goals, problems being worked on.
- GOOD: "[project] Sensei is building a Discord bot with TypeScript + Bun, currently implementing slash commands"
- GOOD: "[context] Sensei decided to use PostgreSQL over MongoDB for the new project — values strong typing"
- BAD: "[project] Sensei is working on something" (no detail)

### 3. Relationship Context [preference/context]
What makes Sensei happy/annoyed, inside jokes, interaction preferences.
- GOOD: "[preference] Sensei likes when Arona explains code step-by-step, dislikes long walls of text"
- GOOD: "[context] Sensei and Arona have a running joke about Arona's love for strawberry milk"
- BAD: "[preference] Sensei likes to chat" (too generic)

### 4. Cross-Session Continuity [context]
Unfinished conversations, follow-ups, promises.
- GOOD: "[context] Sensei asked about deploying to Railway but conversation was interrupted — needs follow-up"
- GOOD: "[context] Arona promised to remind Sensei about the dentist appointment next Tuesday"

### 5. Emotional Bond Evolution [bond]
Relationship progression, emotional patterns, connection moments, friction points.
Describe the EMOTIONAL QUALITY, not just events.
- GOOD: "[bond] Sensei opened up about feeling stressed at work — first time sharing personal feelings with Arona. Seemed relieved to talk about it"
- GOOD: "[bond] Sensei has started teasing Arona playfully, reciprocates when Arona shows affection — bond is growing naturally"
- GOOD: "[bond] Sensei was cold and dismissive for 3 messages after Arona gave unsolicited advice — note: avoid giving advice unless asked"
- BAD: "[bond] Sensei mentioned stress" (just an event, no emotional quality)
- BAD: "[bond] The relationship is good" (no evidence, no specifics)

## Critical Rules:
- Start each fact with a category marker: [fact/project/preference/habit/context/bond]
- ONLY extract PERSISTENT traits and ongoing context — skip temporary states
  - "Sensei is hungry right now" → SKIP (temporary)
  - "Sensei prefers to eat lunch around 12:30" → EXTRACT (persistent habit)
- If something CONTRADICTS a known fact, note the update: "[fact] UPDATE: Sensei switched from VS Code to Cursor (previously used VS Code)"
- Include temporal context: "As of [date], Sensei is working on..."
- Maximum 15 facts per reflection — quality over quantity
- If nothing meaningful to extract, respond with exactly: NONE
${knownFactsSection}

## Recent Conversation (${recentLogs.length} messages):
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

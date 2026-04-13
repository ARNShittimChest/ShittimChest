import { createSubsystemLogger } from "../logging/subsystem.js";
import { completeSimple } from "@mariozechner/pi-ai";
import { resolveDefaultModelForAgent } from "./model-selection.js";
import { getApiKeyForModel } from "./model-auth.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import type { ShittimChestConfig } from "../config/config.js";
import type { MemoryIndexManager } from "../memory/manager.js";

const log = createSubsystemLogger("sensei-profiler");

// ── Profile Category Types ─────────────────────────────────────

export type ProfileCategory =
  | "personality" // core traits, temperament, values
  | "preferences" // likes, dislikes, aesthetic, food, music
  | "communication" // language style, emoji usage, tone patterns
  | "habits" // daily routines, schedules, work patterns
  | "interests" // hobbies, topics they enjoy discussing
  | "relationships" // how they relate to others, social style
  | "emotional" // emotional patterns, triggers, coping
  | "technical"; // tech preferences, coding style, tools

const ALL_CATEGORIES: ProfileCategory[] = [
  "personality",
  "preferences",
  "communication",
  "habits",
  "interests",
  "relationships",
  "emotional",
  "technical",
];

/**
 * Triggers a background job to analyze recent user messages and extract profile information.
 * Enhanced: structured categories, deduplication-aware, conversation context tracking.
 *
 * This runs with a low priority to avoid blocking the main AI thread.
 */
export class SenseiProfiler {
  private messageBuffer: Array<{ text: string; timestamp: number }> = [];
  private readonly batchSize: number;
  private readonly enabled: boolean;
  /** Track total messages seen for adaptive profiling. */
  private totalMessagesSeen = 0;
  /** Recent profile insights (last 10) for dedup context. */
  private recentInsights: string[] = [];

  constructor(
    private readonly cfg: ShittimChestConfig,
    private readonly agentId: string,
    private readonly memoryManager: MemoryIndexManager,
  ) {
    this.enabled = this.cfg.memory?.lancedb?.profileSensei?.enabled ?? true;
    this.batchSize = this.cfg.memory?.lancedb?.profileSensei?.batchSize ?? 8;
  }

  /**
   * Add a user message to the buffer. If the buffer is full, trigger analysis.
   * This method is fast and non-blocking.
   */
  addMessage(text: string) {
    if (!this.enabled) return;

    this.totalMessagesSeen++;
    this.messageBuffer.push({ text, timestamp: Date.now() });

    if (this.messageBuffer.length >= this.batchSize) {
      const batchToAnalyze = [...this.messageBuffer];
      this.messageBuffer = []; // Clear immediately

      // Run asynchronously in the background
      setTimeout(() => {
        this.analyzeBatch(batchToAnalyze).catch((err) => {
          log.warn(`Sensei profiling failed: ${String(err)}`);
        });
      }, 0);
    }
  }

  /**
   * Get a concise summary of the latest known Sensei profile traits.
   * Queries LanceDB for the most recent sensei_profile entries and returns
   * a formatted string suitable for system prompt injection.
   *
   * Returns null if no profile data exists or LanceDB is unavailable.
   */
  async getProfileSummary(maxEntries = 5): Promise<string | null> {
    const lanceDb = this.memoryManager.getLanceDbProvider();
    const embeddingProvider = this.memoryManager.getEmbeddingProvider();
    if (!lanceDb || !embeddingProvider) return null;

    try {
      const queryVec = await embeddingProvider
        .embedQuery("Sensei personality traits preferences habits communication style interests")
        .catch(() => null);
      if (!queryVec || queryVec.length === 0) return null;

      const results = await lanceDb.search(queryVec, maxEntries * 2, {
        category: "sensei_profile",
        minScore: 0.4,
      });
      if (results.length === 0) return null;

      // Sort by importance × recency (more recent = higher priority)
      const now = Date.now();
      results.sort((a, b) => {
        const aAge = Math.max(1, (now - a.entry.createdAt) / (1000 * 3600 * 24)); // days
        const bAge = Math.max(1, (now - b.entry.createdAt) / (1000 * 3600 * 24));
        const aScore = (a.entry.importance * a.score) / Math.log2(1 + aAge);
        const bScore = (b.entry.importance * b.score) / Math.log2(1 + bAge);
        return bScore - aScore;
      });

      // Extract text, deduplicate, and format
      const seen = new Set<string>();
      const traits: string[] = [];
      for (const r of results.slice(0, maxEntries)) {
        // Strip the "Sensei Profile Insight: " prefix
        const text = r.entry.text
          .replace(/^Sensei Profile Insight:\s*/i, "")
          .replace(/^Profile \[.*?\]:\s*/i, "")
          .trim();
        // Simple dedup by first 60 chars
        const key = text.slice(0, 60).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        traits.push(text);
      }

      if (traits.length === 0) return null;

      return ["[Sensei Profile — learned from conversations]", ...traits.map((t) => `• ${t}`)].join(
        "\n",
      );
    } catch (err) {
      log.debug(`Profile summary fetch failed: ${String(err)}`);
      return null;
    }
  }

  private async analyzeBatch(messages: Array<{ text: string; timestamp: number }>) {
    if (!this.enabled || messages.length === 0) return;

    const modelRef = resolveDefaultModelForAgent({
      cfg: this.cfg,
      agentId: this.agentId,
    });

    if (!modelRef) {
      log.warn("Cannot run sensei profiler: No active AI model configured.");
      return;
    }

    const resolved = resolveModel(modelRef.provider, modelRef.model, undefined, this.cfg);
    if (!resolved.model) {
      log.warn(`Cannot run sensei profiler: ${resolved.error ?? "Unknown model"}`);
      return;
    }

    const auth = await getApiKeyForModel({ model: resolved.model, cfg: this.cfg });
    const apiKey = auth.apiKey;
    if (!apiKey) {
      log.warn(`Cannot run sensei profiler: No API key found for model ${resolved.model.id}`);
      return;
    }

    // Build dedup context from recent insights
    const dedupContext =
      this.recentInsights.length > 0
        ? `\n\nAlready known (do NOT repeat these):\n${this.recentInsights.map((i) => `- ${i.slice(0, 100)}`).join("\n")}`
        : "";

    const categoryList = ALL_CATEGORIES.map((c) => `  - ${c}`).join("\n");

    const prompt = `You are a background profiling agent for "Arona", an AI companion. Analyze the user's ("Sensei's") recent messages and extract NEW persistent profile insights.

## Categories (extract with [category] prefix):

- [personality]: Core traits, temperament, values — e.g., "[personality] Introverted, prefers deep 1-on-1 conversations over group chat"
- [preferences]: Likes, dislikes, aesthetic, food, music — e.g., "[preferences] Loves lo-fi music while coding, dislikes pop"
- [communication]: Language style, emoji usage, tone, formality — e.g., "[communication] Mixes Vietnamese and English mid-sentence, uses '~' and 'nha' at sentence endings"
- [habits]: Daily routines, schedules, work patterns — e.g., "[habits] Codes from 22:00-2:00, takes lunch at 12:30, skips breakfast"
- [interests]: Hobbies, topics they enjoy discussing — e.g., "[interests] Deep into gacha games (Blue Archive, Genshin), follows competitive programming"
- [relationships]: Social style, how they relate to others — e.g., "[relationships] Talks about coworkers rarely, seems to have a close friend named Minh"
- [emotional]: Emotional patterns, triggers, coping — e.g., "[emotional] Gets frustrated when things break silently, calms down by listening to music"
- [technical]: Tech preferences, coding style, tools — e.g., "[technical] Uses Neovim + tmux, prefers TypeScript over JavaScript, fan of functional patterns"

## Critical Rules:

### What to extract (PERSISTENT traits):
- "Sensei prefers short replies" → EXTRACT ✓
- "Sensei always uses English for technical terms" → EXTRACT ✓
- "Sensei gets stressed about deadlines every week" → EXTRACT ✓ (recurring pattern)

### What NOT to extract (TEMPORARY states):
- "Sensei is tired right now" → SKIP ✗ (momentary state)
- "Sensei is eating lunch" → SKIP ✗ (current activity)
- "Sensei seems happy today" → SKIP ✗ (today's mood, not a trait)

### Quality standards:
- Each fact starts with [category] tag
- Be specific and concrete — not "Sensei likes games" but "[interests] Plays Blue Archive daily, follows meta guides on YouTube"
- Note language and cultural context clues (politeness markers, code-switching, formality level)
- Capture communication STYLE patterns (sentence length, emoji usage, formality, language mixing)
- Track emotional patterns (what consistently makes them happy/frustrated/excited)
- Mark uncertain observations: "[personality] (likely) Tends to avoid conflict — changed topic when disagreement arose"
- Maximum 5 facts per batch — quality over quantity
- If nothing NEW or meaningful, respond with exactly: NONE
${dedupContext}

## Messages (${messages.length} recent):
${messages.map((m) => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.text}`).join("\n")}`;

    try {
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
          temperature: 0.15, // Slightly lower for more factual extraction
        },
      );

      const extractedText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text.trim())
        .join("\n")
        .trim();

      if (
        extractedText &&
        extractedText !== "NONE" &&
        !extractedText.toLowerCase().includes("no information") &&
        !extractedText.toLowerCase().includes("nothing new")
      ) {
        log.debug(`Extracted Sensei profile data: ${extractedText}`);

        const lanceDb = this.memoryManager.getLanceDbProvider();
        if (!lanceDb) {
          // Fallback: write to file-based memory when LanceDB is unavailable
          const fileFallback = this.memoryManager.getFileMemoryFallback();
          if (fileFallback) {
            const facts = extractedText
              .split("\n")
              .map((line) => line.replace(/^[-•*]\s*/, "").trim())
              .filter((line) => line.length > 5);
            for (const fact of facts) {
              const categoryMatch = fact.match(/^\[(\w+)\]\s*/);
              const category = categoryMatch?.[1]?.toLowerCase() ?? "other";
              const cleanFact = categoryMatch ? fact.slice(categoryMatch[0].length) : fact;
              await fileFallback.storeProfileInsight(category, cleanFact);
              this.recentInsights.push(cleanFact);
            }
            if (this.recentInsights.length > 15) {
              this.recentInsights = this.recentInsights.slice(-15);
            }
          } else {
            log.debug(
              "SenseiProfiler: neither lanceDb nor file fallback available to store profile insight.",
            );
          }
          return;
        }
        const provider = this.memoryManager.getEmbeddingProvider();

        // Parse individual facts if they have category tags
        const facts = extractedText
          .split("\n")
          .map((line) => line.replace(/^[-•*]\s*/, "").trim())
          .filter((line) => line.length > 5);

        if (facts.length === 0) return;

        // Store each fact separately for better retrieval granularity
        for (const fact of facts) {
          const categoryMatch = fact.match(/^\[(\w+)\]\s*/);
          const category = categoryMatch?.[1]?.toLowerCase() ?? "other";
          const cleanFact = categoryMatch ? fact.slice(categoryMatch[0].length) : fact;

          const textToEmbed = `Profile [${category}]: ${cleanFact}`;
          const vector = provider ? await provider.embedQuery(textToEmbed).catch(() => []) : [];

          await lanceDb.store({
            role: "system",
            category: "sensei_profile",
            importance: 2.0,
            source_file: `profiler/${category}`,
            text: textToEmbed,
            vector,
          });

          // Track for dedup in next batch
          this.recentInsights.push(cleanFact);
        }

        // Keep only last 15 insights for dedup context
        if (this.recentInsights.length > 15) {
          this.recentInsights = this.recentInsights.slice(-15);
        }
      }
    } catch (err) {
      log.warn(`Sensei profiling failed during model execution: ${String(err)}`);
    }
  }
}

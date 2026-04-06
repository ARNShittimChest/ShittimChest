import { createSubsystemLogger } from "../logging/subsystem.js";
import { completeSimple } from "@mariozechner/pi-ai";
import { resolveDefaultModelForAgent } from "./model-selection.js";
import { getApiKeyForModel } from "./model-auth.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import type { ShittimChestConfig } from "../config/config.js";
import type { MemoryIndexManager } from "../memory/manager.js";

const log = createSubsystemLogger("sensei-profiler");

/**
 * Triggers a background job to analyze recent user messages and extract profile information.
 * This runs with a low priority to avoid blocking the main AI thread.
 */
export class SenseiProfiler {
  private messageBuffer: string[] = [];
  private readonly batchSize: number;
  private readonly enabled: boolean;

  constructor(
    private readonly cfg: ShittimChestConfig,
    private readonly agentId: string,
    private readonly memoryManager: MemoryIndexManager,
  ) {
    this.enabled = this.cfg.memory?.lancedb?.profileSensei?.enabled ?? true;
    this.batchSize = this.cfg.memory?.lancedb?.profileSensei?.batchSize ?? 10;
  }

  /**
   * Add a user message to the buffer. If the buffer is full, trigger analysis.
   * This method is fast and non-blocking.
   */
  addMessage(text: string) {
    if (!this.enabled) return;

    this.messageBuffer.push(text);
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

  private async analyzeBatch(messages: string[]) {
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

    const prompt = `
You are a background profiling agent. Your job is to analyze the user's latest chat messages and extract persistent profile information about them.
We refer to the user as "Sensei".

Extract any facts relating to:
1. Sensei's personal preferences (likes, dislikes)
2. Sensei's communication style (e.g., uses short sentences, uses emoji)
3. Sensei's habits, schedules, or routines
4. Any other persistent traits or personal facts.

If you don't find anything worth noting, respond with exactly: NONE

Otherwise, provide a concise summary of the traits found.
Messages:
${messages.map((m) => `- ${m}`).join("\n")}
        `;

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
          temperature: 0.2,
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
        !extractedText.toLowerCase().includes("no information")
      ) {
        log.debug(`Extracted Sensei profile data: ${extractedText}`);

        // Use memoryManager's built-in record operation to correctly embed and store.
        // We expose a special method or just rely on LanceDB provider manually exposing a store method.
        // MemoryIndexManager already has a way to embed and index via handleContent.
        const lanceDb = this.memoryManager.getLanceDbProvider();
        if (!lanceDb) {
          log.debug("SenseiProfiler: lanceDb not available to store profile insight.");
          return;
        }
        const provider = this.memoryManager.getEmbeddingProvider();

        const textToEmbed = `Sensei Profile Insight: ${extractedText}`;
        const vector = provider ? await provider.embedQuery(textToEmbed) : [];

        await lanceDb.store({
          role: "system",
          category: "sensei_profile",
          importance: 2.0, // High importance
          source_file: "profiler",
          text: textToEmbed,
          vector,
        });
      }
    } catch (err) {
      log.warn(`Sensei profiling failed during model execution: ${String(err)}`);
    }
  }
}

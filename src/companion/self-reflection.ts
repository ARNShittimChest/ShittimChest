/**
 * Self-Reflection Parser for the Companion Emotional Engine.
 *
 * Extracts and validates the <arona_feelings> block from the main LLM's
 * response text. This block contains Arona's bidirectional emotional
 * assessment — her own feelings AND her perception of Sensei's feelings.
 *
 * The block is stripped from the display text so the user never sees it.
 */

import type { Mood, SelfReflectionResult } from "./emotional-state.js";

// ── Constants ────────────────────────────────────────────────────────

const FEELINGS_TAG_OPEN = "<arona_feelings>";
const FEELINGS_TAG_CLOSE = "</arona_feelings>";

const VALID_MOODS = new Set<Mood>([
  "happy",
  "neutral",
  "sad",
  "excited",
  "worried",
  "caring",
  "sleepy",
]);

// ── Types ────────────────────────────────────────────────────────────

export interface SelfReflectionParseResult {
  /** The text with the <arona_feelings> block removed */
  text: string;
  /** The parsed reflection, or null if not found / invalid */
  reflection: SelfReflectionResult | null;
  /** Whether the text was changed (a block was found and stripped) */
  changed: boolean;
}

// ── Parser ───────────────────────────────────────────────────────────

/**
 * Extract and parse the <arona_feelings> block from LLM response text.
 *
 * - Finds the LAST occurrence of <arona_feelings>...</arona_feelings>
 *   (in case the LLM mentions it in examples, we want the actual one at the end)
 * - Strips the entire block (including tags) from the text
 * - Parses and validates the JSON contents
 * - Returns both the cleaned text and the parsed reflection
 *
 * Non-throwing — returns null reflection on any parse failure.
 */
export function extractSelfReflection(text: string): SelfReflectionParseResult {
  if (!text) {
    return { text, reflection: null, changed: false };
  }

  // Find the LAST occurrence of the block
  const lastOpenIdx = text.lastIndexOf(FEELINGS_TAG_OPEN);
  if (lastOpenIdx === -1) {
    return { text, reflection: null, changed: false };
  }

  const jsonStart = lastOpenIdx + FEELINGS_TAG_OPEN.length;
  const closeIdx = text.indexOf(FEELINGS_TAG_CLOSE, jsonStart);
  if (closeIdx === -1) {
    // Opening tag found but no closing tag — strip the dangling tag but don't parse
    const cleaned = text.slice(0, lastOpenIdx).trimEnd();
    return { text: cleaned, reflection: null, changed: true };
  }

  const jsonStr = text.slice(jsonStart, closeIdx).trim();
  const cleaned = (
    text.slice(0, lastOpenIdx) + text.slice(closeIdx + FEELINGS_TAG_CLOSE.length)
  ).trimEnd();

  const reflection = parseSelfReflectionJSON(jsonStr);

  return {
    text: cleaned,
    reflection,
    changed: true,
  };
}

/**
 * Parse and validate the JSON content of a self-reflection block.
 */
function parseSelfReflectionJSON(raw: string): SelfReflectionResult | null {
  try {
    // Handle potential markdown code block wrapping
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    // Validate arona_mood
    const aronaMood = (parsed.arona_mood ?? parsed.aronaMood) as string;
    if (!aronaMood || !VALID_MOODS.has(aronaMood as Mood)) {
      return null;
    }

    // Validate arona_intensity
    const aronaIntensity = Number(parsed.arona_intensity ?? parsed.aronaIntensity);
    if (isNaN(aronaIntensity) || aronaIntensity < 0 || aronaIntensity > 1) {
      return null;
    }

    // Validate sensei_mood
    const senseiMood = (parsed.sensei_mood ?? parsed.senseiMood) as string;
    if (!senseiMood || !VALID_MOODS.has(senseiMood as Mood)) {
      return null;
    }

    // Validate sensei_intensity
    const senseiIntensity = Number(parsed.sensei_intensity ?? parsed.senseiIntensity);
    if (isNaN(senseiIntensity) || senseiIntensity < 0 || senseiIntensity > 1) {
      return null;
    }

    // Validate affection_delta
    const affectionDelta = Math.round(Number(parsed.affection_delta ?? parsed.affectionDelta));
    if (isNaN(affectionDelta) || affectionDelta < -10 || affectionDelta > 10) {
      return null;
    }

    // Reason (optional, defaults to "self-reflection")
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "self-reflection";

    return {
      aronaMood: aronaMood as Mood,
      aronaIntensity: Math.max(0, Math.min(1, aronaIntensity)),
      senseiMood: senseiMood as Mood,
      senseiIntensity: Math.max(0, Math.min(1, senseiIntensity)),
      affectionDelta: Math.max(-10, Math.min(10, affectionDelta)),
      reason,
    };
  } catch {
    return null;
  }
}

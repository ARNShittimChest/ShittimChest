/**
 * Emotion tag utilities for L2D integration.
 *
 * The AI prefixes replies with `[happy]`, `[sad]`, etc.
 * These tags drive the Spine character's expression and are
 * stripped before the text is displayed to the user.
 */

import type { Mood } from "../../../../src/companion/emotional-state.js";

const EMOTION_TAG_RE = /^\s*\[(happy|excited|sad|worried|caring|sleepy|neutral)\]\s*/i;

/** Extract mood from the first emotion tag in text. Returns null if none found. */
export function extractEmotionTag(text: string): Mood | null {
  const match = EMOTION_TAG_RE.exec(text);
  return match ? (match[1].toLowerCase() as Mood) : null;
}

/** Strip the emotion tag from the start of text. Returns original text if no tag. */
export function stripEmotionTag(text: string): string {
  return text.replace(EMOTION_TAG_RE, "");
}

/** Dispatch a spine emotion event on document for the SpineViewer to consume. */
export function dispatchEmotionEvent(mood: Mood): void {
  document.dispatchEvent(new CustomEvent("spine:emotion", { detail: { mood } }));
}

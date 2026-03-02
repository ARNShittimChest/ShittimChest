import type { GatewayBrowserClient } from "../gateway.ts";

export type MoodState = {
  mood: string;
  intensity: number;
  affection: number;
  triggers: string[];
  lastChangeMs: number;
};

export type CompanionState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  companionMood: MoodState | null;
  companionMoodLoading: boolean;
  companionMoodError: string | null;
};

export async function loadCompanionMood(state: CompanionState) {
  if (!state.client || !state.connected) return;
  if (state.companionMoodLoading) return;
  state.companionMoodLoading = true;
  state.companionMoodError = null;
  try {
    const res = await state.client.request("companion.mood", {});
    state.companionMood = res as MoodState | null;
  } catch (err) {
    state.companionMoodError = String(err);
  } finally {
    state.companionMoodLoading = false;
  }
}

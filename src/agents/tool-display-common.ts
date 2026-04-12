/**
 * Barrel re-export for tool display utilities.
 *
 * Implementation split into focused modules:
 *   - tool-display-types.ts   — shared types, normalizers, coercion helpers
 *   - tool-detail-resolvers.ts — read/write/web-search/web-fetch detail resolvers
 *   - shell-parser.ts         — shell word splitting, quoting, preamble stripping
 *   - exec-summarizer.ts      — CLI command → human-readable summary
 *
 * This barrel preserves the original public API so existing consumers
 * (`src/agents/tool-display.ts` and `ui/src/ui/tool-display.ts`) keep working.
 */

// --- Types & core utilities ---
export type {
  CoerceDisplayValueOptions,
  ToolDisplayActionSpec,
  ToolDisplaySpec,
} from "./tool-display-types.js";

export {
  coerceDisplayValue,
  defaultTitle,
  formatDetailKey,
  lookupValueByPath,
  normalizeToolName,
  normalizeVerb,
  resolvePathArg,
} from "./tool-display-types.js";

// --- Tool detail resolvers ---
export {
  resolveReadDetail,
  resolveWebFetchDetail,
  resolveWebSearchDetail,
  resolveWriteDetail,
} from "./tool-detail-resolvers.js";

// --- Exec summarizer (uses shell-parser internally) ---
export { resolveExecDetail } from "./exec-summarizer.js";

// --- Action spec & detail-from-keys (composite resolvers) ---
import type { CoerceDisplayValueOptions, ToolDisplaySpec } from "./tool-display-types.js";
import { coerceDisplayValue, lookupValueByPath } from "./tool-display-types.js";
import type { ToolDisplayActionSpec } from "./tool-display-types.js";

export function resolveActionSpec(
  spec: ToolDisplaySpec | undefined,
  action: string | undefined,
): ToolDisplayActionSpec | undefined {
  if (!spec || !action) {
    return undefined;
  }
  return spec.actions?.[action] ?? undefined;
}

export function resolveDetailFromKeys(
  args: unknown,
  keys: string[],
  opts: {
    mode: "first" | "summary";
    coerce?: CoerceDisplayValueOptions;
    maxEntries?: number;
    formatKey?: (raw: string) => string;
  },
): string | undefined {
  if (opts.mode === "first") {
    for (const key of keys) {
      const value = lookupValueByPath(args, key);
      const display = coerceDisplayValue(value, opts.coerce);
      if (display) {
        return display;
      }
    }
    return undefined;
  }

  const entries: Array<{ label: string; value: string }> = [];
  for (const key of keys) {
    const value = lookupValueByPath(args, key);
    const display = coerceDisplayValue(value, opts.coerce);
    if (!display) {
      continue;
    }
    entries.push({ label: opts.formatKey ? opts.formatKey(key) : key, value: display });
  }
  if (entries.length === 0) {
    return undefined;
  }
  if (entries.length === 1) {
    return entries[0].value;
  }

  const seen = new Set<string>();
  const unique: Array<{ label: string; value: string }> = [];
  for (const entry of entries) {
    const token = `${entry.label}:${entry.value}`;
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    unique.push(entry);
  }
  if (unique.length === 0) {
    return undefined;
  }

  return unique
    .slice(0, opts.maxEntries ?? 8)
    .map((entry) => `${entry.label} ${entry.value}`)
    .join(" · ");
}

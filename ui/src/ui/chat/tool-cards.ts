import { html, nothing } from "lit";
import { icons } from "../icons.ts";
import { formatToolDetail, resolveToolDisplay } from "../tool-display.ts";
import type { ToolCard } from "../types/chat-types.ts";
import { TOOL_INLINE_THRESHOLD } from "./constants.ts";
import { extractTextCached } from "./message-extract.ts";
import { isToolResultMessage } from "./message-normalizer.ts";
import { formatToolOutputForSidebar, getTruncatedPreview } from "./tool-helpers.ts";

export function extractToolCards(message: unknown): ToolCard[] {
  const m = message as Record<string, unknown>;
  const content = normalizeContent(m.content);
  const cards: ToolCard[] = [];

  for (const item of content) {
    const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
    const isToolCall =
      ["toolcall", "tool_call", "tooluse", "tool_use"].includes(kind) ||
      (typeof item.name === "string" && item.arguments != null);
    if (isToolCall) {
      cards.push({
        kind: "call",
        name: (item.name as string) ?? "tool",
        args: coerceArgs(item.arguments ?? item.args),
      });
    }
  }

  for (const item of content) {
    const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
    if (kind !== "toolresult" && kind !== "tool_result") {
      continue;
    }
    const text = extractToolText(item);
    const name = typeof item.name === "string" ? item.name : "tool";
    cards.push({ kind: "result", name, text });
  }

  if (isToolResultMessage(message) && !cards.some((card) => card.kind === "result")) {
    const name =
      (typeof m.toolName === "string" && m.toolName) ||
      (typeof m.tool_name === "string" && m.tool_name) ||
      "tool";
    const text = extractTextCached(message) ?? undefined;
    cards.push({ kind: "result", name, text });
  }

  return cards;
}

export function renderToolCardSidebar(card: ToolCard, onOpenSidebar?: (content: string) => void) {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const detail = formatToolDetail(display);
  const hasText = Boolean(card.text?.trim());

  // Active tool call — show spinner
  if (card.kind === "call") {
    return html`
      <div class="chat-tool-card chat-tool-card--active">
        <div class="chat-tool-card__header">
          <div class="chat-tool-card__title">
            <span class="chat-tool-card__icon chat-tool-card__spinner">${icons.loader}</span>
            <span>${display.verb ?? ""} ${display.label}</span>
          </div>
          <span class="chat-tool-card__status-text muted">Đang thực hiện…</span>
        </div>
        ${detail ? html`<div class="chat-tool-card__detail">${detail}</div>` : nothing}
      </div>
    `;
  }

  // Completed tool result — collapsed with click to expand
  const canClick = Boolean(onOpenSidebar);
  const handleViewClick = canClick
    ? (e: Event) => {
        e.stopPropagation();
        if (hasText) {
          onOpenSidebar!(formatToolOutputForSidebar(card.text!));
          return;
        }
        const info = `## ${display.label}\n\n${
          detail ? `**Command:** \`${detail}\`\n\n` : ""
        }*No output — tool completed successfully.*`;
        onOpenSidebar!(info);
      }
    : undefined;

  const isShort = hasText && (card.text?.length ?? 0) <= TOOL_INLINE_THRESHOLD;
  const showCollapsed = hasText && !isShort;
  const showInline = hasText && isShort;
  const isEmpty = !hasText;

  return html`
    <details class="chat-tool-card chat-tool-card--collapsed">
      <summary class="chat-tool-card__header">
        <div class="chat-tool-card__title">
          <span class="chat-tool-card__icon">${icons[display.icon]}</span>
          <span>${display.verb ?? ""} ${display.label}</span>
        </div>
        <span class="chat-tool-card__status">${icons.check}</span>
      </summary>
      <div class="chat-tool-card__body">
        ${detail ? html`<div class="chat-tool-card__detail">${detail}</div>` : nothing}
        ${
          isEmpty
            ? html`
                <div class="chat-tool-card__status-text muted">Completed</div>
              `
            : nothing
        }
        ${
          showCollapsed
            ? html`<div class="chat-tool-card__preview mono">${getTruncatedPreview(card.text!)}</div>`
            : nothing
        }
        ${showInline ? html`<div class="chat-tool-card__inline mono">${card.text}</div>` : nothing}
        ${
          canClick
            ? html`<button
                class="chat-tool-card__action"
                type="button"
                @click=${handleViewClick}
              >View ${icons.check}</button>`
            : nothing
        }
      </div>
    </details>
  `;
}

/**
 * Group ALL tool cards into a single row.
 * - Active (has any "call" cards): spinner + "Đang thực hiện N tiến trình…"
 * - Complete (all "result"): ✓ + "Đã thực hiện N tiến trình" — click opens sidebar
 */
export function renderToolCardGroup(cards: ToolCard[], onOpenSidebar?: (content: string) => void) {
  if (cards.length === 0) {
    return nothing;
  }

  // A call is "active" only if there's no matching result card with the same name
  const resultNames = new Set(cards.filter((c) => c.kind === "result").map((c) => c.name));
  const hasActiveCalls = cards.some((c) => c.kind === "call" && !resultNames.has(c.name));
  const count = cards.length;

  if (hasActiveCalls) {
    // Active execution — spinner row, clickable to see what's running
    const handleActiveClick = onOpenSidebar
      ? () => {
          const lines: string[] = [`## Đang thực hiện (${count})`, ""];
          for (const card of cards) {
            const display = resolveToolDisplay({ name: card.name, args: card.args });
            const detail = formatToolDetail(display);
            const status = card.kind === "call" ? "⏳ Đang chạy" : "✅ Xong";
            lines.push(`### ${display.verb ?? ""} ${display.label}`);
            lines.push(`*${status}*`);
            if (detail) {
              lines.push(`\`${detail}\``);
            }
            if (card.text?.trim()) {
              lines.push("```", card.text.trim(), "```");
            }
            lines.push("");
          }
          onOpenSidebar(lines.join("\n"));
        }
      : undefined;

    return html`
      <div
        class="chat-tool-card chat-tool-card--active ${handleActiveClick ? "chat-tool-card--clickable" : ""}"
        @click=${handleActiveClick}
        role=${handleActiveClick ? "button" : nothing}
        tabindex=${handleActiveClick ? "0" : nothing}
      >
        <div class="chat-tool-card__header">
          <div class="chat-tool-card__title">
            <span class="chat-tool-card__icon chat-tool-card__spinner">${icons.loader}</span>
            <span>Đang thực hiện ${count} tiến trình…</span>
          </div>
        </div>
      </div>
    `;
  }

  // All complete — clickable row that opens sidebar with all tool details
  const handleClick = onOpenSidebar
    ? () => {
        const lines: string[] = [`## Tiến trình đã thực hiện (${count})`, ""];
        for (const card of cards) {
          const display = resolveToolDisplay({ name: card.name, args: card.args });
          const detail = formatToolDetail(display);
          lines.push(`### ${display.verb ?? ""} ${display.label}`);
          if (detail) {
            lines.push(`\`${detail}\``);
          }
          if (card.text?.trim()) {
            lines.push("```", card.text.trim(), "```");
          } else {
            lines.push("*Completed — no output.*");
          }
          lines.push("");
        }
        onOpenSidebar(lines.join("\n"));
      }
    : undefined;

  return html`
    <div
      class="chat-tool-card chat-tool-card--collapsed ${handleClick ? "chat-tool-card--clickable" : ""}"
      @click=${handleClick}
      role=${handleClick ? "button" : nothing}
      tabindex=${handleClick ? "0" : nothing}
    >
      <div class="chat-tool-card__header">
        <div class="chat-tool-card__title">
          <span class="chat-tool-card__icon">${icons.check}</span>
          <span>Đã thực hiện ${count} tiến trình</span>
        </div>
        <span class="chat-tool-card__status">${icons.check}</span>
      </div>
    </div>
  `;
}

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(Boolean) as Array<Record<string, unknown>>;
}

function coerceArgs(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractToolText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  return undefined;
}

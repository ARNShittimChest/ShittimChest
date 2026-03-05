/**
 * WebPrompter — A WizardPrompter implementation that communicates via
 * a send/receive callback pair, intended for use over WebSocket.
 *
 * Each prompt method serialises a structured message, sends it to the
 * client, and waits for the client to respond before resolving.
 */

import type {
  WizardConfirmParams,
  WizardMultiSelectParams,
  WizardProgress,
  WizardPrompter,
  WizardSelectParams,
  WizardTextParams,
} from "./prompts.js";

// ── Prompt message types ────────────────────────────────────────────

export type WebPromptMessage =
  | { kind: "intro"; title: string }
  | { kind: "outro"; message: string }
  | { kind: "note"; message: string; title?: string }
  | {
      kind: "select";
      id: string;
      message: string;
      options: Array<{ value: unknown; label: string; hint?: string }>;
      initialValue?: unknown;
    }
  | {
      kind: "multiselect";
      id: string;
      message: string;
      options: Array<{ value: unknown; label: string; hint?: string }>;
      initialValues?: unknown[];
      searchable?: boolean;
    }
  | {
      kind: "text";
      id: string;
      message: string;
      placeholder?: string;
      initialValue?: string;
    }
  | { kind: "confirm"; id: string; message: string; initialValue?: boolean }
  | { kind: "progress-start"; id: string; label: string }
  | { kind: "progress-update"; id: string; message: string }
  | { kind: "progress-stop"; id: string; message?: string }
  | { kind: "complete" }
  | { kind: "error"; message: string };

export type WebPromptResponse = {
  id: string;
  value: unknown;
};

// ── WebPrompter factory ─────────────────────────────────────────────

export type WebPrompterTransport = {
  /** Send a prompt message to the client. */
  send: (msg: WebPromptMessage) => void;
  /**
   * Wait for the client to respond to a prompt with the given `id`.
   * Returns the raw value from the client.
   */
  waitForResponse: (id: string) => Promise<unknown>;
};

let promptCounter = 0;
function nextId(): string {
  return `p_${++promptCounter}_${Date.now().toString(36)}`;
}

export function createWebPrompter(transport: WebPrompterTransport): WizardPrompter {
  const { send, waitForResponse } = transport;

  return {
    intro: async (title) => {
      send({ kind: "intro", title });
      // Intro is informational — wait for client ack so the UI can animate.
      const id = nextId();
      send({ kind: "confirm", id, message: "__ack_intro__", initialValue: true });
      await waitForResponse(id);
    },

    outro: async (message) => {
      send({ kind: "outro", message });
    },

    note: async (message, title) => {
      const id = nextId();
      send({ kind: "note", message, title });
      // Wait for the user to acknowledge the note.
      send({ kind: "confirm", id, message: "__ack_note__", initialValue: true });
      await waitForResponse(id);
    },

    select: async <T>(params: WizardSelectParams<T>): Promise<T> => {
      const id = nextId();
      send({
        kind: "select",
        id,
        message: params.message,
        options: params.options.map((o) => ({
          value: o.value,
          label: o.label,
          hint: o.hint,
        })),
        initialValue: params.initialValue,
      });
      const value = await waitForResponse(id);
      return value as T;
    },

    multiselect: async <T>(params: WizardMultiSelectParams<T>): Promise<T[]> => {
      const id = nextId();
      send({
        kind: "multiselect",
        id,
        message: params.message,
        options: params.options.map((o) => ({
          value: o.value,
          label: o.label,
          hint: o.hint,
        })),
        initialValues: params.initialValues,
        searchable: params.searchable,
      });
      const value = await waitForResponse(id);
      return value as T[];
    },

    text: async (params: WizardTextParams): Promise<string> => {
      const id = nextId();
      send({
        kind: "text",
        id,
        message: params.message,
        placeholder: params.placeholder,
        initialValue: params.initialValue,
      });
      const value = await waitForResponse(id);
      if (typeof value === "string") {
        return value;
      }
      return value != null ? `${value as string | number}` : "";
    },

    confirm: async (params: WizardConfirmParams): Promise<boolean> => {
      const id = nextId();
      send({
        kind: "confirm",
        id,
        message: params.message,
        initialValue: params.initialValue,
      });
      const value = await waitForResponse(id);
      return Boolean(value);
    },

    progress: (label: string): WizardProgress => {
      const id = nextId();
      send({ kind: "progress-start", id, label });
      return {
        update: (message: string) => {
          send({ kind: "progress-update", id, message });
        },
        stop: (message?: string) => {
          send({ kind: "progress-stop", id, message });
        },
      };
    },
  };
}

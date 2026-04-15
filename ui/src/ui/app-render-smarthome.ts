import { html, nothing } from "lit";
import type { AppViewState } from "./app-view-state.js";
import type { ShittimChestApp } from "./app.js";
import {
  updateSmartHomeConfig,
  checkSmartHomeConnection,
  syncSmartHomeDevices,
  loadSmartHomeAudit,
} from "./controllers/smarthome.js";
import { icons } from "./icons.js";
import type { HAConfigView, HAEntityMapping } from "./types.js";

// ── Module-scoped form state (persists across Lit re-renders) ──

type FormState = {
  draftBaseUrl: string;
  draftAccessToken: string;
  draftTimeoutMs: string;
  showToken: boolean;
  showDevices: boolean;
  showAudit: boolean;
};

const formState: FormState = {
  draftBaseUrl: "",
  draftAccessToken: "",
  draftTimeoutMs: "",
  showToken: false,
  showDevices: false,
  showAudit: false,
};

let formInitialized = false;

/** Initialize draft values from the loaded config (once). */
function initForm(config: HAConfigView) {
  if (formInitialized) return;
  formState.draftBaseUrl = config.baseUrl;
  formState.draftAccessToken = "";
  formState.draftTimeoutMs = String(config.timeoutMs);
  formInitialized = true;
}

/** Reset form state so next load re-initializes from server. */
function resetForm() {
  formInitialized = false;
  formState.showToken = false;
}

function requestUpdate(app: AppViewState) {
  (app as unknown as import("lit").LitElement).requestUpdate();
}

// ── Device type labels + icons ──────────────────────────────────

const DEVICE_TYPE_LABELS: Record<string, string> = {
  LIGHT: "Light",
  AC: "Climate",
  LOCK: "Lock",
  CAM: "Camera",
  SENSOR: "Sensor",
  PLUG: "Switch",
  CURTAIN: "Cover",
  SPEAKER: "Media",
  TV: "TV",
  ROBOT: "Robot",
  OTHER: "Other",
};

// ── Render ──────────────────────────────────────────────────────

export function renderSmartHomeTab(app: AppViewState) {
  // Loading state
  if (app.smarthomeLoading && !app.smarthomeConfig) {
    return html`<div class="content content--chat" style="align-items: center; justify-content: center; height: 100%;">
      <div class="row muted">
        <span class="nav-item__icon" style="animation: spin 1s linear infinite;">${icons.loader}</span>
        <span>Loading smart home configuration...</span>
      </div>
    </div>`;
  }

  // Error state
  if (app.smarthomeError && !app.smarthomeConfig) {
    return html`<div class="content content--chat" style="padding: 24px;">
      <div class="callout danger">
        Failed to load smart home configuration: ${app.smarthomeError}
      </div>
    </div>`;
  }

  if (!app.smarthomeConfig) {
    return nothing;
  }

  const { config, configured } = app.smarthomeConfig;
  initForm(config);

  return html`
    <div class="content content--chat" style="padding: 24px; max-width: 1000px; margin: 0 auto; width: 100%;">
      <div class="content-header">
        <div>
          <h1 class="page-title">Smart Home</h1>
          <p class="page-sub">Configure Home Assistant connection and manage smart home devices.</p>
        </div>
      </div>

      ${app.smarthomeError ? html`<div class="callout danger" style="margin-bottom: 16px;">${app.smarthomeError}</div>` : ""}

      <!-- Connection Settings -->
      ${renderConnectionCard(app, config, configured)}

      <!-- Devices Overview -->
      ${configured ? renderDevicesCard(app, config) : ""}

      <!-- Security Settings -->
      ${configured ? renderSecurityCard(app, config) : ""}

      <!-- Audit Log -->
      ${configured ? renderAuditCard(app) : ""}
    </div>
  `;
}

// ── Connection Settings Card ────────────────────────────────────

function renderConnectionCard(app: AppViewState, config: HAConfigView, configured: boolean) {
  const handleSave = () => {
    const updates: Record<string, unknown> = {};
    const baseUrlEl = (app as unknown as HTMLElement).querySelector<HTMLInputElement>(
      "#ha-base-url",
    );
    const tokenEl = (app as unknown as HTMLElement).querySelector<HTMLInputElement>("#ha-token");
    const timeoutEl = (app as unknown as HTMLElement).querySelector<HTMLInputElement>(
      "#ha-timeout",
    );

    if (baseUrlEl) updates.baseUrl = baseUrlEl.value.trim();
    if (tokenEl && tokenEl.value.trim()) updates.accessToken = tokenEl.value.trim();
    if (timeoutEl) {
      const ms = parseInt(timeoutEl.value, 10);
      if (!isNaN(ms) && ms >= 1000) updates.timeoutMs = ms;
    }

    resetForm();
    void updateSmartHomeConfig(app as unknown as ShittimChestApp, updates);
  };

  const handleToggleEnabled = () => {
    resetForm();
    void updateSmartHomeConfig(app as unknown as ShittimChestApp, { enabled: !config.enabled });
  };

  const handleTestConnection = () => {
    void checkSmartHomeConnection(app as unknown as ShittimChestApp);
  };

  const handleToggleShowToken = () => {
    formState.showToken = !formState.showToken;
    requestUpdate(app);
  };

  return html`
    <div class="note-title" style="margin-top: 8px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Connection</div>
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: flex-start;">
        <div class="row" style="gap: 16px;">
          <div style="display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent);">
            <span style="display: flex; width: 22px; height: 22px;">${icons.plug}</span>
          </div>
          <div>
            <div class="card-title">Home Assistant</div>
            <div class="card-sub" style="margin-top: 2px;">
              ${
                configured
                  ? html`
                      <span style="color: var(--ok)">Connected</span>
                    `
                  : html`
                      <span style="color: var(--muted)">Not configured</span>
                    `
              }
            </div>
          </div>
        </div>
        <label class="field checkbox" style="margin: 0; cursor: pointer;">
          <input type="checkbox" .checked=${config.enabled} @change=${handleToggleEnabled} />
          <span style="display: none;">Enable</span>
        </label>
      </div>

      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);">
        <div class="grid grid-cols-2">
          <label class="field full">
            <span>Base URL</span>
            <input
              id="ha-base-url"
              type="url"
              placeholder="http://192.168.1.100:8123"
              .value=${formState.draftBaseUrl || config.baseUrl}
              @input=${(e: Event) => {
                formState.draftBaseUrl = (e.target as HTMLInputElement).value;
              }}
            />
          </label>

          <label class="field full">
            <span>Access Token</span>
            <div class="row" style="gap: 8px;">
              <input
                id="ha-token"
                type="${formState.showToken ? "text" : "password"}"
                placeholder="${config.accessToken ? "••••••••  (saved — enter new to replace)" : "Long-lived access token"}"
                .value=${formState.draftAccessToken}
                @input=${(e: Event) => {
                  formState.draftAccessToken = (e.target as HTMLInputElement).value;
                }}
                style="flex: 1;"
              />
              <button @click=${handleToggleShowToken} class="btn btn--sm" title="${formState.showToken ? "Hide" : "Show"}" style="padding: 6px; min-width: 36px;">
                <span style="display: flex; width: 14px; height: 14px; opacity: 0.7;">${icons.settings}</span>
              </button>
            </div>
          </label>

          <label class="field">
            <span>Timeout (ms)</span>
            <input
              id="ha-timeout"
              type="number"
              min="1000"
              step="1000"
              .value=${formState.draftTimeoutMs || String(config.timeoutMs)}
              @input=${(e: Event) => {
                formState.draftTimeoutMs = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
        </div>

        <div class="row" style="justify-content: flex-end; margin-top: 16px; gap: 8px;">
          <button
            @click=${handleTestConnection}
            class="btn"
            ?disabled=${app.smarthomeCheckLoading || !config.enabled}
          >
            ${
              app.smarthomeCheckLoading
                ? html`<span class="nav-item__icon" style="animation: spin 1s linear infinite;">${icons.loader}</span>`
                : html`<span style="display: flex; width: 14px; height: 14px; margin-right: 4px;">${icons.radio}</span>`
            }
            Test Connection
          </button>
          <button @click=${handleSave} class="btn primary" ?disabled=${app.smarthomeLoading}>
            Save
          </button>
        </div>

        ${
          app.smarthomeCheckResult
            ? html`
            <div class="callout ${app.smarthomeCheckResult.ok ? "ok" : "danger"}" style="margin-top: 12px;">
              ${app.smarthomeCheckResult.ok ? "Connection successful!" : `Connection failed: ${app.smarthomeCheckResult.message}`}
            </div>
          `
            : ""
        }
      </div>
    </div>
  `;
}

// ── Devices Overview Card ───────────────────────────────────────

function renderDevicesCard(app: AppViewState, config: HAConfigView) {
  const entities = config.entities;
  const areas = new Set(entities.map((e) => e.area).filter(Boolean));

  const handleSync = () => {
    void syncSmartHomeDevices(app as unknown as ShittimChestApp);
  };

  const handleToggleDevices = () => {
    formState.showDevices = !formState.showDevices;
    requestUpdate(app);
  };

  // Group by area
  const byArea = new Map<string, HAEntityMapping[]>();
  for (const e of entities) {
    const area = e.area || "Other";
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area)!.push(e);
  }

  return html`
    <div class="note-title" style="margin-top: 16px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Devices</div>
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="row" style="gap: 16px;">
          <div style="display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent);">
            <span style="display: flex; width: 22px; height: 22px;">${icons.monitor}</span>
          </div>
          <div>
            <div class="card-title">${entities.length} Devices</div>
            <div class="card-sub" style="margin-top: 2px;">${areas.size} areas</div>
          </div>
        </div>
        <div class="row" style="gap: 8px;">
          <button @click=${handleToggleDevices} class="btn btn--sm">
            ${formState.showDevices ? "Hide" : "Show"} Devices
          </button>
          <button
            @click=${handleSync}
            class="btn primary btn--sm"
            ?disabled=${app.smarthomeSyncLoading}
          >
            ${
              app.smarthomeSyncLoading
                ? html`<span class="nav-item__icon" style="animation: spin 1s linear infinite;">${icons.loader}</span>`
                : html`<span style="display: flex; width: 14px; height: 14px; margin-right: 4px;">${icons.loader}</span>`
            }
            Sync from HA
          </button>
        </div>
      </div>

      ${
        app.smarthomeSyncResult
          ? html`
          <div class="callout ok" style="margin-top: 12px;">
            Sync complete: ${app.smarthomeSyncResult.added.length} added,
            ${app.smarthomeSyncResult.updated.length} updated,
            ${app.smarthomeSyncResult.removed.length} removed,
            ${app.smarthomeSyncResult.skipped.length} skipped.
          </div>
        `
          : ""
      }

      ${
        formState.showDevices && entities.length > 0
          ? html`
          <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); overflow-x: auto;">
            ${Array.from(byArea.entries()).map(
              ([area, areaEntities]) => html`
                <div style="margin-bottom: 16px;">
                  <div style="font-weight: 600; font-size: 13px; color: var(--muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.03em;">${area}</div>
                  <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                    <thead>
                      <tr style="text-align: left; color: var(--muted); border-bottom: 1px solid var(--border);">
                        <th style="padding: 6px 8px;">Entity ID</th>
                        <th style="padding: 6px 8px;">Name</th>
                        <th style="padding: 6px 8px;">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${areaEntities.map(
                        (e) => html`
                          <tr style="border-bottom: 1px solid var(--border-subtle, var(--border));">
                            <td style="padding: 6px 8px; font-family: var(--font-mono, monospace); font-size: 12px; opacity: 0.8;">${e.entityId}</td>
                            <td style="padding: 6px 8px;">${e.friendlyName}</td>
                            <td style="padding: 6px 8px;">
                              <span class="pill" style="font-size: 11px;">${DEVICE_TYPE_LABELS[e.deviceType] ?? e.deviceType}</span>
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `,
            )}
          </div>
        `
          : ""
      }

      ${
        formState.showDevices && entities.length === 0
          ? html`
              <div style="margin-top: 16px; padding: 16px; text-align: center; color: var(--muted)">
                No devices synced yet. Click "Sync from HA" to discover devices.
              </div>
            `
          : ""
      }
    </div>
  `;
}

// ── Security Settings Card ──────────────────────────────────────

function renderSecurityCard(app: AppViewState, config: HAConfigView) {
  const handleToggle = () => {
    void updateSmartHomeConfig(app as unknown as ShittimChestApp, {
      requireConfirmForSecurity: !config.requireConfirmForSecurity,
    });
  };

  return html`
    <div class="note-title" style="margin-top: 16px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Security</div>
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="row" style="gap: 16px;">
          <div style="display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 50%; background: rgba(239, 68, 68, 0.1); color: var(--danger, #ef4444);">
            <span style="display: flex; width: 22px; height: 22px;">${icons.zap}</span>
          </div>
          <div>
            <div class="card-title">Confirmation for Security Devices</div>
            <div class="card-sub" style="margin-top: 2px;">Require confirmation before toggling locks and security cameras.</div>
          </div>
        </div>
        <label class="field checkbox" style="margin: 0; cursor: pointer;">
          <input type="checkbox" .checked=${config.requireConfirmForSecurity} @change=${handleToggle} />
          <span style="display: none;">Require confirmation</span>
        </label>
      </div>
    </div>
  `;
}

// ── Audit Log Card ──────────────────────────────────────────────

function renderAuditCard(app: AppViewState) {
  const handleToggleAudit = () => {
    if (!formState.showAudit) {
      void loadSmartHomeAudit(app as unknown as ShittimChestApp);
    }
    formState.showAudit = !formState.showAudit;
    requestUpdate(app);
  };

  const entries = app.smarthomeAudit ?? [];

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mo} ${hh}:${mm}`;
  };

  return html`
    <div class="note-title" style="margin-top: 16px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Activity Log</div>
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="row" style="gap: 16px;">
          <div style="display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent);">
            <span style="display: flex; width: 22px; height: 22px;">${icons.scrollText}</span>
          </div>
          <div>
            <div class="card-title">Recent Actions</div>
            <div class="card-sub" style="margin-top: 2px;">Audit trail of smart home device actions.</div>
          </div>
        </div>
        <button @click=${handleToggleAudit} class="btn btn--sm">
          ${formState.showAudit ? "Hide" : "Show"} Log
        </button>
      </div>

      ${
        formState.showAudit
          ? html`
          <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border);">
            ${
              app.smarthomeAuditLoading
                ? html`<div class="row muted" style="justify-content: center; padding: 16px;">
                  <span class="nav-item__icon" style="animation: spin 1s linear infinite;">${icons.loader}</span>
                  <span>Loading...</span>
                </div>`
                : entries.length === 0
                  ? html`
                      <div style="padding: 16px; text-align: center; color: var(--muted)">No actions recorded yet.</div>
                    `
                  : html`
                  <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                    <thead>
                      <tr style="text-align: left; color: var(--muted); border-bottom: 1px solid var(--border);">
                        <th style="padding: 6px 8px;">Time</th>
                        <th style="padding: 6px 8px;">Action</th>
                        <th style="padding: 6px 8px;">Entity</th>
                        <th style="padding: 6px 8px;">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${entries
                        .slice()
                        .reverse()
                        .map(
                          (e) => html`
                          <tr style="border-bottom: 1px solid var(--border-subtle, var(--border));">
                            <td style="padding: 6px 8px; font-family: var(--font-mono, monospace); font-size: 12px; opacity: 0.8; white-space: nowrap;">${formatTime(e.timestamp)}</td>
                            <td style="padding: 6px 8px;">${e.action}</td>
                            <td style="padding: 6px 8px; font-family: var(--font-mono, monospace); font-size: 12px; opacity: 0.8;">${e.entityId}</td>
                            <td style="padding: 6px 8px;">
                              ${
                                e.success
                                  ? html`
                                      <span style="color: var(--ok)">OK</span>
                                    `
                                  : html`<span style="color: var(--danger, #ef4444);" title="${e.error ?? ""}">FAIL</span>`
                              }
                            </td>
                          </tr>
                        `,
                        )}
                    </tbody>
                  </table>
                `
            }
          </div>
        `
          : ""
      }
    </div>
  `;
}

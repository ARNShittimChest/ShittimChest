import { html, nothing } from "lit";
import type { AppViewState } from "./app-view-state.js";
import type { ShittimChestApp } from "./app.js";
import { updateHealthConfig } from "./controllers/health.js";
import { icons } from "./icons.js";
import type { HealthConfig, HealthReminderConfig } from "./types.js";

type FormState = {
  activeKey: string;
  draftPingIp: string;
};

const formState: FormState = {
  activeKey: "",
  draftPingIp: "",
};

export function renderHealthTab(app: AppViewState) {
  if (app.healthRemindersLoading && !app.healthRemindersResult) {
    return html`<div class="content content--chat" style="align-items: center; justify-content: center; height: 100%;">
      <div class="row muted">
        <span class="nav-item__icon" style="animation: spin 1s linear infinite;">${icons.loader}</span>
        <span>Loading health configs...</span>
      </div>
    </div>`;
  }
  if (app.healthRemindersError) {
    return html`<div class="content content--chat" style="padding: 24px;">
      <div class="callout danger">
        Failed to load health configurations: ${app.healthRemindersError}
      </div>
    </div>`;
  }
  if (!app.healthRemindersResult) {
    return nothing;
  }

  const { config, steps } = app.healthRemindersResult;

  const renderCard = (
    key: keyof HealthConfig,
    title: string,
    desc: string,
    c: HealthReminderConfig,
    logo: string,
  ) => {
    const handleToggle = () => {
      void updateHealthConfig(app as unknown as ShittimChestApp, key, !c.enabled);
    };

    const handleSaveOpts = () => {
      const pingIpVal =
        (app as unknown as HTMLElement)
          .querySelector<HTMLInputElement>(`#pingIp-${key}`)
          ?.value.trim() ?? "";
      const requirePingVal =
        (app as unknown as HTMLElement).querySelector<HTMLInputElement>(`#requirePing-${key}`)
          ?.checked ?? false;
      const intervalVal = parseInt(
        (app as unknown as HTMLElement).querySelector<HTMLInputElement>(`#interval-${key}`)
          ?.value ?? "0",
        10,
      );
      void updateHealthConfig(app as unknown as ShittimChestApp, key, undefined, {
        pingIp: pingIpVal,
        requirePing: requirePingVal,
        intervalMinutes: isNaN(intervalVal) || intervalVal < 1 ? c.intervalMinutes : intervalVal,
      });
      formState.activeKey = "";
      (app as unknown as import("lit").LitElement).requestUpdate();
    };

    const isEdit = formState.activeKey === key;
    const toggleEdit = () => {
      formState.activeKey = isEdit ? "" : key;
      (app as unknown as import("lit").LitElement).requestUpdate();
    };

    const iconObj = icons[logo as keyof typeof icons] ?? icons.radio;

    return html`
      <div class="card">
        <div class="row" style="justify-content: space-between; align-items: flex-start;">
          <div class="row" style="gap: 16px;">
            <div style="display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent);">
              <span style="display: flex; width: 22px; height: 22px;">
                ${iconObj}
              </span>
            </div>
            <div>
              <div class="card-title">${title}</div>
              <div class="card-sub" style="margin-top: 2px;">${desc}</div>
            </div>
          </div>
          <div class="row" style="gap: 12px;">
             <button
              @click=${toggleEdit}
              class="btn btn--sm"
              title="Edit settings"
              style="padding: 6px; background: transparent; border: 1px solid transparent;"
            >
               <span style="display: flex; width: 14px; height: 14px; opacity: 0.7;">${icons.settings}</span>
            </button>
            <label class="field checkbox" style="margin: 0; cursor: pointer;">
              <input 
                type="checkbox"
                .checked=${c.enabled}
                @change=${handleToggle}
              />
              <span style="display: none;">Enable</span>
            </label>
          </div>
        </div>

        ${
          isEdit
            ? html`
          <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);">
            <div class="grid grid-cols-2">
              <label class="field">
                <span>Interval (Minutes)</span>
                <input
                  id="interval-${key}"
                  type="number"
                  min="1"
                  .value=${c.intervalMinutes.toString()}
                />
              </label>
              
              <label class="field">
                <span>Required Ping IP</span>
                <input
                  id="pingIp-${key}"
                  type="text"
                  placeholder="e.g. 192.168.1.10"
                  .value=${c.pingIp ?? ""}
                />
              </label>
              
              <label class="field checkbox full" style="margin-top: 8px;">
                <input
                  id="requirePing-${key}"
                  type="checkbox"
                  .checked=${c.requirePing ?? false}
                />
                <span>Require successful ping before reminding</span>
              </label>
              
              <div class="row full" style="justify-content: flex-end; margin-top: 16px;">
                 <button @click=${toggleEdit} class="btn">Cancel</button>
                 <button @click=${handleSaveOpts} class="btn primary">Save</button>
              </div>
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;
  };

  return html`
    <div class="content content--chat" style="padding: 24px; max-width: 1000px; margin: 0 auto; width: 100%;">
      <div class="content-header">
        <div>
          <h1 class="page-title">Health & Activity</h1>
          <p class="page-sub">Configure break reminders and sync physical activity limits.</p>
        </div>
      </div>

      <!-- Activity Overview -->
      <div class="note-title" style="margin-top: 8px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Today's Activity</div>
      <div class="stat">
        <div class="row" style="justify-content: space-between;">
          <div class="row" style="gap: 16px;">
            <div style="display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 50%; background: rgba(34, 197, 94, 0.1); color: var(--ok);">
              <span style="display: flex; width: 24px; height: 24px;">${icons.zap}</span>
            </div>
            <div>
              <div class="stat-label">Steps Taken</div>
              <div class="stat-value ${steps === null ? "warn" : "ok"}">
                ${steps !== null ? steps.toLocaleString() : "---"}
              </div>
            </div>
          </div>

          <div>
            ${
              steps === null
                ? html`
              <div class="pill danger" style="color: var(--warn); border-color: var(--warn); background: transparent;">
                <span class="nav-item__icon" style="opacity: 1;">${icons.monitor}</span>
                <span>Waiting for iOS Sync</span>
              </div>
            `
                : html`
              <div class="pill ok" style="color: var(--ok); border-color: var(--ok); background: transparent;">
                <span class="nav-item__icon" style="opacity: 1;">${icons.check}</span>
                <span>Synced with HealthKit</span>
              </div>
            `
            }
          </div>
        </div>
      </div>

      <!-- Reminder Configurations -->
      <div class="note-title" style="margin-top: 16px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Reminder Settings</div>
      <div class="grid grid-cols-2">
        ${renderCard("water", "Hydration", "Reminds you to drink water", config.water, "zap")}
        ${renderCard("eyes", "Eye Break", "Reminds you to look away from screen", config.eyes, "monitor")}
        ${renderCard("movement", "Movement", "Reminds you to stretch or walk", config.movement, "sparkles")}
        ${renderCard("sleep", "Sleep", "Reminds you to wind down for bed", config.sleep, "radio")}
      </div>
    </div>
  `;
}

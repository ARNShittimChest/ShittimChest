import { html, nothing } from "lit";
import type { AppViewState } from "./app-view-state.js";
import type { ShittimChestApp } from "./app.js";
import { updateHealthConfig } from "./controllers/health.js";
import { renderIcon } from "./icons.js";
import type { HealthConfig, HealthReminderConfig } from "./types.js";
import { t } from "../i18n/index.js";

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
    return html`<div class="flex h-full items-center justify-center p-8 text-neutral-500">
      <div class="flex items-center gap-2">
        <span class="animate-spin flex">${renderIcon("loader", "w-4 h-4")}</span>
        <span>Loading health configs...</span>
      </div>
    </div>`;
  }
  if (app.healthRemindersError) {
    return html`<div class="p-8 text-red-500">
      Failed to load health configurations: ${app.healthRemindersError}
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

    return html`
      <div class="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm transition-all focus-within:border-black/20 focus-within:ring-4 focus-within:ring-black/5 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-4">
            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
              ${renderIcon(logo as any, "w-6 h-6")}
            </div>
            <div>
              <h3 class="font-medium tracking-tight text-neutral-900 dark:text-neutral-100">${title}</h3>
              <p class="text-sm text-neutral-500 dark:text-neutral-400">${desc}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
             <button
              @click=${toggleEdit}
              class="rounded-md p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              title="Edit settings"
            >
              ${renderIcon("settings", "w-4 h-4")}
            </button>
            <button
              @click=${handleToggle}
              class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 ${
                c.enabled ? "bg-blue-600" : "bg-neutral-200 dark:bg-neutral-700"
              }"
              role="switch"
              aria-checked="${c.enabled}"
            >
              <span
                class="inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  c.enabled ? "translate-x-5" : "translate-x-1"
                }"
              ></span>
            </button>
          </div>
        </div>

        ${
          isEdit
            ? html`
          <div class="mt-6 border-t border-neutral-100 pt-6 dark:border-neutral-800">
            <div class="grid gap-6 sm:grid-cols-2">
              <div>
                <label class="mb-2 block text-sm font-medium text-neutral-900 dark:text-neutral-200">
                  Interval (minutes)
                </label>
                <input
                  id="interval-${key}"
                  type="number"
                  min="1"
                  .value=${c.intervalMinutes.toString()}
                  class="block w-full rounded-md border-neutral-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
              </div>
              <div>
                <label class="mb-2 flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-200">
                  <input
                    id="requirePing-${key}"
                    type="checkbox"
                    .checked=${c.requirePing ?? false}
                    class="rounded border-neutral-300 text-blue-600 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                  Require Ping IP Check
                </label>
                <input
                  id="pingIp-${key}"
                  type="text"
                  placeholder="e.g. 192.168.1.100"
                  .value=${c.pingIp ?? ""}
                  class="block w-full rounded-md border-neutral-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
                <p class="mt-1 flex gap-1 text-xs text-neutral-500">
                  Only reminds if IP is reachable
                </p>
              </div>
            </div>
            <div class="mt-6 flex justify-end gap-3">
              <button
                @click=${toggleEdit}
                class="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 dark:focus:ring-offset-neutral-900"
              >
                Cancel
              </button>
              <button
                @click=${handleSaveOpts}
                class="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900"
              >
                Save
              </button>
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;
  };

  return html`
    <div class="flex h-full flex-col overflow-y-auto overflow-x-hidden bg-neutral-50/50 dark:bg-neutral-950/20">
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 lg:p-8">
        
        <!-- Header Section -->
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              Health & Activity
            </h1>
            <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Configure Arona's proactive health reminders and track your daily wellness metrics.
            </p>
          </div>
        </div>

        <!-- Activity Overview -->
        <div class="grid grid-cols-1 gap-2">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Today's Activity</h2>
          <div class="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/50">
            <div class="flex items-center gap-4">
              <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400">
                ${renderIcon("zap", "w-6 h-6")}
              </div>
              <div>
                <p class="text-sm font-medium text-neutral-500 dark:text-neutral-400">Steps Taken</p>
                <div class="flex items-baseline gap-2">
                  <span class="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                    ${steps !== null ? steps.toLocaleString() : "---"}
                  </span>
                  <span class="text-sm font-medium text-neutral-500">steps</span>
                </div>
              </div>
            </div>
            ${
              steps === null
                ? html`
              <div class="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
                ${renderIcon("monitor", "w-4 h-4")}
                <span>Waiting for iOS Sync</span>
              </div>
            `
                : html`
              <div class="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
                ${renderIcon("check", "w-4 h-4")}
                <span>Synced with HealthKit</span>
              </div>
            `
            }
          </div>
        </div>

        <!-- Reminder Configurations -->
        <div class="grid grid-cols-1 gap-2 mt-4">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Reminder Settings</h2>
          <div class="grid gap-4 md:grid-cols-2">
            ${renderCard("water", "Hydration", "Reminds you to drink water", config.water, "zap")}
            ${renderCard("eyes", "Eye Break", "Reminds you to look away from screen", config.eyes, "monitor")}
            ${renderCard("movement", "Movement", "Reminds you to stretch or walk", config.movement, "sparkles")}
            ${renderCard("sleep", "Sleep", "Reminds you to wind down for bed", config.sleep, "radio")}
          </div>
        </div>

      </div>
    </div>
  `;
}

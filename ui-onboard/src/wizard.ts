/**
 * Onboarding wizard client — communicates with the backend via WebSocket.
 *
 * The WS port is injected via a `data-ws-port` attribute on `#wizard-root`.
 * Fallback: same port as the page was served from.
 */

// ── Types ──────────────────────────────────────────────────

interface WizardOption {
  label: string;
  value: unknown;
  hint?: string;
}

interface WizardMessage {
  kind: string;
  id?: string;
  title?: string;
  message?: string;
  label?: string;
  options?: WizardOption[];
  initialValue?: unknown;
  initialValues?: unknown[];
  placeholder?: string;
  searchable?: boolean;
}

interface NoteEntry {
  title?: string;
  body: string;
}

// ── Utilities ──────────────────────────────────────────────

function escapeHtml(str: unknown): string {
  if (typeof str !== "string") {
    return "";
  }
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: unknown): string {
  if (typeof str !== "string") {
    return "";
  }
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// ── Main ───────────────────────────────────────────────────

export function bootWizard(): void {
  const root = $("wizard-root") as HTMLDivElement;
  if (!root) {
    return;
  }

  const wsPort = root.dataset.wsPort ?? location.port ?? "19821";

  let ws: WebSocket | null = null;
  let stepCount = 0;
  let pendingNotes: NoteEntry[] = [];
  let currentPrompt: WizardMessage | null = null;
  let introTitle = "";

  // ── Welcome screen ─────────────────────────────────────

  function showWelcome(): void {
    let h = '<div class="wizard"><div class="wizard-step"><div class="wizard-welcome">';
    h +=
      '<div class="wizard-welcome__logo"><img src="./assets/Popup_Img_Deco_1.png" alt="ShittimChest"></div>';
    h += '<div class="wizard-welcome__title">Welcome to ShittimChest</div>';
    h +=
      '<div class="wizard-welcome__desc">Let\'s get your AI companion up and running! This wizard will guide you through the essential setup in just a few steps.</div>';
    h += '<div class="wizard-welcome__steps">';
    h +=
      '<div class="wizard-welcome__step"><div class="wizard-welcome__step-num">1</div><div class="wizard-welcome__step-content"><div class="wizard-welcome__step-title">Security Review</div><div class="wizard-welcome__step-hint">Understand the security model and accept the terms</div></div></div>';
    h +=
      '<div class="wizard-welcome__step"><div class="wizard-welcome__step-num">2</div><div class="wizard-welcome__step-content"><div class="wizard-welcome__step-title">Choose AI Provider</div><div class="wizard-welcome__step-hint">Pick your preferred AI model and enter API credentials</div></div></div>';
    h +=
      '<div class="wizard-welcome__step"><div class="wizard-welcome__step-num">3</div><div class="wizard-welcome__step-content"><div class="wizard-welcome__step-title">Configure Gateway</div><div class="wizard-welcome__step-hint">Set up how your bot connects and communicates</div></div></div>';
    h +=
      '<div class="wizard-welcome__step"><div class="wizard-welcome__step-num">4</div><div class="wizard-welcome__step-content"><div class="wizard-welcome__step-title">Ready to Go!</div><div class="wizard-welcome__step-hint">Launch the gateway and start chatting with your companion</div></div></div>';
    h += "</div>";
    h +=
      '<div class="wizard-welcome__actions"><button class="wizard-btn primary" id="start-wizard">Start Setup</button></div>';
    h += "</div></div></div>";
    root.innerHTML = h;
    $("start-wizard")?.addEventListener("click", () => connect());
  }

  // ── WebSocket ──────────────────────────────────────────

  function connect(): void {
    render("connecting");
    ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    ws.addEventListener("open", () => {
      /* server drives the flow */
    });
    ws.addEventListener("message", (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string) as WizardMessage;
        handleMessage(msg);
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener("close", () => {
      if (!document.querySelector(".wizard-complete") && !document.querySelector(".wizard-error")) {
        render("disconnected");
      }
    });
    ws.addEventListener("error", () => {
      /* handled by onclose */
    });
  }

  function sendResponse(id: string, value: unknown): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id, value }));
    }
  }

  // ── Message handler ────────────────────────────────────

  function handleMessage(msg: WizardMessage): void {
    switch (msg.kind) {
      case "intro":
        introTitle = msg.title ?? "";
        break;

      case "note":
        pendingNotes.push({ title: msg.title, body: msg.message ?? "" });
        break;

      case "select":
      case "multiselect":
      case "text":
      case "confirm":
        if (msg.message === "__ack_intro__" || msg.message === "__ack_note__") {
          sendResponse(msg.id!, true);
          return;
        }
        stepCount++;
        currentPrompt = msg;
        renderStep();
        break;

      case "progress-start":
        renderProgress(msg.label ?? "");
        break;

      case "progress-update":
        updateProgress(msg.message ?? "");
        break;

      case "progress-stop":
        break;

      case "complete":
        renderComplete();
        break;

      case "error":
        renderError(msg.message ?? "Unknown error");
        break;

      case "outro":
        renderComplete(msg.message);
        break;
    }
  }

  // ── Renderers ──────────────────────────────────────────

  function render(state: "connecting" | "disconnected"): void {
    if (state === "connecting") {
      root.innerHTML = `
        <div class="wizard">
          <div class="wizard-step">
            <div class="wizard-connecting">
              <div class="wizard-connecting__spinner"></div>
              <div class="wizard-connecting__text">Connecting to ShittimChest…</div>
            </div>
          </div>
        </div>
      `;
    } else {
      root.innerHTML = `
        <div class="wizard">
          <div class="wizard-step">
            <div class="wizard-error">
              <div class="wizard-error__icon">⚡</div>
              <div class="wizard-error__title">Disconnected</div>
              <div class="wizard-error__message">Connection to the setup wizard was lost.\nYou can close this window.</div>
            </div>
          </div>
        </div>
      `;
    }
  }

  function renderStep(): void {
    const msg = currentPrompt;
    if (!msg) {
      return;
    }

    const notesHtml = pendingNotes
      .map(
        (n) => `
      <div class="wizard-note">
        ${n.title ? '<div class="wizard-note__title">' + escapeHtml(n.title) + "</div>" : ""}
        <div class="wizard-note__body">${escapeHtml(n.body)}</div>
      </div>
    `,
      )
      .join("");
    pendingNotes = [];

    let contentHtml = "";

    if (msg.kind === "select") {
      contentHtml = renderSelectPrompt(msg);
    } else if (msg.kind === "multiselect") {
      contentHtml = renderMultiselectPrompt(msg);
    } else if (msg.kind === "text") {
      contentHtml = renderTextPrompt(msg);
    } else if (msg.kind === "confirm") {
      contentHtml = renderConfirmPrompt(msg);
    }

    const dotsHtml = Array.from({ length: Math.min(stepCount, 12) }, (_, i) => {
      const cls = i < stepCount - 1 ? "done" : i === stepCount - 1 ? "active" : "";
      return `<div class="wizard-step-dot ${cls}"></div>`;
    }).join("");

    root.innerHTML = `
      <div class="wizard">
        <div class="wizard-step">
          <div class="wizard-step-counter">${dotsHtml}</div>
          ${introTitle ? '<div class="wizard-step__title">' + escapeHtml(introTitle) + "</div>" : ""}
          ${notesHtml}
          ${msg.kind !== "__ack__" ? '<div class="wizard-step__subtitle">' + escapeHtml(msg.message) + "</div>" : ""}
          ${contentHtml}
        </div>
      </div>
    `;

    if (msg.kind === "select") {
      attachSelectListeners(msg);
    } else if (msg.kind === "multiselect") {
      attachMultiselectListeners(msg);
    } else if (msg.kind === "text") {
      attachTextListeners(msg);
    } else if (msg.kind === "confirm") {
      attachConfirmListeners(msg);
    }
  }

  // ── Select ─────────────────────────────────────────────

  function renderSelectPrompt(msg: WizardMessage): string {
    return `
      <div class="wizard-options" id="options-${msg.id}">
        ${(msg.options ?? [])
          .map((opt, i) => {
            const sel =
              JSON.stringify(opt.value) === JSON.stringify(msg.initialValue) ? " selected" : "";
            return `
            <div class="wizard-option${sel}" data-index="${i}">
              <div class="wizard-option__radio"></div>
              <div class="wizard-option__content">
                <div class="wizard-option__label">${escapeHtml(opt.label)}</div>
                ${opt.hint ? '<div class="wizard-option__hint">' + escapeHtml(opt.hint) + "</div>" : ""}
              </div>
            </div>`;
          })
          .join("")}
      </div>
      <div class="wizard-actions">
        <button class="wizard-btn primary" id="submit-${msg.id}">Continue</button>
      </div>
    `;
  }

  function attachSelectListeners(msg: WizardMessage): void {
    const container = $("options-" + msg.id)!;
    const submitBtn = $("submit-" + msg.id) as HTMLButtonElement;
    const options = msg.options ?? [];
    let selectedIndex = options.findIndex(
      (o) => JSON.stringify(o.value) === JSON.stringify(msg.initialValue),
    );
    if (selectedIndex < 0) {
      selectedIndex = 0;
    }

    updateSelection(container, selectedIndex);

    container.addEventListener("click", (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>(".wizard-option");
      if (!opt) {
        return;
      }
      selectedIndex = parseInt(opt.dataset.index!, 10);
      updateSelection(container, selectedIndex);
    });

    submitBtn.addEventListener("click", () => {
      submitBtn.disabled = true;
      sendResponse(msg.id!, options[selectedIndex].value);
    });
  }

  function updateSelection(container: HTMLElement, idx: number): void {
    container.querySelectorAll<HTMLElement>(".wizard-option").forEach((el, i) => {
      el.classList.toggle("selected", i === idx);
    });
  }

  // ── Multiselect ────────────────────────────────────────

  function renderMultiselectPrompt(msg: WizardMessage): string {
    const searchHtml = msg.searchable
      ? `<input class="wizard-search" placeholder="Search…" id="search-${msg.id}">`
      : "";

    return `
      ${searchHtml}
      <div class="wizard-options" id="options-${msg.id}">
        ${(msg.options ?? [])
          .map((opt, i) => {
            const checked = (msg.initialValues ?? []).some(
              (v) => JSON.stringify(v) === JSON.stringify(opt.value),
            );
            return `
            <div class="wizard-option${checked ? " selected" : ""}" data-index="${i}">
              <div class="wizard-option__checkbox"></div>
              <div class="wizard-option__content">
                <div class="wizard-option__label">${escapeHtml(opt.label)}</div>
                ${opt.hint ? '<div class="wizard-option__hint">' + escapeHtml(opt.hint) + "</div>" : ""}
              </div>
            </div>`;
          })
          .join("")}
      </div>
      <div class="wizard-actions">
        <button class="wizard-btn primary" id="submit-${msg.id}">Continue</button>
      </div>
    `;
  }

  function attachMultiselectListeners(msg: WizardMessage): void {
    const container = $("options-" + msg.id)!;
    const submitBtn = $("submit-" + msg.id) as HTMLButtonElement;
    const searchInput = $("search-" + msg.id) as HTMLInputElement | null;
    const options = msg.options ?? [];
    const selected = new Set((msg.initialValues ?? []).map((v) => JSON.stringify(v)));

    container.addEventListener("click", (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>(".wizard-option");
      if (!opt) {
        return;
      }
      const idx = parseInt(opt.dataset.index!, 10);
      const key = JSON.stringify(options[idx].value);
      if (selected.has(key)) {
        selected.delete(key);
        opt.classList.remove("selected");
      } else {
        selected.add(key);
        opt.classList.add("selected");
      }
    });

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const q = searchInput.value.toLowerCase().trim();
        container.querySelectorAll<HTMLElement>(".wizard-option").forEach((el, i) => {
          const o = options[i];
          const text = (o.label + " " + (o.hint ?? "")).toLowerCase();
          el.style.display = !q || text.includes(q) ? "" : "none";
        });
      });
    }

    submitBtn.addEventListener("click", () => {
      submitBtn.disabled = true;
      const values = options
        .filter((o) => selected.has(JSON.stringify(o.value)))
        .map((o) => o.value);
      sendResponse(msg.id!, values);
    });
  }

  // ── Text ───────────────────────────────────────────────

  function renderTextPrompt(msg: WizardMessage): string {
    return `
      <input class="wizard-input" id="input-${msg.id}"
             type="text"
             value="${escapeAttr(msg.initialValue ?? "")}"
             placeholder="${escapeAttr(msg.placeholder ?? "")}">
      <div class="wizard-input-error" id="error-${msg.id}"></div>
      <div class="wizard-actions">
        <button class="wizard-btn primary" id="submit-${msg.id}">Continue</button>
      </div>
    `;
  }

  function attachTextListeners(msg: WizardMessage): void {
    const input = $("input-" + msg.id) as HTMLInputElement;
    const submitBtn = $("submit-" + msg.id) as HTMLButtonElement;

    input.focus();

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        submitBtn.click();
      }
    });

    submitBtn.addEventListener("click", () => {
      submitBtn.disabled = true;
      sendResponse(msg.id!, input.value);
    });
  }

  // ── Confirm ────────────────────────────────────────────

  function renderConfirmPrompt(msg: WizardMessage): string {
    return `
      <div class="wizard-confirm-buttons">
        <button class="wizard-btn primary" id="yes-${msg.id}">Yes</button>
        <button class="wizard-btn danger" id="no-${msg.id}">No</button>
      </div>
    `;
  }

  function attachConfirmListeners(msg: WizardMessage): void {
    const yesBtn = $("yes-" + msg.id) as HTMLButtonElement;
    const noBtn = $("no-" + msg.id) as HTMLButtonElement;

    yesBtn.addEventListener("click", () => {
      yesBtn.disabled = true;
      noBtn.disabled = true;
      sendResponse(msg.id!, true);
    });

    noBtn.addEventListener("click", () => {
      yesBtn.disabled = true;
      noBtn.disabled = true;
      sendResponse(msg.id!, false);
    });
  }

  // ── Progress ───────────────────────────────────────────

  function renderProgress(label: string): void {
    const existing = document.querySelector<HTMLElement>(".wizard-progress");
    if (existing) {
      existing.querySelector(".wizard-progress__label")!.textContent = label;
      return;
    }
    const step = document.querySelector<HTMLElement>(".wizard-step");
    if (step) {
      const div = document.createElement("div");
      div.className = "wizard-progress";
      div.innerHTML = `
        <div class="wizard-progress__spinner"></div>
        <div class="wizard-progress__label">${escapeHtml(label)}</div>
      `;
      step.appendChild(div);
    }
  }

  function updateProgress(message: string): void {
    const label = document.querySelector(".wizard-progress__label");
    if (label) {
      label.textContent = message;
    }
  }

  // ── Complete / Error ───────────────────────────────────

  function renderComplete(message?: string): void {
    root.innerHTML = `
      <div class="wizard">
        <div class="wizard-step">
          <div class="wizard-complete">
            <div class="wizard-complete__icon">✓</div>
            <div class="wizard-complete__title">Setup Complete!</div>
            <div class="wizard-complete__sub">${escapeHtml(message ?? "ShittimChest is ready to use. You can close this window.")}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderError(message: string): void {
    root.innerHTML = `
      <div class="wizard">
        <div class="wizard-step">
          <div class="wizard-error">
            <div class="wizard-error__icon">✕</div>
            <div class="wizard-error__title">Setup Error</div>
            <div class="wizard-error__message">${escapeHtml(message)}</div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Boot ───────────────────────────────────────────────
  showWelcome();
}

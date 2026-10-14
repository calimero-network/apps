// Minecraft-style pause menu: Esc (or O) opens the game menu — Back to game /
// Options… / invite / leave — and Options… swaps the panel to the settings
// screen (zoom = the 2D FOV, controls reference) with a Done button back.

const css = `
/* Smoked glass (dark --glass-* tokens, see index.html). The overlay dims the
   game; the panel floating on it is a dialog, so it is SOLID, never frosted. */
.mto-overlay { position: fixed; inset: 0; z-index: 15; display: flex; align-items: center;
  justify-content: center; background: rgba(5,7,14,0.6); color: var(--glass-ink);
  font-family: var(--glass-font); -webkit-font-smoothing: antialiased; }
.mto-panel { background: var(--glass-surface-solid); border: 1px solid var(--glass-line-strong);
  border-radius: var(--glass-radius-lg); box-shadow: var(--glass-shadow-float);
  padding: 22px 26px; min-width: 320px; max-width: 92vw; max-height: 88vh; overflow-y: auto; }
.mto-panel h3 { margin: 0 0 14px; font-size: 16px; font-weight: 700; text-align: center; }
.mto-keys { display: grid; grid-template-columns: auto 1fr; gap: 7px 14px; font-size: 13px;
  color: var(--glass-ink-2); margin: 16px 0 18px; align-items: center; }
.mto-keys kbd { background: var(--glass-sunken); border: 1px solid var(--glass-line); border-radius: 6px; padding: 2px 8px;
  font-size: 11px; font-family: monospace; justify-self: start; white-space: nowrap; color: var(--glass-ink); }
.mto-row { display: flex; align-items: center; gap: 12px; margin: 14px 0; font-size: 13px;
  color: var(--glass-ink-2); }
.mto-row input[type=range] { flex: 1; accent-color: var(--glass-tint); }
.mto-btn { width: 100%; margin-top: 10px; padding: 11px; border-radius: 999px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
.mto-btn.primary { background: var(--glass-ink); color: var(--glass-on-ink); }
.mto-btn.ghost { background: var(--glass-sunken); color: var(--glass-ink); box-shadow: inset 0 0 0 1px var(--glass-line-strong); }
.mto-btn.danger { background: var(--glass-bad-bg); color: var(--glass-bad-ink); }
.mto-btn:hover { filter: brightness(1.12); }
.mto-note { font-size: 11px; color: var(--glass-muted); margin-top: 10px; }
`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

const ZOOM_KEY = "mt-zoom";
export const ZOOM_DEFAULT = 1;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;

export interface PauseCallbacks {
  onLeave: () => void;
  /** mint a copyable invite for the current world */
  onInvite?: () => Promise<string>;
  /** live-apply the zoom slider to the renderer */
  onZoomChange?: (zoom: number) => void;
}

export class PauseMenu {
  open = false;
  private root: HTMLElement;
  private zoom: number;
  private screen: "main" | "options" = "main";

  constructor(
    private parent: HTMLElement,
    private callbacks: PauseCallbacks,
  ) {
    injectStyle();
    this.root = document.createElement("div");
    this.root.className = "mto-overlay";
    this.root.dataset.testid = "options-overlay";
    const stored = Number(localStorage.getItem(ZOOM_KEY));
    this.zoom = stored >= ZOOM_MIN && stored <= ZOOM_MAX ? stored : ZOOM_DEFAULT;
  }

  /** view zoom (0.6×–1.6×), restored from the last session */
  getZoom(): number {
    return this.zoom;
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.remove();
  }

  private show(): void {
    this.open = true;
    this.screen = "main";
    this.render();
    this.parent.appendChild(this.root);
  }

  private render(): void {
    if (this.screen === "main") this.renderMain();
    else this.renderOptions();
  }

  private renderMain(): void {
    this.root.innerHTML = `
      <div class="mto-panel">
        <h3>Game menu</h3>
        <button class="mto-btn primary" data-testid="resume-btn">Back to game</button>
        <button class="mto-btn ghost" data-testid="options-btn">Options…</button>
        ${this.callbacks.onInvite ? `<button class="mto-btn ghost" data-testid="invite-btn">Copy world invite</button>` : ""}
        <button class="mto-btn danger" data-testid="leave-btn">Save &amp; leave world</button>
      </div>`;
    this.root.querySelector("[data-testid=resume-btn]")!.addEventListener("click", () => this.hide());
    this.root.querySelector("[data-testid=options-btn]")!.addEventListener("click", () => {
      this.screen = "options";
      this.render();
    });
    this.root.querySelector("[data-testid=leave-btn]")!.addEventListener("click", () =>
      this.callbacks.onLeave(),
    );
    const inviteBtn = this.root.querySelector<HTMLButtonElement>("[data-testid=invite-btn]");
    if (inviteBtn && this.callbacks.onInvite) {
      inviteBtn.addEventListener("click", async () => {
        inviteBtn.disabled = true;
        inviteBtn.textContent = "Creating invite…";
        try {
          const code = await this.callbacks.onInvite!();
          await navigator.clipboard.writeText(code);
          inviteBtn.textContent = "Invite copied!";
        } catch {
          inviteBtn.textContent = "Invite failed — try again";
        } finally {
          // brief confirmation, then back to normal — mint as many as you like
          setTimeout(() => {
            inviteBtn.textContent = "Copy world invite";
            inviteBtn.disabled = false;
          }, 2500);
        }
      });
    }
  }

  private renderOptions(): void {
    this.root.innerHTML = `
      <div class="mto-panel">
        <h3>Options</h3>
        <div class="mto-row">
          <span>zoom</span>
          <input type="range" min="${ZOOM_MIN}" max="${ZOOM_MAX}" step="0.1" value="${this.zoom}"
            data-testid="zoom-slider" />
          <span data-testid="zoom-value">${this.zoom.toFixed(1)}×</span>
        </div>
        <div class="mto-keys">
          <kbd>A / D</kbd><span>move</span>
          <kbd>Space or W</kbd><span>jump (again mid-air from water)</span>
          <kbd>LMB</kbd><span>dig (hold)</span>
          <kbd>RMB</kbd><span>place (hold)</span>
          <kbd>1–9 / wheel</kbd><span>pick tile</span>
          <kbd>Esc / O</kbd><span>game menu</span>
        </div>
        <button class="mto-btn primary" data-testid="options-done-btn">Done</button>
        <div class="mto-note">Zoom out to see more of the world at once — it's the 2D FOV.</div>
      </div>`;
    const slider = this.root.querySelector<HTMLInputElement>("[data-testid=zoom-slider]")!;
    const value = this.root.querySelector<HTMLElement>("[data-testid=zoom-value]")!;
    slider.addEventListener("input", () => {
      this.zoom = Number(slider.value);
      value.textContent = `${this.zoom.toFixed(1)}×`;
      localStorage.setItem(ZOOM_KEY, slider.value);
      this.callbacks.onZoomChange?.(this.zoom); // live preview behind the menu
    });
    this.root.querySelector("[data-testid=options-done-btn]")!.addEventListener("click", () => {
      this.screen = "main";
      this.render();
    });
  }
}

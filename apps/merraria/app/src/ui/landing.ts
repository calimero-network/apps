// Landing page + launcher. Three auth states:
//  1. anonymous          → "Connect a node" opens the connect popup: the
//                          well-known local endpoints render immediately and
//                          are pinged live (mero-react probeNodeHealth), plus
//                          a manual URL field. No node, no game — there is no
//                          offline mode.
//  2. authenticated      → pick an existing world or create one (admin API)
//  3. ready (has context)→ one-click "Enter shared world"
// Desktop SSO (full hash) never sees this page — main.ts auto-enters.

import {
  DEFAULT_LOCAL_NODE_PORTS,
  localNodeUrl,
  probeNodeHealth,
} from "@calimero-network/mero-react";
import {
  acceptWorldInvite,
  createWorld,
  createWorldInvite,
  joinWorld,
  listWorlds,
  resolveApplicationId,
} from "../net/admin";
import { beginWebLogin } from "../net/auth";
import { WorldAnim } from "./worldAnim";
import { clearSession, getSession, hasConnection, isAuthenticated, updateSession } from "../net/session";

export interface LaunchChoice {
  name: string;
}

const css = `
#mt-landing { position: fixed; inset: 0; overflow-y: auto; z-index: 20;
  background: #0b0e14; color: #fff; font-family: system-ui, -apple-system, sans-serif; }
.mtl-bg { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
.mtl-scrim { position: fixed; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(6,8,14,0.55) 0%, rgba(6,8,14,0.15) 35%,
    rgba(6,8,14,0.15) 65%, rgba(6,8,14,0.7) 100%); }
.mtl-wrap { position: relative; max-width: 520px; margin: 0 auto; padding: 20px 24px 18px;
  min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; }
.mtl-nav { display: flex; align-items: center; gap: 10px; }
.mtl-logo { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; }
.mtl-nav b { font-size: 18px; letter-spacing: 1px; text-shadow: 0 1px 6px rgba(0,0,0,0.8); }
.mtl-nav span { color: #cdd9e5; font-size: 12px; margin-left: auto;
  text-shadow: 0 1px 4px rgba(0,0,0,0.8); }
.mtl-center { flex: 1; display: flex; flex-direction: column; justify-content: center;
  padding: 14px 0; }
.mtl-center h1 { font-size: 28px; margin: 0 0 6px; line-height: 1.15; text-align: center;
  text-shadow: 0 2px 12px rgba(0,0,0,0.85); }
.mtl-center h1 em { font-style: normal; color: #58c56b; }
.mtl-center p.lead { color: #dbe5ee; font-size: 14px; line-height: 1.5; margin: 0 0 14px;
  text-align: center; text-shadow: 0 1px 8px rgba(0,0,0,0.85); }
.mtl-card { background: rgba(11,14,20,0.82); backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.14); border-radius: 16px; padding: 18px 24px 20px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.45); }
.mtl-card h3 { margin: 0 0 16px; font-size: 16px; }
.mtl-card label { display: block; text-align: left; font-size: 12px; color: #9fb0c3; margin: 12px 0 4px; }
.mtl-card input, .mtl-modal input { width: 100%; box-sizing: border-box; padding: 10px 11px;
  border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.32);
  color: #fff; font-size: 14px; }
.mtl-btn { width: 100%; margin-top: 14px; padding: 12px; border-radius: 9px; border: none;
  font-size: 15px; font-weight: 600; cursor: pointer; }
.mtl-btn.primary { background: #4f8cff; color: #fff; }
.mtl-btn.green { background: #3f9950; color: #fff; }
.mtl-btn.ghost { background: rgba(255,255,255,0.1); color: #fff; }
.mtl-link { display: inline-block; margin-top: 12px; background: none; border: none; color: #8fa3ba;
  font-size: 12px; cursor: pointer; text-decoration: underline; }
.mtl-divider { display: flex; align-items: center; gap: 10px; color: #6d7f92; font-size: 11px;
  margin-top: 18px; text-transform: uppercase; letter-spacing: 1px; }
.mtl-divider::before, .mtl-divider::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,0.12); }
.mtl-worlds { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; }
.mtl-world { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); }
.mtl-world code { font-size: 11px; color: #9fb0c3; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.mtl-world button { padding: 6px 14px; border-radius: 6px; border: none; background: #4f8cff;
  color: #fff; font-weight: 600; cursor: pointer; }
.mtl-note { font-size: 12px; color: #8fa3ba; margin-top: 10px; line-height: 1.5; }
.mtl-error { color: #ff8686; font-size: 12px; margin-top: 10px; min-height: 14px; }
.mtl-footer { color: #b7c4d2; font-size: 12px; text-align: center;
  text-shadow: 0 1px 4px rgba(0,0,0,0.8); }
.mtl-nodes { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.mtl-node-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(88,197,107,0.35); }
.mtl-node-row code { font-size: 12px; color: #cdd9e5; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.mtl-node-row .mtl-dot { width: 8px; height: 8px; border-radius: 50%; background: #58c56b;
  box-shadow: 0 0 6px #58c56b; flex: none; }
.mtl-node-row button { padding: 6px 14px; border-radius: 6px; border: none; background: #3f9950;
  color: #fff; font-weight: 600; cursor: pointer; }
.mtl-modal-shade { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; padding: 16px; }
.mtl-modal { width: min(420px, 94vw); box-sizing: border-box; background: rgba(10,13,18,0.97);
  border: 1px solid rgba(255,255,255,0.18); border-radius: 16px; padding: 18px 24px 20px;
  box-shadow: 0 16px 60px rgba(0,0,0,0.7); color: #fff; }
.mtl-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.mtl-modal-head h3 { margin: 0; font-size: 16px; }
.mtl-modal-close { background: none; border: none; color: #9fb0c3; font-size: 18px;
  cursor: pointer; padding: 2px 6px; line-height: 1; }
.mtl-modal-close:hover { color: #fff; }
.mtl-scan { font-size: 12px; color: #8fa3ba; animation: mtlpulse 1.2s ease-in-out infinite; }
@keyframes mtlpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.mtl-logo svg { width: 34px; height: 34px; display: block; }
.mtl-social { display: flex; gap: 20px; justify-content: center; align-items: center;
  flex-wrap: wrap; margin-top: 8px; }
.mtl-social a { color: #8fa3ba; text-decoration: none; display: inline-flex; align-items: center;
  gap: 6px; font-size: 12px; }
.mtl-social a:hover { color: #fff; }
.mtl-social svg { width: 15px; height: 15px; fill: currentColor; }
`;

export const LOGO_SVG = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="merraria logo">
  <rect x="2" y="2" width="60" height="60" rx="6" fill="#8a5a33"/>
  <path d="M2 8a6 6 0 0 1 6-6h48a6 6 0 0 1 6 6v10H2z" fill="#4f9c3a"/>
  <rect x="2" y="2" width="60" height="5" rx="2.5" fill="#6fc454"/>
  <path d="M16 58l-5-5 31-31 5 5z" fill="#6b5233"/>
  <path d="M24 8l6-4 20 14-6 7z" fill="#c8ccd4"/>
  <path d="M56 40l4-6-14-20-6 6z" fill="#969ca8"/>
</svg>`;

const SOCIALS: { label: string; href: string; icon: string }[] = [
  {
    label: "calimero.network",
    href: "https://www.calimero.network/",
    icon: `<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.93 9h-3.45a15.7 15.7 0 0 0-1.4-6.13A8.02 8.02 0 0 1 19.93 11ZM12 4.06c.9 1.2 2.05 3.6 2.37 6.94H9.63c.32-3.34 1.47-5.74 2.37-6.94ZM4.07 13h3.45a15.7 15.7 0 0 0 1.4 6.13A8.02 8.02 0 0 1 4.07 13Zm3.45-2H4.07a8.02 8.02 0 0 1 4.85-6.13A15.7 15.7 0 0 0 7.52 11ZM12 19.94c-.9-1.2-2.05-3.6-2.37-6.94h4.74c-.32 3.34-1.47 5.74-2.37 6.94Zm3.08-.81a15.7 15.7 0 0 0 1.4-6.13h3.45a8.02 8.02 0 0 1-4.85 6.13Z"/></svg>`,
  },
  {
    label: "Docs",
    href: "https://docs.calimero.network",
    icon: `<svg viewBox="0 0 24 24"><path d="M6 2h9a3 3 0 0 1 3 3v14.5a.5.5 0 0 1-.5.5H7a1 1 0 0 0 0 2h10.5a.5.5 0 0 1 0 1H7a3 3 0 0 1-3-3V5a3 3 0 0 1 2-2.83V2Zm2 4h6a1 1 0 1 1 0 2H8a1 1 0 0 1 0-2Z"/></svg>`,
  },
  {
    label: "GitHub",
    href: "https://github.com/calimero-network",
    icon: `<svg viewBox="0 0 24 24"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.35.95.1-.74.4-1.25.72-1.53-2.55-.29-5.23-1.28-5.23-5.69 0-1.25.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.77 1.05.77 2.13v3.15c0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>`,
  },
  {
    label: "Source",
    href: "https://github.com/calimero-network/merraria",
    icon: `<svg viewBox="0 0 24 24"><path d="M8.7 6.3a1 1 0 0 1 0 1.4L4.42 12l4.3 4.3a1 1 0 1 1-1.42 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.42 0Zm6.6 0a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4l4.28-4.3-4.29-4.3a1 1 0 0 1 0-1.4Z"/></svg>`,
  },
  {
    label: "X",
    href: "https://x.com/CalimeroNetwork",
    icon: `<svg viewBox="0 0 24 24"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.4Z"/></svg>`,
  },
  {
    label: "Discord",
    href: "https://discord.gg/wZRC73DVpU",
    icon: `<svg viewBox="0 0 24 24"><path d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.6 13.6 0 0 0-.63 1.29 18.3 18.3 0 0 0-5.48 0A13.6 13.6 0 0 0 8.62 2.8 19.8 19.8 0 0 0 3.66 4.37C.53 9.05-.32 13.6.1 18.08a19.9 19.9 0 0 0 6.08 3.11c.49-.67.93-1.38 1.3-2.13a12.9 12.9 0 0 1-2.05-.99c.17-.13.34-.26.5-.39a14.2 14.2 0 0 0 12.12 0c.17.13.33.26.5.39-.65.39-1.34.72-2.05.99.38.75.81 1.46 1.3 2.13a19.8 19.8 0 0 0 6.08-3.11c.5-5.18-.84-9.68-3.56-13.71ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42s.95-2.43 2.16-2.43c1.21 0 2.18 1.1 2.16 2.43 0 1.33-.95 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42s.95-2.43 2.15-2.43c1.22 0 2.18 1.1 2.16 2.43 0 1.33-.94 2.42-2.16 2.42Z"/></svg>`,
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/calimero-network/",
    icon: `<svg viewBox="0 0 24 24"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0Z"/></svg>`,
  },
];

export class Landing {
  private root: HTMLElement;
  private anim: WorldAnim | null = null;

  constructor(parent: HTMLElement) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "mt-landing";
    this.root.dataset.testid = "landing";
    parent.appendChild(this.root);
  }

  show(defaults: { name: string; seed: number }): Promise<LaunchChoice> {
    return new Promise((resolve) => {
      this.render(defaults, (choice) => {
        this.anim?.stop();
        this.root.remove();
        resolve(choice);
      });
    });
  }

  private render(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    this.root.innerHTML = `
      <canvas class="mtl-bg" data-testid="world-anim"></canvas>
      <div class="mtl-scrim"></div>
      <div class="mtl-wrap">
        <div class="mtl-nav">
          <div class="mtl-logo">${LOGO_SVG}</div><b>merraria</b>
          <span>on Calimero · P2P</span>
        </div>
        <div class="mtl-center">
          <h1>A Terraria-style world that lives on <em>your</em> nodes.</h1>
          <p class="lead">Mine and build together in real time — no game server,
          just peer-to-peer Calimero nodes.</p>
          <div class="mtl-card" data-testid="play-card"><div id="mtl-play"></div></div>
        </div>
        <div class="mtl-footer">
          merraria · a Calimero network showcase
          <div class="mtl-social" data-testid="social-links">
            ${SOCIALS.map(
              (s) =>
                `<a href="${s.href}" target="_blank" rel="noopener noreferrer">${s.icon}${s.label}</a>`,
            ).join("")}
          </div>
        </div>
      </div>
    `;
    // the landing IS the world: live terrain, day/night, wandering miners
    this.anim?.stop();
    this.anim = new WorldAnim(this.root.querySelector<HTMLCanvasElement>(".mtl-bg")!);
    this.anim.start();
    this.renderPlayCard(defaults, done);
  }

  private playCardEl(): HTMLElement {
    return this.root.querySelector("#mtl-play")!;
  }

  private renderPlayCard(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    if (hasConnection()) this.renderReady(defaults, done);
    else if (isAuthenticated()) this.renderWorldPicker(defaults, done);
    else this.renderAnonymous(defaults, done);
  }

  private commonInputs(defaults: { name: string }): string {
    return `
      <label>player name</label>
      <input id="mtl-name" data-testid="name-input" value="${escapeHtml(defaults.name)}" maxlength="16" />
    `;
  }

  private readChoice(): LaunchChoice {
    const name = (this.root.querySelector<HTMLInputElement>("#mtl-name")?.value || "Player").trim();
    return { name };
  }

  private readSeed(fallback: number): number {
    const raw = this.root.querySelector<HTMLInputElement>("#mtl-seed")?.value;
    return Math.abs(Math.floor(Number(raw))) || fallback;
  }

  // state 3: session has node + context — one click to play
  private renderReady(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    el.innerHTML = `
      <h3>You're connected</h3>
      ${this.commonInputs(defaults)}
      <button class="mtl-btn primary" data-testid="connect-btn">Enter shared world</button>
      <button class="mtl-btn ghost" data-testid="invite-btn">Invite friends</button>
      <button class="mtl-link" data-testid="disconnect-btn">Disconnect from node</button>
      <div class="mtl-error" data-testid="ready-error"></div>
    `;
    el.querySelector("[data-testid=connect-btn]")!.addEventListener("click", () =>
      done(this.readChoice()),
    );
    const inviteBtn = el.querySelector<HTMLButtonElement>("[data-testid=invite-btn]")!;
    inviteBtn.addEventListener("click", async () => {
      const errEl = el.querySelector<HTMLElement>("[data-testid=ready-error]")!;
      errEl.textContent = "";
      inviteBtn.disabled = true;
      inviteBtn.textContent = "Creating invite…";
      try {
        const code = await createWorldInvite();
        await navigator.clipboard.writeText(code);
        inviteBtn.textContent = "Invite copied — send it to a friend!";
      } catch (e) {
        inviteBtn.textContent = "Invite friends";
        errEl.textContent = `Could not create invite: ${errText(e)}`;
      } finally {
        inviteBtn.disabled = false;
      }
    });
    el.querySelector("[data-testid=disconnect-btn]")!.addEventListener("click", () => {
      clearSession();
      this.renderPlayCard(defaults, done);
    });
  }

  // state 2: logged into a node — pick or create a world
  private renderWorldPicker(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    el.innerHTML = `
      <h3>Choose a world</h3>
      ${this.commonInputs(defaults)}
      <div class="mtl-worlds" data-testid="world-list"><div class="mtl-note">Loading worlds…</div></div>
      <div class="mtl-divider">or join with an invite</div>
      <input id="mtl-invite" data-testid="invite-input" placeholder="paste an invite code" />
      <button class="mtl-btn primary" data-testid="join-invite-btn">Join with invite</button>
      <div class="mtl-divider">or create one</div>
      <label>world name</label>
      <input id="mtl-world-name" data-testid="world-name-input" value="surface" maxlength="24" />
      <label>seed</label>
      <input id="mtl-seed" data-testid="seed-input" value="${defaults.seed}" />
      <button class="mtl-btn green" data-testid="create-world-btn">Create world</button>
      <button class="mtl-link" data-testid="disconnect-btn">Disconnect from node</button>
      <div class="mtl-error" data-testid="picker-error"></div>
    `;
    const errEl = el.querySelector<HTMLElement>("[data-testid=picker-error]")!;
    const listEl = el.querySelector<HTMLElement>("[data-testid=world-list]")!;

    el.querySelector("[data-testid=disconnect-btn]")!.addEventListener("click", () => {
      clearSession();
      this.renderPlayCard(defaults, done);
    });
    el.querySelector("[data-testid=join-invite-btn]")!.addEventListener("click", async () => {
      errEl.textContent = "";
      const code = el.querySelector<HTMLInputElement>("#mtl-invite")?.value ?? "";
      if (!code.trim()) {
        errEl.textContent = "Paste the invite code a friend sent you.";
        return;
      }
      try {
        await acceptWorldInvite(code);
        done(this.readChoice());
      } catch (e) {
        errEl.textContent = `Could not join with invite: ${errText(e)}`;
      }
    });

    void (async () => {
      let applicationId: string | null = null;
      try {
        applicationId = await resolveApplicationId();
        const worlds = await listWorlds(applicationId);
        if (worlds.length === 0) {
          listEl.innerHTML = `<div class="mtl-note">No worlds on this node yet — create the first one below.</div>`;
        } else {
          listEl.innerHTML = "";
          worlds.forEach((w, i) => {
            const row = document.createElement("div");
            row.className = "mtl-world";
            row.innerHTML = `<code>${escapeHtml(w.contextId)}</code>
              <button data-testid="join-world-${i}">Join</button>`;
            row.querySelector("button")!.addEventListener("click", async () => {
              errEl.textContent = "";
              try {
                const identity = await joinWorld(w.contextId);
                // switching worlds: the old world's namespace/group/name must
                // not leak into this one (invites would target the wrong world)
                updateSession({
                  contextId: w.contextId,
                  namespaceId: null,
                  groupId: null,
                  worldName: null,
                  executorPublicKey: identity,
                });
                done(this.readChoice());
              } catch (e) {
                errEl.textContent = `Could not join: ${errText(e)}`;
              }
            });
            listEl.appendChild(row);
          });
        }
      } catch (e) {
        listEl.innerHTML = `<div class="mtl-note">Could not list worlds (${escapeHtml(errText(e))}).</div>`;
      }

      el.querySelector("[data-testid=create-world-btn]")!.addEventListener("click", async () => {
        errEl.textContent = "";
        if (!applicationId) {
          errEl.textContent = "merraria is not installed on this node.";
          return;
        }
        const worldName =
          el.querySelector<HTMLInputElement>("#mtl-world-name")?.value.trim() || "surface";
        const choice = this.readChoice();
        try {
          const created = await createWorld(applicationId, worldName, this.readSeed(defaults.seed));
          updateSession({
            contextId: created.contextId,
            namespaceId: created.namespaceId,
            groupId: created.groupId,
            worldName,
            executorPublicKey: created.memberPublicKey || getSession().executorPublicKey,
          });
          done(choice);
        } catch (e) {
          errEl.textContent = `Could not create world: ${errText(e)}`;
        }
      });
    })();
  }

  // state 1: anonymous — the game is online-only, so the only path forward is
  // connecting a node. Nothing is probed on page load (no surprise browser
  // local-network prompt): the "Connect a node" button opens a popup that
  // pings the well-known local endpoints on demand.
  private renderAnonymous(defaults: { name: string; seed: number }, _done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    el.innerHTML = `
      <h3>Play now</h3>
      ${this.commonInputs(defaults)}
      <button class="mtl-btn green" data-testid="connect-open-btn">Connect a node</button>
      <div class="mtl-note">Merraria runs on your Calimero node — connect one to play.
        You'll authenticate on your node and come straight back; opening from the
        Calimero desktop skips this page entirely. No node yet?
        <a href="https://docs.calimero.network/getting-started/" target="_blank"
        rel="noopener noreferrer" style="color:#8fa3ba">Run one</a>.</div>
    `;
    // the anonymous card can never start the game (_done unused): the only
    // exit is beginWebLogin's redirect, which re-enters as picker/ready
    el.querySelector("[data-testid=connect-open-btn]")!.addEventListener("click", () =>
      this.openConnectModal(),
    );
  }

  /**
   * The connect popup: the well-known local endpoints are pinged on open and
   * only the LIVE ones are listed (a dead port is noise, not a choice) — so
   * there is nothing to refresh. Rescan re-probes; the manual URL field is
   * always there as the fallback.
   */
  private openConnectModal(): void {
    const shade = document.createElement("div");
    shade.className = "mtl-modal-shade";
    shade.dataset.testid = "connect-modal";
    shade.innerHTML = `
      <div class="mtl-modal">
        <div class="mtl-modal-head">
          <h3>Connect a node</h3>
          <button class="mtl-modal-close" data-testid="connect-close" aria-label="Close">✕</button>
        </div>
        <div class="mtl-nodes" data-testid="discovered-nodes"></div>
        <div class="mtl-note" data-testid="scan-note"></div>
        <button class="mtl-btn ghost" data-testid="rescan-btn">Rescan</button>
        <div class="mtl-divider">or your node url</div>
        <input id="mtl-node" data-testid="node-url-input" placeholder="http://localhost:2428" />
        <button class="mtl-btn primary" data-testid="web-login-btn">Connect</button>
        <div class="mtl-error" data-testid="login-error"></div>
      </div>
    `;
    this.root.appendChild(shade);

    let abort = new AbortController();
    const close = () => {
      abort.abort();
      shade.remove();
    };
    shade.addEventListener("click", (e) => {
      if (e.target === shade) close();
    });
    shade.querySelector("[data-testid=connect-close]")!.addEventListener("click", close);

    const nodesEl = shade.querySelector<HTMLElement>("[data-testid=discovered-nodes]")!;
    const noteEl = shade.querySelector<HTMLElement>("[data-testid=scan-note]")!;

    const scan = () => {
      abort.abort();
      abort = new AbortController();
      const signal = abort.signal;
      noteEl.textContent = "";
      nodesEl.innerHTML = `<div class="mtl-scan" data-testid="scan-progress">Scanning for local nodes…</div>`;
      let found = 0;
      const probes = DEFAULT_LOCAL_NODE_PORTS.map((port, i) => {
        const url = localNodeUrl(port);
        return probeNodeHealth(url, { signal }).then((alive) => {
          if (signal.aborted || !alive) return false;
          if (found++ === 0) nodesEl.innerHTML = ""; // first hit clears the scanning note
          const row = document.createElement("div");
          row.className = "mtl-node-row";
          row.innerHTML = `<span class="mtl-dot"></span><code>${escapeHtml(url)}</code>
            <button data-testid="discovered-node-${i}">Connect</button>`;
          row.querySelector("button")!.addEventListener("click", () => beginWebLogin(url));
          nodesEl.appendChild(row);
          return true;
        });
      });
      void Promise.all(probes).then((alive) => {
        if (signal.aborted) return;
        if (!alive.some(Boolean)) {
          nodesEl.innerHTML = "";
          noteEl.textContent = "No local nodes found — rescan, or enter your node's URL below.";
        }
      });
    };
    shade.querySelector("[data-testid=rescan-btn]")!.addEventListener("click", scan);
    scan();

    shade.querySelector("[data-testid=web-login-btn]")!.addEventListener("click", () => {
      const url = shade.querySelector<HTMLInputElement>("#mtl-node")?.value.trim() ?? "";
      const errEl = shade.querySelector<HTMLElement>("[data-testid=login-error]")!;
      if (!/^https?:\/\/.+/.test(url)) {
        errEl.textContent = "Enter your node's URL (e.g. http://localhost:2428).";
        return;
      }
      beginWebLogin(url); // navigates away; the callback hash brings us back
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** human-readable error text — the message, not "Error: message" */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

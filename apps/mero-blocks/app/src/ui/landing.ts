// Landing page + launcher. Three auth states:
//  1. anonymous          → play offline, or connect a node (web login redirect)
//  2. authenticated      → pick an existing world or create one (admin API)
//  3. ready (has context)→ one-click "Enter shared world"
// Desktop SSO (full hash) never sees this page — main.ts auto-enters.

import { createWorld, joinContext, listWorlds, resolveApplicationId } from "../net/admin";
import { beginWebLogin } from "../net/auth";
import { clearSession, getSession, hasConnection, isAuthenticated, updateSession } from "../net/session";

export interface LaunchChoice {
  mode: "offline" | "online";
  name: string;
  seed: number;
}

const css = `
#mb-landing { position: fixed; inset: 0; overflow-y: auto; z-index: 20;
  background: linear-gradient(175deg, #0b0e14 0%, #141c2b 45%, #1d2a1f 100%);
  color: #fff; font-family: system-ui, -apple-system, sans-serif; }
.mbl-wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
.mbl-nav { display: flex; align-items: center; gap: 10px; margin-bottom: 48px; }
.mbl-logo { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center;
  background: linear-gradient(135deg, #4f8cff, #58c56b); font-size: 18px; }
.mbl-nav b { font-size: 18px; letter-spacing: 1px; }
.mbl-nav span { color: #8fa3ba; font-size: 12px; margin-left: auto; }
.mbl-hero { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 40px; align-items: start; }
@media (max-width: 760px) { .mbl-hero { grid-template-columns: 1fr; } }
.mbl-hero h1 { font-size: 44px; margin: 0 0 14px; line-height: 1.1; }
.mbl-hero h1 em { font-style: normal; color: #58c56b; }
.mbl-hero p.lead { color: #b8c6d6; font-size: 16px; line-height: 1.6; margin: 0 0 22px; }
.mbl-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.mbl-badge { font-size: 11px; padding: 4px 10px; border-radius: 20px;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); color: #cdd9e5; }
.mbl-card { background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 16px; padding: 26px 28px; }
.mbl-card h3 { margin: 0 0 16px; font-size: 16px; }
.mbl-card label { display: block; text-align: left; font-size: 12px; color: #9fb0c3; margin: 12px 0 4px; }
.mbl-card input { width: 100%; box-sizing: border-box; padding: 10px 11px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.32); color: #fff; font-size: 14px; }
.mbl-btn { width: 100%; margin-top: 14px; padding: 12px; border-radius: 9px; border: none;
  font-size: 15px; font-weight: 600; cursor: pointer; }
.mbl-btn.primary { background: #4f8cff; color: #fff; }
.mbl-btn.green { background: #3f9950; color: #fff; }
.mbl-btn.ghost { background: rgba(255,255,255,0.1); color: #fff; }
.mbl-link { display: inline-block; margin-top: 12px; background: none; border: none; color: #8fa3ba;
  font-size: 12px; cursor: pointer; text-decoration: underline; }
.mbl-divider { display: flex; align-items: center; gap: 10px; color: #6d7f92; font-size: 11px;
  margin-top: 18px; text-transform: uppercase; letter-spacing: 1px; }
.mbl-divider::before, .mbl-divider::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,0.12); }
.mbl-worlds { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; }
.mbl-world { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); }
.mbl-world code { font-size: 11px; color: #9fb0c3; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.mbl-world button { padding: 6px 14px; border-radius: 6px; border: none; background: #4f8cff;
  color: #fff; font-weight: 600; cursor: pointer; }
.mbl-note { font-size: 12px; color: #8fa3ba; margin-top: 10px; line-height: 1.5; }
.mbl-error { color: #ff8686; font-size: 12px; margin-top: 10px; min-height: 14px; }
.mbl-section { margin-top: 64px; }
.mbl-section h2 { font-size: 24px; margin: 0 0 20px; }
.mbl-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 760px) { .mbl-steps { grid-template-columns: 1fr; } }
.mbl-step { background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 18px; }
.mbl-step b { display: block; margin-bottom: 6px; font-size: 14px; }
.mbl-step p { margin: 0; color: #a9b8c8; font-size: 13px; line-height: 1.55; }
.mbl-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 760px) { .mbl-grid { grid-template-columns: 1fr; } }
.mbl-feat { background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 16px 18px; }
.mbl-feat b { font-size: 13px; }
.mbl-feat p { margin: 6px 0 0; color: #a9b8c8; font-size: 12px; line-height: 1.5; }
.mbl-controls { color: #a9b8c8; font-size: 13px; line-height: 2; }
.mbl-controls kbd { background: rgba(255,255,255,0.12); border-radius: 4px; padding: 1px 7px;
  font-size: 11px; font-family: monospace; }
.mbl-footer { margin-top: 64px; color: #6d7f92; font-size: 12px; text-align: center; }
`;

const FEATURES: [string, string][] = [
  ["World = seed + diff", "Terrain regenerates identically on every client; only edits and presence ride the network. Joining a world costs two queries."],
  ["No game server", "A Calimero context is the world. Block edits are CRDT state replicated peer-to-peer between nodes."],
  ["Real-time players", "Heartbeat presence with clock-skew-proof reaping; remote avatars interpolate between updates."],
  ["Real voxel lighting", "Flood-fill sunlight and torch light baked per vertex, with a shared day/night cycle that costs zero traffic."],
  ["Offline-first", "Play with no node at all — your world persists locally and reconciles with the shared one when you connect."],
  ["Tiny consensus state", "A world with thousands of edits is a few KB of contract state. Chunks are never uploaded anywhere."],
];

const STEPS: [string, string][] = [
  ["1 · Generate", "Every player generates the identical 128×64×128 world from the seed stored in the contract."],
  ["2 · Diff", "Placing or breaking a block writes one override entry (LWW per block). Batches flush every 150 ms."],
  ["3 · Sync", "SSE events nudge peers to re-pull the override map; presence heartbeats keep the roster live."],
];

export class Landing {
  private root: HTMLElement;

  constructor(parent: HTMLElement) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "mb-landing";
    this.root.dataset.testid = "landing";
    parent.appendChild(this.root);
  }

  show(defaults: { name: string; seed: number }): Promise<LaunchChoice> {
    return new Promise((resolve) => {
      this.render(defaults, (choice) => {
        this.root.remove();
        resolve(choice);
      });
    });
  }

  private render(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    this.root.innerHTML = `
      <div class="mbl-wrap">
        <div class="mbl-nav">
          <div class="mbl-logo">▦</div><b>mero-blocks</b>
          <span>on Calimero · P2P</span>
        </div>
        <div class="mbl-hero">
          <div>
            <div class="mbl-badges">
              <span class="mbl-badge">browser voxel sandbox</span>
              <span class="mbl-badge">no game server</span>
              <span class="mbl-badge">CRDT world state</span>
            </div>
            <h1>A Minecraft-style world that lives on <em>your</em> nodes.</h1>
            <p class="lead">Build together in real time. The world is a Calimero context:
            every edit is peer-to-peer replicated state, every player is a heartbeat —
            and the terrain itself never touches the network.</p>
            <div class="mbl-controls" data-testid="controls">
              <kbd>WASD</kbd> move &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>LMB</kbd> break
              &nbsp; <kbd>RMB</kbd> place &nbsp; <kbd>1–9</kbd> blocks &nbsp; <kbd>wheel</kbd> select
            </div>
          </div>
          <div class="mbl-card" data-testid="play-card"><div id="mbl-play"></div></div>
        </div>
        <div class="mbl-section" data-testid="how-it-works">
          <h2>How it works</h2>
          <div class="mbl-steps">${STEPS.map(([t, d]) => `<div class="mbl-step"><b>${t}</b><p>${d}</p></div>`).join("")}</div>
        </div>
        <div class="mbl-section" data-testid="features">
          <h2>Why it's interesting</h2>
          <div class="mbl-grid">${FEATURES.map(([t, d]) => `<div class="mbl-feat"><b>${t}</b><p>${d}</p></div>`).join("")}</div>
        </div>
        <div class="mbl-footer">mero-blocks · a Calimero network showcase · world = f(seed) + overrides</div>
      </div>
    `;
    this.renderPlayCard(defaults, done);
  }

  private playCardEl(): HTMLElement {
    return this.root.querySelector("#mbl-play")!;
  }

  private renderPlayCard(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    if (hasConnection()) this.renderReady(defaults, done);
    else if (isAuthenticated()) this.renderWorldPicker(defaults, done);
    else this.renderAnonymous(defaults, done);
  }

  private commonInputs(defaults: { name: string; seed: number }, withSeed: boolean): string {
    return `
      <label>player name</label>
      <input id="mbl-name" data-testid="name-input" value="${escapeHtml(defaults.name)}" maxlength="16" />
      ${withSeed ? `<label>world seed (offline)</label>
      <input id="mbl-seed" data-testid="seed-input" value="${defaults.seed}" />` : ""}
    `;
  }

  private readChoice(mode: "offline" | "online", defaults: { name: string; seed: number }): LaunchChoice {
    const name = (this.root.querySelector<HTMLInputElement>("#mbl-name")?.value || "Player").trim();
    const seedRaw = this.root.querySelector<HTMLInputElement>("#mbl-seed")?.value;
    const seed = Math.abs(Math.floor(Number(seedRaw))) || defaults.seed;
    return { mode, name, seed };
  }

  // state 3: session has node + context — one click to play
  private renderReady(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    el.innerHTML = `
      <h3>You're connected</h3>
      ${this.commonInputs(defaults, false)}
      <button class="mbl-btn primary" data-testid="connect-btn">Enter shared world</button>
      <div class="mbl-divider">or</div>
      <label>world seed (offline)</label>
      <input id="mbl-seed" data-testid="seed-input" value="${defaults.seed}" />
      <button class="mbl-btn ghost" data-testid="offline-btn">Play offline</button>
      <button class="mbl-link" data-testid="disconnect-btn">Disconnect from node</button>
    `;
    el.querySelector("[data-testid=connect-btn]")!.addEventListener("click", () =>
      done(this.readChoice("online", defaults)),
    );
    el.querySelector("[data-testid=offline-btn]")!.addEventListener("click", () =>
      done(this.readChoice("offline", defaults)),
    );
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
      ${this.commonInputs(defaults, false)}
      <div class="mbl-worlds" data-testid="world-list"><div class="mbl-note">Loading worlds…</div></div>
      <div class="mbl-divider">or create one</div>
      <label>world name</label>
      <input id="mbl-world-name" data-testid="world-name-input" value="overworld" maxlength="24" />
      <label>seed</label>
      <input id="mbl-seed" data-testid="seed-input" value="${defaults.seed}" />
      <button class="mbl-btn green" data-testid="create-world-btn">Create world</button>
      <button class="mbl-btn ghost" data-testid="offline-btn">Play offline</button>
      <button class="mbl-link" data-testid="disconnect-btn">Disconnect from node</button>
      <div class="mbl-error" data-testid="picker-error"></div>
    `;
    const errEl = el.querySelector<HTMLElement>("[data-testid=picker-error]")!;
    const listEl = el.querySelector<HTMLElement>("[data-testid=world-list]")!;

    el.querySelector("[data-testid=offline-btn]")!.addEventListener("click", () =>
      done(this.readChoice("offline", defaults)),
    );
    el.querySelector("[data-testid=disconnect-btn]")!.addEventListener("click", () => {
      clearSession();
      this.renderPlayCard(defaults, done);
    });

    void (async () => {
      let applicationId: string | null = null;
      try {
        applicationId = await resolveApplicationId();
        const worlds = await listWorlds(applicationId);
        if (worlds.length === 0) {
          listEl.innerHTML = `<div class="mbl-note">No worlds on this node yet — create the first one below.</div>`;
        } else {
          listEl.innerHTML = "";
          worlds.forEach((w, i) => {
            const row = document.createElement("div");
            row.className = "mbl-world";
            row.innerHTML = `<code>${escapeHtml(w.contextId)}</code>
              <button data-testid="join-world-${i}">Join</button>`;
            row.querySelector("button")!.addEventListener("click", async () => {
              errEl.textContent = "";
              try {
                await joinContext(w.contextId);
                updateSession({ contextId: w.contextId });
                done(this.readChoice("online", defaults));
              } catch (e) {
                errEl.textContent = `Could not join: ${String(e)}`;
              }
            });
            listEl.appendChild(row);
          });
        }
      } catch (e) {
        listEl.innerHTML = `<div class="mbl-note">Could not list worlds (${escapeHtml(String(e))}).</div>`;
      }

      el.querySelector("[data-testid=create-world-btn]")!.addEventListener("click", async () => {
        errEl.textContent = "";
        if (!applicationId) {
          errEl.textContent = "mero-blocks is not installed on this node.";
          return;
        }
        const worldName =
          el.querySelector<HTMLInputElement>("#mbl-world-name")?.value.trim() || "overworld";
        const choice = this.readChoice("online", defaults);
        try {
          const created = await createWorld(applicationId, worldName, choice.seed);
          updateSession({
            contextId: created.contextId,
            executorPublicKey: created.memberPublicKey || getSession().executorPublicKey,
          });
          done(choice);
        } catch (e) {
          errEl.textContent = `Could not create world: ${String(e)}`;
        }
      });
    })();
  }

  // state 1: anonymous — offline play or web login
  private renderAnonymous(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    el.innerHTML = `
      <h3>Play now</h3>
      ${this.commonInputs(defaults, true)}
      <button class="mbl-btn green" data-testid="offline-btn">Play offline</button>
      <div class="mbl-divider">multiplayer</div>
      <label>your node url</label>
      <input id="mbl-node" data-testid="node-url-input" placeholder="http://localhost:2428" />
      <button class="mbl-btn primary" data-testid="web-login-btn">Connect a node</button>
      <div class="mbl-note">You'll authenticate on your node and come straight back.
      Opening from the Calimero desktop skips this page entirely.</div>
      <div class="mbl-error" data-testid="login-error"></div>
    `;
    el.querySelector("[data-testid=offline-btn]")!.addEventListener("click", () =>
      done(this.readChoice("offline", defaults)),
    );
    el.querySelector("[data-testid=web-login-btn]")!.addEventListener("click", () => {
      const url = el.querySelector<HTMLInputElement>("#mbl-node")?.value.trim() ?? "";
      const errEl = el.querySelector<HTMLElement>("[data-testid=login-error]")!;
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

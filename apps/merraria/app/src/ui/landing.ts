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
#mt-landing { position: fixed; inset: 0; overflow-y: auto; z-index: 20;
  background: linear-gradient(175deg, #0b0e14 0%, #141c2b 45%, #1d2a1f 100%);
  color: #fff; font-family: system-ui, -apple-system, sans-serif; }
.mtl-wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
.mtl-nav { display: flex; align-items: center; gap: 10px; margin-bottom: 48px; }
.mtl-logo { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center;
  background: linear-gradient(135deg, #4f8cff, #58c56b); font-size: 18px; }
.mtl-nav b { font-size: 18px; letter-spacing: 1px; }
.mtl-nav span { color: #8fa3ba; font-size: 12px; margin-left: auto; }
.mtl-hero { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 40px; align-items: start; }
@media (max-width: 760px) { .mtl-hero { grid-template-columns: 1fr; } }
.mtl-hero h1 { font-size: 44px; margin: 0 0 14px; line-height: 1.1; }
.mtl-hero h1 em { font-style: normal; color: #58c56b; }
.mtl-hero p.lead { color: #b8c6d6; font-size: 16px; line-height: 1.6; margin: 0 0 22px; }
.mtl-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.mtl-badge { font-size: 11px; padding: 4px 10px; border-radius: 20px;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); color: #cdd9e5; }
.mtl-card { background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 16px; padding: 26px 28px; }
.mtl-card h3 { margin: 0 0 16px; font-size: 16px; }
.mtl-card label { display: block; text-align: left; font-size: 12px; color: #9fb0c3; margin: 12px 0 4px; }
.mtl-card input { width: 100%; box-sizing: border-box; padding: 10px 11px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.32); color: #fff; font-size: 14px; }
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
.mtl-section { margin-top: 64px; }
.mtl-section h2 { font-size: 24px; margin: 0 0 20px; }
.mtl-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 760px) { .mtl-steps { grid-template-columns: 1fr; } }
.mtl-step { background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 18px; }
.mtl-step b { display: block; margin-bottom: 6px; font-size: 14px; }
.mtl-step p { margin: 0; color: #a9b8c8; font-size: 13px; line-height: 1.55; }
.mtl-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 760px) { .mtl-grid { grid-template-columns: 1fr; } }
.mtl-feat { background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 16px 18px; }
.mtl-feat b { font-size: 13px; }
.mtl-feat p { margin: 6px 0 0; color: #a9b8c8; font-size: 12px; line-height: 1.5; }
.mtl-controls { color: #a9b8c8; font-size: 13px; line-height: 2; }
.mtl-controls kbd { background: rgba(255,255,255,0.12); border-radius: 4px; padding: 1px 7px;
  font-size: 11px; font-family: monospace; }
.mtl-footer { margin-top: 64px; color: #6d7f92; font-size: 12px; text-align: center; }
`;

const FEATURES: [string, string][] = [
  ["World = seed + diff", "Terrain regenerates identically on every client; only dug/placed tiles and presence ride the network. Joining costs two queries."],
  ["No game server", "A Calimero context is the world. Tile edits are CRDT state replicated peer-to-peer between nodes."],
  ["Real-time players", "Heartbeat presence with clock-skew-proof reaping; remote miners interpolate between updates."],
  ["Real 2D lighting", "Flood-fill sky light and torches — caves are genuinely dark until you light them. Day/night is a shared clock, zero traffic."],
  ["Offline-first", "Play with no node at all — your world persists locally and reconciles with the shared one when you connect."],
  ["Mine & build", "Dig with per-tile hardness, gain what you mine, spend it building. Ores stratify with depth: coal, iron, gold."],
];

const STEPS: [string, string][] = [
  ["1 · Generate", "Every player generates the identical 400×200 tile world from the seed stored in the contract — hills, caves, ores, lakes, trees."],
  ["2 · Diff", "Digging or placing a tile writes one override entry (LWW per tile). Batches flush every 150 ms."],
  ["3 · Sync", "SSE events nudge peers to re-pull the override map; presence heartbeats keep the roster live."],
];

export class Landing {
  private root: HTMLElement;

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
        this.root.remove();
        resolve(choice);
      });
    });
  }

  private render(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    this.root.innerHTML = `
      <div class="mtl-wrap">
        <div class="mtl-nav">
          <div class="mtl-logo">⛏</div><b>merraria</b>
          <span>on Calimero · P2P</span>
        </div>
        <div class="mtl-hero">
          <div>
            <div class="mtl-badges">
              <span class="mtl-badge">2D mining sandbox</span>
              <span class="mtl-badge">no game server</span>
              <span class="mtl-badge">CRDT world state</span>
            </div>
            <h1>A Terraria-style world that lives on <em>your</em> nodes.</h1>
            <p class="lead">Mine and build together in real time. The world is a Calimero context:
            every dig is peer-to-peer replicated state, every miner is a heartbeat —
            and the terrain itself never touches the network.</p>
            <div class="mtl-controls" data-testid="controls">
              <kbd>A/D</kbd> move &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>LMB</kbd> dig (hold)
              &nbsp; <kbd>RMB</kbd> place &nbsp; <kbd>1–9</kbd> tiles &nbsp; <kbd>wheel</kbd> select
            </div>
          </div>
          <div class="mtl-card" data-testid="play-card"><div id="mtl-play"></div></div>
        </div>
        <div class="mtl-section" data-testid="how-it-works">
          <h2>How it works</h2>
          <div class="mtl-steps">${STEPS.map(([t, d]) => `<div class="mtl-step"><b>${t}</b><p>${d}</p></div>`).join("")}</div>
        </div>
        <div class="mtl-section" data-testid="features">
          <h2>Why it's interesting</h2>
          <div class="mtl-grid">${FEATURES.map(([t, d]) => `<div class="mtl-feat"><b>${t}</b><p>${d}</p></div>`).join("")}</div>
        </div>
        <div class="mtl-footer">merraria · a Calimero network showcase · world = f(seed) + overrides</div>
      </div>
    `;
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

  private commonInputs(defaults: { name: string; seed: number }, withSeed: boolean): string {
    return `
      <label>player name</label>
      <input id="mtl-name" data-testid="name-input" value="${escapeHtml(defaults.name)}" maxlength="16" />
      ${withSeed ? `<label>world seed (offline)</label>
      <input id="mtl-seed" data-testid="seed-input" value="${defaults.seed}" />` : ""}
    `;
  }

  private readChoice(mode: "offline" | "online", defaults: { name: string; seed: number }): LaunchChoice {
    const name = (this.root.querySelector<HTMLInputElement>("#mtl-name")?.value || "Player").trim();
    const seedRaw = this.root.querySelector<HTMLInputElement>("#mtl-seed")?.value;
    const seed = Math.abs(Math.floor(Number(seedRaw))) || defaults.seed;
    return { mode, name, seed };
  }

  // state 3: session has node + context — one click to play
  private renderReady(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    el.innerHTML = `
      <h3>You're connected</h3>
      ${this.commonInputs(defaults, false)}
      <button class="mtl-btn primary" data-testid="connect-btn">Enter shared world</button>
      <div class="mtl-divider">or</div>
      <label>world seed (offline)</label>
      <input id="mtl-seed" data-testid="seed-input" value="${defaults.seed}" />
      <button class="mtl-btn ghost" data-testid="offline-btn">Play offline</button>
      <button class="mtl-link" data-testid="disconnect-btn">Disconnect from node</button>
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
      <div class="mtl-worlds" data-testid="world-list"><div class="mtl-note">Loading worlds…</div></div>
      <div class="mtl-divider">or create one</div>
      <label>world name</label>
      <input id="mtl-world-name" data-testid="world-name-input" value="surface" maxlength="24" />
      <label>seed</label>
      <input id="mtl-seed" data-testid="seed-input" value="${defaults.seed}" />
      <button class="mtl-btn green" data-testid="create-world-btn">Create world</button>
      <button class="mtl-btn ghost" data-testid="offline-btn">Play offline</button>
      <button class="mtl-link" data-testid="disconnect-btn">Disconnect from node</button>
      <div class="mtl-error" data-testid="picker-error"></div>
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
        listEl.innerHTML = `<div class="mtl-note">Could not list worlds (${escapeHtml(String(e))}).</div>`;
      }

      el.querySelector("[data-testid=create-world-btn]")!.addEventListener("click", async () => {
        errEl.textContent = "";
        if (!applicationId) {
          errEl.textContent = "merraria is not installed on this node.";
          return;
        }
        const worldName =
          el.querySelector<HTMLInputElement>("#mtl-world-name")?.value.trim() || "surface";
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
      <button class="mtl-btn green" data-testid="offline-btn">Play offline</button>
      <div class="mtl-divider">multiplayer</div>
      <label>your node url</label>
      <input id="mtl-node" data-testid="node-url-input" placeholder="http://localhost:2428" />
      <button class="mtl-btn primary" data-testid="web-login-btn">Connect a node</button>
      <div class="mtl-note">You'll authenticate on your node and come straight back.
      Opening from the Calimero desktop skips this page entirely.</div>
      <div class="mtl-error" data-testid="login-error"></div>
    `;
    el.querySelector("[data-testid=offline-btn]")!.addEventListener("click", () =>
      done(this.readChoice("offline", defaults)),
    );
    el.querySelector("[data-testid=web-login-btn]")!.addEventListener("click", () => {
      const url = el.querySelector<HTMLInputElement>("#mtl-node")?.value.trim() ?? "";
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

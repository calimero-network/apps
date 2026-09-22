// Landing page — Minecraft-title-screen style: a real generated world spins
// blurred in the background (ui/panorama.ts); in front there is only the
// logo, the title, and the play card. Three auth states for the card:
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
  forgetWorldName,
  joinWorld,
  listWorlds,
  rememberWorldName,
  resolveApplicationId,
  worldNameOf,
} from "../net/admin";
import { onInvitation as onInvite } from "@calimero-apps/invite";
import { beginWebLogin } from "../net/auth";
import { inviteLink } from "../net/inviteLink";
import { clearSession, getSession, hasConnection, isAuthenticated, updateSession } from "../net/session";
import { showLandingAgain } from "../pages/landing/mount";
import { deleteWorld } from "../state/persistence";
import { Panorama } from "./panorama";

export interface LaunchChoice {
  name: string;
}

const css = `
#mb-landing { position: fixed; inset: 0; overflow-y: auto; z-index: 20;
  background: #0b0e14; color: #fff; font-family: system-ui, -apple-system, sans-serif; }
.mbl-shade { position: fixed; inset: 0; z-index: 1; pointer-events: none;
  background: radial-gradient(ellipse at 50% 42%, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.55) 100%); }
.mbl-wrap { position: relative; z-index: 2; min-height: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 40px 16px 28px; }
.mbl-logo svg { width: 84px; height: 89px; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.5)); }
.mbl-title { margin: 0; font-size: clamp(40px, 9vw, 68px); font-weight: 900;
  letter-spacing: 4px; text-transform: uppercase; line-height: 1; text-align: center;
  color: #fff; text-shadow: 0 4px 0 rgba(0,0,0,0.45), 0 0 28px rgba(0,0,0,0.5); }
.mbl-title em { font-style: normal; color: #58c56b; }
.mbl-tag { margin: 0; font-size: 13px; color: #cfe3d6; letter-spacing: 1px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
.mbl-card { width: min(380px, 94vw); box-sizing: border-box; margin-top: 10px;
  background: rgba(8,10,14,0.78); border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px; padding: 18px 20px 20px; backdrop-filter: blur(3px);
  box-shadow: 0 12px 44px rgba(0,0,0,0.55); }
.mbl-card h3 { margin: 0 0 10px; font-size: 15px; text-align: center; }
/* The way back out to the marketing page.
   ⚠️ Its own row BELOW the card, centred, and a bordered button rather than
   a link. The first version was an 11px grey link tucked inside the card next
   to the "player name" label, and it read as a caption — on a dark card over a
   panorama there was nothing to say it was pressable. This sits outside the
   card and looks like the control it is; centring it under the card puts it
   directly beneath the "connect a node" note, which is the line a visitor with
   no node reads just before they give up and go back. */
.mbl-backrow { width: min(380px, 94vw); box-sizing: border-box; margin-top: 0;
  text-align: center; }
.mbl-back { display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 13px 7px 11px; border-radius: 6px; cursor: pointer; font-family: inherit;
  font-size: 12px; font-weight: 600; color: #dfe7ee;
  background: rgba(8,10,14,0.72); border: 1px solid rgba(255,255,255,0.22);
  backdrop-filter: blur(3px); box-shadow: 0 4px 16px rgba(0,0,0,0.45); }
.mbl-back:hover { color: #fff; background: rgba(30,38,50,0.85); border-color: rgba(255,255,255,0.4); }
.mbl-back span { font-size: 14px; line-height: 1; }
.mbl-card label, .mbl-modal label { display: block; text-align: left; font-size: 11px;
  color: #9fb0c3; margin: 10px 0 4px; }
.mbl-card input, .mbl-modal input { width: 100%; box-sizing: border-box; padding: 9px 11px;
  border-radius: 6px; border: 1px solid rgba(255,255,255,0.22); background: rgba(0,0,0,0.45);
  color: #fff; font-size: 14px; }
.mbl-btn { width: 100%; margin-top: 12px; padding: 12px; border-radius: 5px;
  border: 2px solid rgba(0,0,0,0.75); font-size: 14px; font-weight: 700; cursor: pointer;
  color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,0.45);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.22), inset 0 -3px 0 rgba(0,0,0,0.3); }
.mbl-btn:hover { filter: brightness(1.12); }
.mbl-btn.green { background: #3f9950; }
.mbl-btn.primary { background: #4f8cff; }
.mbl-btn.ghost { background: #6e6e6e; }
.mbl-link { display: block; margin: 10px auto 0; background: none; border: none; color: #9fb0c3;
  font-size: 11px; cursor: pointer; text-decoration: underline; }
.mbl-divider { display: flex; align-items: center; gap: 10px; color: #8fa3ba; font-size: 10px;
  margin-top: 16px; text-transform: uppercase; letter-spacing: 1px; }
.mbl-divider::before, .mbl-divider::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,0.16); }
.mbl-worlds { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; max-height: 260px;
  overflow-y: auto; }
.mbl-world-card { position: relative; height: 78px; border-radius: 8px; overflow: hidden; flex: none;
  border: 1px solid rgba(255,255,255,0.16); background: #0d1117; }
.mbl-world-card > canvas { position: absolute; inset: 0; width: 100%; height: 100%;
  filter: blur(2.5px); transform: scale(1.12); image-rendering: pixelated; }
.mbl-card-scrim { position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.25) 100%); }
.mbl-card-body { position: relative; z-index: 1; height: 100%; box-sizing: border-box;
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.mbl-card-info { min-width: 0; text-align: left; }
.mbl-card-title { font-size: 13px; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mbl-card-info code { display: block; font-size: 10px; color: #b9c6d4; margin-top: 3px;
  max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mbl-card-tag { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #8fe0a0;
  margin-top: 3px; }
.mbl-card-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; flex: none; }
.mbl-card-actions .mbl-join { padding: 8px 16px; border-radius: 4px; border: 2px solid rgba(0,0,0,0.75);
  background: #3f9950; color: #fff; font-weight: 700; cursor: pointer; }
.mbl-card-actions .mbl-join.enter { background: #4f8cff; }
.mbl-card-actions .mbl-join:disabled { background: #4a4f57; cursor: default; opacity: 0.7; }
.mbl-kebab { width: 30px; padding: 8px 0; border-radius: 4px; border: 2px solid rgba(0,0,0,0.75);
  background: rgba(0,0,0,0.55); color: #fff; font-weight: 700; cursor: pointer; line-height: 1; }
.mbl-card-menu { position: absolute; right: 46px; top: 6px; z-index: 3; min-width: 150px;
  background: #131a26; border: 1px solid rgba(255,255,255,0.18); border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6); display: flex; flex-direction: column; overflow: hidden; }
.mbl-card-menu[hidden] { display: none; }
.mbl-card-menu button { background: none; border: none; color: #dfe7ee; padding: 9px 12px;
  text-align: left; font-size: 12px; cursor: pointer; }
.mbl-card-menu button:hover { background: rgba(255,255,255,0.08); }
.mbl-row2 { display: flex; gap: 8px; }
.mbl-row2 .mbl-btn { flex: 1; }
.mbl-world button { padding: 6px 14px; border-radius: 4px; border: 2px solid rgba(0,0,0,0.75);
  background: #4f8cff; color: #fff; font-weight: 700; cursor: pointer; }
.mbl-nodes { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.mbl-node-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 6px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(88,197,107,0.4); }
.mbl-node-row code { font-size: 12px; color: #cdd9e5; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.mbl-node-row .mbl-dot { width: 8px; height: 8px; border-radius: 50%; background: #58c56b;
  box-shadow: 0 0 6px #58c56b; flex: none; }
.mbl-node-row button { padding: 6px 14px; border-radius: 4px; border: 2px solid rgba(0,0,0,0.75);
  background: #3f9950; color: #fff; font-weight: 700; cursor: pointer; }
.mbl-modal-shade { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; padding: 16px; }
.mbl-modal { width: min(420px, 94vw); box-sizing: border-box; background: rgba(10,13,18,0.97);
  border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 18px 20px 20px;
  box-shadow: 0 16px 60px rgba(0,0,0,0.7); color: #fff; }
.mbl-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.mbl-modal-head h3 { margin: 0; font-size: 15px; }
.mbl-modal-close { background: none; border: none; color: #9fb0c3; font-size: 18px;
  cursor: pointer; padding: 2px 6px; line-height: 1; }
.mbl-modal-close:hover { color: #fff; }
.mbl-scan { font-size: 12px; color: #9fb0c3; text-align: center; animation: mblpulse 1.2s ease-in-out infinite; }
@keyframes mblpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.mbl-note { font-size: 11px; color: #8fa3ba; margin-top: 10px; line-height: 1.5; text-align: center; }
.mbl-error { color: #ff8686; font-size: 12px; margin-top: 8px; min-height: 14px; text-align: center; }
.mbl-controls { margin-top: 14px; color: #cfd9e4; font-size: 12px; line-height: 2; text-align: center;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
.mbl-controls kbd { background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
  border-radius: 4px; padding: 1px 7px; font-size: 11px; font-family: monospace; }
.mbl-foot { margin-top: 6px; color: #93a2b3; font-size: 10px; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }

/* Chromeless: the unified landing page (src/pages/landing) has already shown the
   logo, the name and the pitch, so when it hands off here the launcher must not
   repeat them — it goes straight to the world picker. See main.ts. */
#mb-landing.is-chromeless .mbl-logo, #mb-landing.is-chromeless .mbl-title, #mb-landing.is-chromeless .mbl-tag, #mb-landing.is-chromeless .mbl-foot { display: none !important; }
`;

export const LOGO_SVG = `
<svg viewBox="0 0 64 68" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="mero-blocks logo">
  <polygon points="32,4 58,19 32,34 6,19" fill="#58c56b"/>
  <polygon points="32,4 45,11.5 19,26.5 6,19" fill="#6fdd82"/>
  <polygon points="6,19 32,34 32,64 6,49" fill="#8a5a34"/>
  <polygon points="58,19 32,34 32,64 58,49" fill="#6e4527"/>
</svg>`;


export class Landing {
  private root: HTMLElement;
  /** Unsubscribe for the invite-link listener, so re-rendering does not stack them. */
  private unsubscribeInvite: (() => void) | null = null;
  /** Codes already tried this session — stops a failed link reopening the modal. */
  private attemptedInvites = new Set<string>();
  private panorama: Panorama;

  constructor(parent: HTMLElement) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "mb-landing";
    this.root.dataset.testid = "landing";
    parent.appendChild(this.root);
    this.panorama = new Panorama(this.root);
  }

  /**
   * `chromeless` skips this screen's own logo/title/pitch and goes straight to
   * the world picker. Passed when the unified landing page has just shown all
   * of that — repeating it would be two landing pages in a row.
   */
  show(
    defaults: { name: string; seed: number },
    opts: { chromeless?: boolean } = {},
  ): Promise<LaunchChoice> {
    return new Promise((resolve) => {
      if (opts.chromeless) this.root.classList.add("is-chromeless");
      this.render(defaults, (choice) => {
        this.panorama.destroy();
        this.root.remove();
        resolve(choice);
      });
    });
  }

  private render(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const shade = document.createElement("div");
    shade.className = "mbl-shade";
    this.root.appendChild(shade);

    const wrap = document.createElement("div");
    wrap.className = "mbl-wrap";
    wrap.innerHTML = `
      <div class="mbl-logo">${LOGO_SVG}</div>
      <h1 class="mbl-title">Mero <em>Blocks</em></h1>
      <p class="mbl-tag">P2P worlds on Calimero — no game server</p>
      <div class="mbl-card" data-testid="play-card"><div id="mbl-play"></div></div>
      <div class="mbl-backrow">
        <button type="button" class="mbl-back" data-testid="back-to-landing">
          <span aria-hidden="true">&larr;</span> Back to landing page
        </button>
      </div>
      <div class="mbl-controls" data-testid="controls">
        <kbd>WASD</kbd> move &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>←↑↓→</kbd> look
        &nbsp; <kbd>LMB</kbd>/<kbd>Q</kbd> break &nbsp; <kbd>RMB</kbd>/<kbd>E</kbd> place
        &nbsp; <kbd>M</kbd> map &nbsp; <kbd>O</kbd> options
      </div>
      <div class="mbl-foot">a Calimero network showcase · world = f(seed) + overrides</div>
    `;
    this.root.appendChild(wrap);

    // Renders the marketing page ON TOP of this launcher (z-index 50 over 20)
    // rather than tearing the launcher down, so the panorama keeps running, the
    // world list keeps whatever it had loaded, and dismissing the page again
    // simply uncovers the card the visitor left. Nothing to restore.
    wrap.querySelector("[data-testid=back-to-landing]")!.addEventListener("click", () => {
      void showLandingAgain();
    });

    this.renderPlayCard(defaults, done);
  }

  private playCardEl(): HTMLElement {
    return this.root.querySelector("#mbl-play")!;
  }

  private renderPlayCard(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    // connected and merely-authenticated share ONE screen (the Minecraft
    // world list) — quitting a world always brings you back to the full list
    if (hasConnection() || isAuthenticated()) this.renderWorldPicker(defaults, done);
    else this.renderAnonymous(defaults, done);
  }

  private commonInputs(defaults: { name: string }): string {
    return `
      <label>player name</label>
      <input id="mbl-name" data-testid="name-input" value="${escapeHtml(defaults.name)}" maxlength="16" />
    `;
  }

  private readChoice(): LaunchChoice {
    const name = (this.root.querySelector<HTMLInputElement>("#mbl-name")?.value || "Player").trim();
    return { name };
  }

  private readSeed(fallback: number): number {
    const raw = this.root.querySelector<HTMLInputElement>("#mbl-seed")?.value;
    return Math.abs(Math.floor(Number(raw))) || fallback;
  }

  // states 2+3: logged into a node — the Minecraft world list. The current
  // world (if any) renders first, synchronously, with one-click Enter; the
  // rest of the node's worlds load as cards below it. Create / invite-join
  // live in popups so the card itself stays clean.
  private renderWorldPicker(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    const connected = hasConnection();
    el.innerHTML = `
      <h3>Choose a world</h3>
      ${this.commonInputs(defaults)}
      <div class="mbl-worlds" data-testid="world-list"></div>
      <div class="mbl-error" data-testid="join-error"></div>
      <div class="mbl-row2">
        <button class="mbl-btn green" data-testid="create-world-open-btn">Create world</button>
        <button class="mbl-btn primary" data-testid="join-invite-open-btn">Join with invite</button>
      </div>
      ${connected ? `<button class="mbl-btn ghost" data-testid="invite-btn">Invite friends</button>` : ""}
      <button class="mbl-link" data-testid="disconnect-btn">Disconnect from node</button>
    `;
    const listEl = el.querySelector<HTMLElement>("[data-testid=world-list]")!;
    const errEl = el.querySelector<HTMLElement>("[data-testid=join-error]")!;

    el.querySelector("[data-testid=disconnect-btn]")!.addEventListener("click", () => {
      clearSession();
      this.renderPlayCard(defaults, done);
    });
    el.querySelector("[data-testid=create-world-open-btn]")!.addEventListener("click", () =>
      this.openCreateWorldModal(defaults, done),
    );
    el.querySelector("[data-testid=join-invite-open-btn]")!.addEventListener("click", () =>
      this.openInviteModal(done),
    );

    // An invite LINK opened the app. This is the first state where joining is
    // possible (a node is connected), and the captured intent is replayed to us
    // however long ago it arrived — including from before the web-login
    // redirect. `attemptedInvites` keeps a failed one from reopening the modal
    // on every re-render of this card.
    this.unsubscribeInvite?.();
    this.unsubscribeInvite = onInvite(({ token, resolve }) => {
      if (this.attemptedInvites.has(token)) return;
      this.attemptedInvites.add(token);
      this.openInviteModal(done, { code: token, resolve });
    });

    const inviteBtn = el.querySelector<HTMLButtonElement>("[data-testid=invite-btn]");
    inviteBtn?.addEventListener("click", async () => {
      errEl.textContent = "";
      inviteBtn.disabled = true;
      inviteBtn.textContent = "Creating invite…";
      try {
        // Share the link, not the bare code: it opens the desktop app where
        // installed and the published web build otherwise, and the paste box
        // still accepts either form.
        const code = await createWorldInvite();
        await navigator.clipboard.writeText(inviteLink(code));
        inviteBtn.textContent = "Invite copied!";
      } catch (e) {
        errEl.textContent = `Could not create invite: ${errText(e)}`;
      } finally {
        // brief confirmation, then back to normal so more invites can be minted
        setTimeout(() => {
          inviteBtn.textContent = "Invite friends";
          inviteBtn.disabled = false;
        }, 2500);
      }
    });

    // the current world's card renders synchronously — entering it must never
    // wait on the world-list fetch
    const current = getSession().contextId;
    if (current) {
      listEl.appendChild(
        this.worldCard(
          { contextId: current, name: worldNameOf(current, getSession().worldName ?? undefined) },
          true,
          -1,
          done,
          errEl,
        ),
      );
    }
    const loading = document.createElement("div");
    loading.className = "mbl-note";
    loading.textContent = "Loading worlds…";
    listEl.appendChild(loading);

    void (async () => {
      try {
        const applicationId = await resolveApplicationId();
        const worlds = await listWorlds(applicationId);
        loading.remove();
        const others = worlds.filter((w) => w.contextId !== current);
        if (!current && others.length === 0) {
          listEl.innerHTML = `<div class="mbl-note">No worlds on this node yet — create the first one!</div>`;
          return;
        }
        others.forEach((w, i) => listEl.appendChild(this.worldCard(w, false, i, done, errEl)));
      } catch (e) {
        loading.textContent = `Could not list worlds (${errText(e)}).`;
      }
    })();
  }

  /** one Minecraft-style world card: blurred terrain thumb, name, Join/Enter, ⋯ menu */
  private worldCard(
    w: { contextId: string; name?: string },
    isCurrent: boolean,
    index: number,
    done: (c: LaunchChoice) => void,
    errEl: HTMLElement,
  ): HTMLElement {
    const name = worldNameOf(w.contextId, w.name);
    const card = document.createElement("div");
    card.className = "mbl-world-card";
    card.dataset.testid = isCurrent ? "world-card-current" : `world-card-${index}`;
    const joinTestId = isCurrent ? "connect-btn" : `join-world-${index}`;
    const menuTestId = isCurrent ? "world-menu-current" : `world-menu-${index}`;
    card.innerHTML = `
      <canvas></canvas>
      <div class="mbl-card-scrim"></div>
      <div class="mbl-card-body">
        <div class="mbl-card-info">
          <div class="mbl-card-title">${escapeHtml(name || "Unnamed world")}</div>
          <code>${escapeHtml(w.contextId)}</code>
          ${isCurrent ? `<div class="mbl-card-tag">last played</div>` : ""}
        </div>
        <div class="mbl-card-actions">
          <button class="mbl-join${isCurrent ? " enter" : ""}" data-testid="${joinTestId}">
            ${isCurrent ? "Enter" : "Join"}</button>
          <button class="mbl-kebab" data-testid="${menuTestId}" aria-label="World options">⋯</button>
        </div>
      </div>
      <div class="mbl-card-menu" hidden>
        <button data-action="copy-id">Copy world ID</button>
        <button data-action="forget">Forget local data</button>
      </div>
    `;
    drawWorldThumb(card.querySelector("canvas")!, w.contextId);

    const joinBtn = card.querySelector<HTMLButtonElement>(`[data-testid="${joinTestId}"]`)!;
    joinBtn.addEventListener("click", async () => {
      if (isCurrent) return done(this.readChoice()); // already a member
      errEl.textContent = "";
      joinBtn.disabled = true;
      joinBtn.textContent = "Joining…";
      try {
        const identity = await joinWorld(w.contextId);
        rememberWorldName(w.contextId, name);
        // switching worlds: the old world's namespace/group/name must not
        // leak into this one (invites would target the wrong world)
        updateSession({
          contextId: w.contextId,
          namespaceId: null,
          groupId: null,
          worldName: name || null,
          executorPublicKey: identity,
        });
        done(this.readChoice());
      } catch (e) {
        joinBtn.disabled = false;
        joinBtn.textContent = "Join";
        errEl.textContent = `Could not join: ${errText(e)}`;
      }
    });

    const menu = card.querySelector<HTMLElement>(".mbl-card-menu")!;
    const kebab = card.querySelector<HTMLButtonElement>(`[data-testid="${menuTestId}"]`)!;
    kebab.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", () => {
      menu.hidden = true;
    });
    menu.querySelector("[data-action=copy-id]")!.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(w.contextId);
      } catch {
        /* clipboard unavailable — nothing sensible to do */
      }
      menu.hidden = true;
    });
    menu.querySelector("[data-action=forget]")!.addEventListener("click", () => {
      deleteWorld(w.contextId); // local block edits + player position only
      forgetWorldName(w.contextId);
      menu.hidden = true;
    });
    return card;
  }

  /** popup: create a world. Buttons lock while the node works — no double-create. */
  private openCreateWorldModal(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const shade = document.createElement("div");
    shade.className = "mbl-modal-shade";
    shade.dataset.testid = "create-modal";
    shade.innerHTML = `
      <div class="mbl-modal">
        <div class="mbl-modal-head">
          <h3>Create world</h3>
          <button class="mbl-modal-close" data-testid="create-close" aria-label="Close">✕</button>
        </div>
        <label>world name</label>
        <input id="mbl-world-name" data-testid="world-name-input" value="overworld" maxlength="24" />
        <label>seed</label>
        <input id="mbl-seed" data-testid="seed-input" value="${defaults.seed}" />
        <button class="mbl-btn green" data-testid="create-world-btn">Create world</button>
        <div class="mbl-error" data-testid="create-error"></div>
      </div>
    `;
    this.root.appendChild(shade);
    let busy = false;
    const closeBtn = shade.querySelector<HTMLButtonElement>("[data-testid=create-close]")!;
    const createBtn = shade.querySelector<HTMLButtonElement>("[data-testid=create-world-btn]")!;
    const errEl = shade.querySelector<HTMLElement>("[data-testid=create-error]")!;
    shade.addEventListener("click", (e) => {
      if (e.target === shade && !busy) shade.remove();
    });
    closeBtn.addEventListener("click", () => {
      if (!busy) shade.remove();
    });
    createBtn.addEventListener("click", async () => {
      if (busy) return;
      errEl.textContent = "";
      const worldName =
        shade.querySelector<HTMLInputElement>("#mbl-world-name")?.value.trim() || "overworld";
      busy = true;
      createBtn.disabled = true;
      closeBtn.disabled = true;
      createBtn.textContent = "Creating…";
      try {
        const applicationId = await resolveApplicationId();
        if (!applicationId) throw new Error("mero-blocks is not installed on this node");
        const choice = this.readChoice();
        const created = await createWorld(applicationId, worldName, this.readSeed(defaults.seed));
        rememberWorldName(created.contextId, worldName);
        updateSession({
          contextId: created.contextId,
          namespaceId: created.namespaceId,
          groupId: created.groupId,
          worldName,
          executorPublicKey: created.memberPublicKey || getSession().executorPublicKey,
        });
        shade.remove();
        done(choice);
      } catch (e) {
        errEl.textContent = `Could not create world: ${errText(e)}`;
        busy = false;
        createBtn.disabled = false;
        closeBtn.disabled = false;
        createBtn.textContent = "Create world";
      }
    });
  }

  /** popup: join with a pasted invite. Locks (incl. close) while joining. */
  /**
   * `prefill` is set when an invite LINK opened the app rather than the user
   * pasting a code. The modal opens with the code in place and submits itself,
   * so following a link joins the world instead of asking the recipient to
   * re-enter what the link already carried. The intent is acked only on success.
   */
  private openInviteModal(
    done: (c: LaunchChoice) => void,
    prefill?: { code: string; resolve: () => void },
  ): void {
    const shade = document.createElement("div");
    shade.className = "mbl-modal-shade";
    shade.dataset.testid = "invite-modal";
    shade.innerHTML = `
      <div class="mbl-modal">
        <div class="mbl-modal-head">
          <h3>Join with invite</h3>
          <button class="mbl-modal-close" data-testid="invite-close" aria-label="Close">✕</button>
        </div>
        <label>invite code</label>
        <input id="mbl-invite" data-testid="invite-input" placeholder="paste an invite code" />
        <button class="mbl-btn primary" data-testid="join-invite-btn">Join world</button>
        <div class="mbl-error" data-testid="picker-error"></div>
      </div>
    `;
    this.root.appendChild(shade);
    let busy = false;
    // Set only for a link-opened invite; called once the join actually succeeds
    // so a transient failure leaves the intent in the store to retry next load.
    let prefillAck: (() => void) | null = null;
    const closeBtn = shade.querySelector<HTMLButtonElement>("[data-testid=invite-close]")!;
    const joinBtn = shade.querySelector<HTMLButtonElement>("[data-testid=join-invite-btn]")!;
    const errEl = shade.querySelector<HTMLElement>("[data-testid=picker-error]")!;
    shade.addEventListener("click", (e) => {
      if (e.target === shade && !busy) shade.remove();
    });
    closeBtn.addEventListener("click", () => {
      if (!busy) shade.remove();
    });
    joinBtn.addEventListener("click", async () => {
      if (busy) return;
      errEl.textContent = "";
      const code = shade.querySelector<HTMLInputElement>("#mbl-invite")?.value ?? "";
      if (!code.trim()) {
        errEl.textContent = "Paste the invite code a friend sent you.";
        return;
      }
      busy = true;
      joinBtn.disabled = true;
      closeBtn.disabled = true;
      joinBtn.textContent = "Joining…";
      try {
        await acceptWorldInvite(code);
        prefillAck?.();
        shade.remove();
        done(this.readChoice());
      } catch (e) {
        errEl.textContent = `Could not join with invite: ${errText(e)}`;
        busy = false;
        joinBtn.disabled = false;
        closeBtn.disabled = false;
        joinBtn.textContent = "Join world";
      }
    });

    if (prefill) {
      const input = shade.querySelector<HTMLInputElement>("#mbl-invite");
      if (input) input.value = prefill.code;
      prefillAck = prefill.resolve;
      joinBtn.click();
    }
  }

  // state 1: anonymous — the game is online-only, so the only path forward is
  // connecting a node. Nothing is probed on page load (no surprise browser
  // local-network prompt): the "Connect a node" button opens a popup that
  // pings the well-known local endpoints on demand.
  private renderAnonymous(defaults: { name: string; seed: number }, _done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    el.innerHTML = `
      ${this.commonInputs(defaults)}
      <button class="mbl-btn green" data-testid="connect-open-btn">Connect a node</button>
      <div class="mbl-note">Mero Blocks runs on your Calimero node — connect one to play.
        No node yet? <a href="https://docs.calimero.network/getting-started/" target="_blank"
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
    shade.className = "mbl-modal-shade";
    shade.dataset.testid = "connect-modal";
    shade.innerHTML = `
      <div class="mbl-modal">
        <div class="mbl-modal-head">
          <h3>Connect a node</h3>
          <button class="mbl-modal-close" data-testid="connect-close" aria-label="Close">✕</button>
        </div>
        <div class="mbl-nodes" data-testid="discovered-nodes"></div>
        <div class="mbl-note" data-testid="scan-note"></div>
        <button class="mbl-btn ghost" data-testid="rescan-btn">Rescan</button>
        <div class="mbl-divider">or your node url</div>
        <input id="mbl-node" data-testid="node-url-input" placeholder="http://localhost:2428" />
        <button class="mbl-btn primary" data-testid="web-login-btn">Connect</button>
        <div class="mbl-error" data-testid="login-error"></div>
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
      nodesEl.innerHTML = `<div class="mbl-scan" data-testid="scan-progress">Scanning for local nodes…</div>`;
      let found = 0;
      const probes = DEFAULT_LOCAL_NODE_PORTS.map((port, i) => {
        const url = localNodeUrl(port);
        return probeNodeHealth(url, { signal }).then((alive) => {
          if (signal.aborted || !alive) return false;
          if (found++ === 0) nodesEl.innerHTML = ""; // first hit clears the scanning note
          const row = document.createElement("div");
          row.className = "mbl-node-row";
          row.innerHTML = `<span class="mbl-dot"></span><code>${escapeHtml(url)}</code>
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
      const url = shade.querySelector<HTMLInputElement>("#mbl-node")?.value.trim() ?? "";
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

/**
 * Static blocky terrain thumbnail for a world card, deterministic from the
 * context id (the world's real seed isn't known before joining) — blurred by
 * CSS into the Minecraft world-list look.
 */
function drawWorldThumb(canvas: HTMLCanvasElement, seedStr: string): void {
  const W = 96;
  const H = 54;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  const rnd = () => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296);

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#6fa9e8");
  sky.addColorStop(1, "#cfe6ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffe9a8";
  ctx.fillRect(8 + Math.floor(rnd() * 60), 4 + Math.floor(rnd() * 8), 7, 7);

  const B = 6; // block size
  let ground = 22 + rnd() * 12;
  for (let x = 0; x < W; x += B) {
    ground = Math.max(16, Math.min(H - 8, ground + (rnd() - 0.5) * 9));
    const top = Math.floor(ground / B) * B;
    ctx.fillStyle = `rgb(${70 + rnd() * 25}, ${165 + rnd() * 35}, ${85 + rnd() * 25})`;
    ctx.fillRect(x, top, B, B);
    for (let y = top + B; y < H; y += B) {
      const deep = y > top + 2 * B;
      ctx.fillStyle = deep
        ? `rgb(${95 + rnd() * 20}, ${95 + rnd() * 20}, ${100 + rnd() * 20})`
        : `rgb(${125 + rnd() * 25}, ${86 + rnd() * 18}, ${52 + rnd() * 14})`;
      ctx.fillRect(x, y, B, B);
    }
    if (rnd() < 0.12 && top > 20) {
      ctx.fillStyle = "#7a5230";
      ctx.fillRect(x + 2, top - 8, 2, 8);
      ctx.fillStyle = "#3f8f4f";
      ctx.fillRect(x - 3, top - 15, 12, 9);
    }
  }
}

/** human-readable error text — the message, not "Error: message" */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

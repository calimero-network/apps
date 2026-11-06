// Landing page — Minecraft-title-screen style: a real generated world spins
// blurred in the background (ui/panorama.ts); in front there is only the
// logo, the title, and the play card. The card follows the session:
//  1. listing      → a copy no cluster serves (a static host): the shared
//                    listing card, "Open Mero Blocks" where Calimero Cloud
//                    serves it. unconfigured → a build that cannot connect
//                    otherwise says why.
//  2. signed out   → sign in with a passkey, or create an account. Local
//                    `merod local` nodes under `vite`, a Calimero Cloud cluster
//                    in a production build (net/session.ts).
//  3. signed in    → the worlds this account reaches (app instances): enter
//                    one, create one, copy an invite for the last one played.
// An invite link (`?invite=`) is redeemed right after sign-in and opens the
// world it joins.

import type { AppInfo } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";
import { renderListing } from "@calimero-apps/passkey/listing";
import "@calimero-apps/passkey/passkey.css";

import {
  defaultDeps,
  describeTarget,
  signIn,
  signOut,
  signUp,
  type Phase,
  type SessionDeps,
  type SignedIn,
  type SignedOut,
} from "../net/session";
import {
  createWorld,
  forgetWorld,
  inviteLink,
  inviteToken,
  lastWorld,
  listWorlds,
  alreadyInInvitedWorld,
  inviteFailure,
  pendingInvite,
  redeemPendingInvite,
  rememberWorld,
  worldSource,
} from "../net/worlds";
import { PACKAGE } from "../net/blocks";
import { showLandingAgain } from "../pages/landing/mount";
import { deleteWorld } from "../state/persistence";
import { Panorama } from "./panorama";

/** The world the player entered, and who they are. */
export interface EnteredWorld {
  appId: string;
  name: string;
  /** The world's organization (whom an invite admits); `null` for a world without one. */
  org: string | null;
}

export interface LaunchChoice {
  /** Player name shown to others. */
  name: string;
  session: SignedIn;
  world: EnteredWorld;
  /** something the player should hear once the world is up */
  notice?: string;
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
/* The shared listing card (@calimero-apps/passkey), in this launcher's colours. */
.mbl-listing { --passkey-ink: #fff; --passkey-muted: #cfe3d6; --passkey-primary-bg: #3f9950;
  --passkey-primary-ink: #fff; --passkey-secondary-ink: #cfe3d6; --passkey-radius: 5px; }
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
.mbl-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.mbl-tab { flex: 1; padding: 8px 0; border-radius: 6px; cursor: pointer; font-family: inherit;
  font-size: 12px; font-weight: 700; color: #9fb0c3; background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.16); }
.mbl-tab[aria-selected="true"] { color: #fff; background: rgba(79,140,255,0.28); border-color: rgba(79,140,255,0.7); }
.mbl-tabpanel[hidden] { display: none; }
.mbl-info { font-size: 12px; color: #cfd9e4; line-height: 1.55; margin: 8px 0 0; text-align: left; }
.mbl-account-note { font-size: 12px; color: #ffd27a; line-height: 1.5; margin: 10px 0 0; text-align: center; }
.mbl-account-note:empty { display: none; }
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
  private panorama: Panorama;
  private phase!: Phase;

  constructor(
    parent: HTMLElement,
    private readonly deps: SessionDeps = defaultDeps,
  ) {
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
   * the play card. Passed when the unified landing page has just shown all of
   * that — repeating it would be two landing pages in a row.
   */
  show(phase: Phase, defaults: { name: string; seed: number }, opts: { chromeless?: boolean } = {}): Promise<LaunchChoice> {
    this.phase = phase;
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
      <p class="mbl-tag">Multiplayer worlds on Calimero — no game server</p>
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
    // rather than tearing the launcher down, so the panorama keeps running and
    // dismissing the page again simply uncovers the card the visitor left.
    wrap.querySelector("[data-testid=back-to-landing]")!.addEventListener("click", () => {
      void showLandingAgain();
    });

    this.renderPlayCard(defaults, done);
  }

  private playCardEl(): HTMLElement {
    return this.root.querySelector("#mbl-play")!;
  }

  private renderPlayCard(defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const phase = this.phase;
    if (phase.status === "listing") this.renderListing();
    else if (phase.status === "unconfigured") this.renderUnconfigured(phase.message);
    else if (phase.status === "signed-out") this.renderSignIn(phase, defaults, done);
    else this.renderWorldPicker(phase, defaults, done);
    // Remembered as it is typed: the name a player chose should survive a reload.
    this.root.querySelector<HTMLInputElement>("#mbl-name")?.addEventListener("input", (e) => {
      localStorage.setItem("mb-name", (e.target as HTMLInputElement).value);
    });
  }

  private commonInputs(defaults: { name: string }): string {
    return `
      <label>player name</label>
      <input id="mbl-name" data-testid="name-input" value="${escapeHtml(defaults.name)}" maxlength="16" />
    `;
  }

  private readName(): string {
    return (this.root.querySelector<HTMLInputElement>("#mbl-name")?.value || "Player").trim() || "Player";
  }

  private readSeed(shade: HTMLElement, fallback: number): number {
    const raw = shade.querySelector<HTMLInputElement>("#mbl-seed")?.value;
    return Math.abs(Math.floor(Number(raw))) % 4294967296 || fallback;
  }

  // state 1: a copy no cluster serves (its listing page): open it where Calimero Cloud serves it
  private renderListing(): void {
    renderListing(this.playCardEl(), {
      name: "Mero Blocks",
      description: "Minecraft-style multiplayer voxel sandbox, with no game server.",
      package: PACKAGE,
      dir: "mero-blocks",
      dev: import.meta.env.DEV,
    }, "mbl-listing");
  }

  // state 1b: a build that cannot connect for another reason
  private renderUnconfigured(message: string): void {
    this.playCardEl().innerHTML = `
      <h3>Not connected</h3>
      <div class="mbl-error" data-testid="unconfigured">${escapeHtml(message)}</div>
      ${import.meta.env.DEV ? `<div class="mbl-note">For local play run <code>pnpm dev:local mero-blocks</code>.</div>` : ""}
    `;
  }

  // state 2: signed out. A passkey signs in; a new account is a new passkey.
  private renderSignIn(phase: SignedOut, defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    const invited = pendingInvite() !== null;
    el.innerHTML = `
      ${this.commonInputs(defaults)}
      ${invited ? `<div class="mbl-account-note" data-testid="invite-note">You've been invited to join a world in Mero Blocks. Sign in or create an account to accept.</div>` : ""}
      <button class="mbl-btn green" data-testid="sign-in-btn">Sign in with a passkey</button>
      <label>new account name</label>
      <input id="mbl-account" data-testid="account-name-input" maxlength="32" placeholder="${escapeHtml(defaults.name)}" />
      <button class="mbl-btn ghost" data-testid="sign-up-btn">Create account</button>
      <div class="mbl-error" data-testid="sign-in-error"></div>
      <div class="mbl-note" data-testid="target">${escapeHtml(describeTarget(phase.target))}</div>
    `;
    const errEl = el.querySelector<HTMLElement>("[data-testid=sign-in-error]")!;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>("button")];
    const ceremony = async (run: () => Promise<SignedIn>) => {
      errEl.textContent = "";
      buttons.forEach((b) => (b.disabled = true));
      try {
        this.phase = await run();
        this.renderPlayCard({ ...defaults, name: this.readName() }, done);
      } catch (e) {
        errEl.textContent = describeError(e);
        buttons.forEach((b) => (b.disabled = false));
      }
    };
    el.querySelector("[data-testid=sign-in-btn]")!.addEventListener("click", () => {
      void ceremony(() => signIn(phase, this.deps));
    });
    el.querySelector("[data-testid=sign-up-btn]")!.addEventListener("click", () => {
      const account = el.querySelector<HTMLInputElement>("#mbl-account")?.value.trim() || this.readName();
      void ceremony(() => signUp(phase, account, this.deps));
    });
  }

  // state 3: signed in — the Minecraft world list. The world last played
  // renders first, with one-click Enter; the rest load as cards below it.
  private renderWorldPicker(phase: SignedIn, defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    const source = worldSource(this.deps.env);
    el.innerHTML = `
      <h3>Choose a world</h3>
      ${this.commonInputs(defaults)}
      <div class="mbl-account-note" data-testid="account-note"></div>
      <div class="mbl-worlds" data-testid="world-list"><div class="mbl-note">Loading worlds…</div></div>
      <div class="mbl-error" data-testid="join-error"></div>
      <button class="mbl-btn green" data-testid="create-world-open-btn">Create world</button>
      <button class="mbl-btn ghost" data-testid="invite-btn" hidden>Invite friends</button>
      <button class="mbl-link" data-testid="sign-out-btn">Sign out</button>
      <div class="mbl-note" data-testid="target">${escapeHtml(describeTarget(phase.target))}</div>
    `;
    const listEl = el.querySelector<HTMLElement>("[data-testid=world-list]")!;
    const errEl = el.querySelector<HTMLElement>("[data-testid=join-error]")!;
    const noteEl = el.querySelector<HTMLElement>("[data-testid=account-note]")!;
    const inviteBtn = el.querySelector<HTMLButtonElement>("[data-testid=invite-btn]")!;

    const enter = (w: AppInfo | EnteredWorld) => {
      rememberWorld(phase.target, phase.accountId, w.appId);
      done({ name: this.readName(), session: phase, world: { appId: w.appId, name: w.name, org: w.org ?? null } });
    };

    el.querySelector("[data-testid=sign-out-btn]")!.addEventListener("click", () => {
      void signOut(phase).then((next) => {
        this.phase = next;
        this.renderPlayCard(defaults, done);
      });
    });
    el.querySelector("[data-testid=create-world-open-btn]")!.addEventListener("click", () =>
      this.openCreateWorldModal(phase, defaults, enter),
    );

    void (async () => {
      // An invitation opened before signing in: redeem it, then enter the
      // world it joined (or list it, if the answer did not say which).
      if (pendingInvite()) {
        noteEl.textContent = "Joining the world you were invited to…";
        // Already in it: open it, and leave the link unspent for whoever it was for.
        const mine = await alreadyInInvitedWorld(phase.client, source);
        if (mine) return enter(mine);
        try {
          const invited = await redeemPendingInvite(phase.client, source);
          phase.sessions.sync(phase.client);
          if (invited) return enter(invited);
          noteEl.textContent = "Invitation accepted — pick the world below.";
        } catch (e) {
          noteEl.textContent = inviteFailure(e);
        }
      }
      let worlds: AppInfo[];
      try {
        worlds = await listWorlds(phase.client, source);
        phase.sessions.sync(phase.client);
      } catch (e) {
        listEl.innerHTML = `<div class="mbl-note">Could not list worlds (${escapeHtml(describeError(e))}).</div>`;
        return;
      }
      listEl.innerHTML = "";
      if (worlds.length === 0) {
        listEl.innerHTML = `<div class="mbl-note">No worlds yet — create one, or open an invite link a friend sent you.</div>`;
        return;
      }
      const last = lastWorld(phase.target, phase.accountId);
      const current = worlds.find((w) => w.appId === last);
      const ordered = current ? [current, ...worlds.filter((w) => w !== current)] : worlds;
      ordered.forEach((w, i) =>
        listEl.appendChild(this.worldCard(phase, w, w === current, current ? i - 1 : i, enter, errEl)),
      );
      // Invites are for the world last played (an org of its own).
      if (current?.org) {
        const org = current.org;
        inviteBtn.hidden = false;
        inviteBtn.addEventListener("click", async () => {
          errEl.textContent = "";
          inviteBtn.disabled = true;
          inviteBtn.textContent = "Approve with your passkey…";
          try {
            const token = await inviteToken(phase.client, org, this.deps.passkey());
            phase.sessions.sync(phase.client);
            await navigator.clipboard.writeText(inviteLink(token, window.location, org));
            // Each link lets one person in: say so where it is copied.
            inviteBtn.textContent = "Invite copied: single use";
          } catch (e) {
            errEl.textContent = `Could not create invite: ${describeError(e)}`;
            inviteBtn.textContent = "Invite friends";
          } finally {
            setTimeout(() => {
              inviteBtn.textContent = "Invite friends";
              inviteBtn.disabled = false;
            }, 2500);
          }
        });
      }
    })();
  }

  /** one Minecraft-style world card: blurred terrain thumb, name, Enter, ⋯ menu */
  private worldCard(
    phase: SignedIn,
    w: AppInfo,
    isCurrent: boolean,
    index: number,
    enter: (w: AppInfo) => void,
    errEl: HTMLElement,
  ): HTMLElement {
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
          <div class="mbl-card-title">${escapeHtml(w.name || "Unnamed world")}</div>
          <code>${escapeHtml(w.appId)}</code>
          ${isCurrent ? `<div class="mbl-card-tag">last played</div>` : ""}
        </div>
        <div class="mbl-card-actions">
          <button class="mbl-join${isCurrent ? " enter" : ""}" data-testid="${joinTestId}">
            ${isCurrent ? "Enter" : "Play"}</button>
          <button class="mbl-kebab" data-testid="${menuTestId}" aria-label="World options">⋯</button>
        </div>
      </div>
      <div class="mbl-card-menu" hidden>
        <button data-action="copy-id">Copy world ID</button>
        <button data-action="forget">Forget local data</button>
      </div>
    `;
    drawWorldThumb(card.querySelector("canvas")!, w.appId);

    card.querySelector<HTMLButtonElement>(`[data-testid="${joinTestId}"]`)!.addEventListener("click", () => {
      errEl.textContent = "";
      enter(w);
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
        await navigator.clipboard.writeText(w.appId);
      } catch {
        /* clipboard unavailable — nothing sensible to do */
      }
      menu.hidden = true;
    });
    menu.querySelector("[data-action=forget]")!.addEventListener("click", () => {
      deleteWorld(w.appId); // local block edits + player position only
      if (isCurrent) forgetWorld(phase.target, phase.accountId);
      menu.hidden = true;
    });
    return card;
  }

  /** popup: create a world. Buttons lock while the cluster works — no double-create. */
  private openCreateWorldModal(
    phase: SignedIn,
    defaults: { name: string; seed: number },
    enter: (w: EnteredWorld) => void,
  ): void {
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
      const worldName = shade.querySelector<HTMLInputElement>("#mbl-world-name")?.value.trim() || "overworld";
      busy = true;
      createBtn.disabled = true;
      closeBtn.disabled = true;
      createBtn.textContent = "Creating…";
      try {
        const created = await createWorld(
          phase.client,
          worldSource(this.deps.env),
          worldName,
          this.readSeed(shade, defaults.seed),
        );
        phase.sessions.sync(phase.client);
        shade.remove();
        enter({ appId: created.appId, name: created.name, org: created.org });
      } catch (e) {
        errEl.textContent = `Could not create world: ${describeError(e)}`;
        busy = false;
        createBtn.disabled = false;
        closeBtn.disabled = false;
        createBtn.textContent = "Create world";
      }
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

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

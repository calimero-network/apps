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
// An invite link (`?invite=`) is asked about once signed in: "Join {inviter}'s
// game as {account}?", Join or Not now. Join redeems it and enters the world
// it joins; nothing is redeemed before that.
//
// The player's name is the world org's (net/playerName.ts): asked in the
// create-world dialog, or once right after an invite joins a world, and
// never again when entering a world that has it.

import type { AppInfo, SignUpPolicy } from "@calimero-network/mero-js";
import {
  describeError,
  describeInviteRefusal,
  describeRedeemFailure,
  inviteRefusal,
  isSpentInvite,
  readSignUpPolicy,
  signUpAccess,
  signUpNotice,
  type InviteStore,
  type PendingInvite,
} from "@calimero-apps/connect";
import { renderListing } from "@calimero-apps/passkey/listing";
import {
  describeSignUpNotFinished,
  SIGN_UP_CONFIRMING,
  SIGN_UP_READY,
  type SignUpFlow,
} from "@calimero-apps/passkey/signUpFlow";
import {
  describeCeremonyFailure,
  invitedFirst,
  noAccountCopy,
  noAccountHereAfter,
  passkeyUnknownAfter,
  SIGN_IN_HINT,
  type CeremonyFailure,
} from "@calimero-apps/passkey/ceremony";
import { watchUpgrades } from "@calimero-apps/passkey/upgrade";
import "@calimero-apps/passkey/passkey.css";
import { decideSelfName, rememberLastUsedName } from "@calimero-apps/names";

import {
  defaultDeps,
  describeTarget,
  knownAccount,
  newSignUp,
  signIn,
  signOut,
  signUp,
  type Phase,
  type SessionDeps,
  type SignedIn,
  type SignedOut,
} from "../net/session";
import {
  alreadyInInvitedWorld,
  createWorld,
  forgetWorld,
  invitedWorld,
  inviter,
  invites as gameInvites,
  inviteToken,
  lastWorld,
  listWorlds,
  redeemPendingInvite,
  rememberWorld,
  shortAccount,
  worldIn,
  worldInviteLink,
  worldSource,
} from "../net/worlds";
import { PACKAGE } from "../net/blocks";
import { knownName, readOrgName, saveOrgName } from "../net/playerName";
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
.mbl-link[hidden] { display: none; }
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
.mbl-ask { text-align: center; }
.mbl-ask h3 { margin: 4px 0 6px; }
.mbl-ask-actions { display: flex; gap: 8px; }
.mbl-ask-actions .mbl-btn { flex: 1; }
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
  /**
   * A sign-up from this card carried the invite and joined: the organization
   * it joined (`null` when it cannot be told) and the world its link named.
   */
  private joined: { org: string | null; world: string | null } | null = null;
  /** Takes the "new version" prompt away (sign-out, entering a world). */
  private stopUpgrades: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly deps: SessionDeps = defaultDeps,
    /** The pending-invite store; the game's own unless a test passes one. */
    private readonly invites: InviteStore = gameInvites,
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
    this.sessionChanged();
    return new Promise((resolve) => {
      if (opts.chromeless) this.root.classList.add("is-chromeless");
      this.render(defaults, (choice) => {
        this.offerUpgrades(null);
        this.panorama.destroy();
        this.root.remove();
        resolve(choice);
      });
    });
  }

  /**
   * The pending invite follows the session, as `usePasskeySession({ invites })`
   * keeps it in the React apps: kept under this cluster's key, held for the
   * account that signs in (and dropped when another one does).
   */
  private sessionChanged(): void {
    const phase = this.phase;
    if (phase.status === "signed-out" || phase.status === "signed-in") this.invites.bind(phase.target);
    if (phase.status === "signed-in") this.invites.signedIn(phase.accountId);
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
  // The sign-in every app shares (@calimero-apps/passkey's ceremony): only
  // this cluster's passkeys, "no account here" turns the card to creating
  // one in place, an invited player with no account here sees Create first,
  // and a sign-up carries the invite, joining the world in that step.
  private renderSignIn(phase: SignedOut, defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    // An invite the node refuses at sign-up is dropped: the card stops offering it.
    let invited = this.invites.token() !== null;
    el.innerHTML = `
      ${invited ? `<div class="mbl-account-note" data-testid="invite-note">You've been invited to join a world in Mero Blocks. Sign in or create an account to accept.</div>` : ""}
      <div class="mbl-note" data-testid="signin-switched" role="status" hidden></div>
      <div data-testid="sign-in-actions">
        <div data-testid="sign-in-group">
          <button class="mbl-btn green" data-testid="sign-in-btn">Sign in with a passkey</button>
          <div class="mbl-note" data-testid="sign-in-hint">${escapeHtml(SIGN_IN_HINT)}</div>
        </div>
        <div data-testid="sign-up-group">
          <label>new account name</label>
          <input id="mbl-account" data-testid="account-name-input" maxlength="32" placeholder="${escapeHtml(defaults.name || "Steve")}" />
          <button class="mbl-btn ghost" data-testid="sign-up-btn">Create account</button>
        </div>
      </div>
      <div data-testid="signup-approve-step" hidden>
        <button class="mbl-btn green" data-testid="signup-approve">Approve with your new passkey</button>
        <div class="mbl-note" data-testid="signup-approve-note" aria-live="polite"></div>
        <button class="mbl-link" data-testid="signup-cancel">Cancel</button>
      </div>
      <div class="mbl-note" data-testid="sign-up-unavailable" hidden></div>
      <div class="mbl-error" data-testid="sign-in-error"></div>
      <div class="mbl-note" data-testid="target">${escapeHtml(describeTarget(phase.target))}</div>
    `;
    const errEl = el.querySelector<HTMLElement>("[data-testid=sign-in-error]")!;
    const actions = el.querySelector<HTMLElement>("[data-testid=sign-in-actions]")!;
    const signInGroup = el.querySelector<HTMLElement>("[data-testid=sign-in-group]")!;
    const signUpGroup = el.querySelector<HTMLElement>("[data-testid=sign-up-group]")!;
    const signInBtn = el.querySelector<HTMLButtonElement>("[data-testid=sign-in-btn]")!;
    const signUpBtn = el.querySelector<HTMLButtonElement>("[data-testid=sign-up-btn]")!;
    const switchedEl = el.querySelector<HTMLElement>("[data-testid=signin-switched]")!;
    const buttons = [signInBtn, signUpBtn];
    const approveStep = el.querySelector<HTMLElement>("[data-testid=signup-approve-step]")!;
    const approveBtn = el.querySelector<HTMLButtonElement>("[data-testid=signup-approve]")!;
    const cancelBtn = el.querySelector<HTMLButtonElement>("[data-testid=signup-cancel]")!;
    const approveNote = el.querySelector<HTMLElement>("[data-testid=signup-approve-note]")!;
    const unavailableEl = el.querySelector<HTMLElement>("[data-testid=sign-up-unavailable]")!;
    // Who may create an account here (read once, never blocking): a closed or
    // invite-only cluster gets no "Create account", and says why.
    let policy: SignUpPolicy | null | undefined;
    let failure: CeremonyFailure | null = null;
    const access = () => signUpAccess(policy, this.invites.token() !== null);
    // Which action leads: an invited player this browser knows no account for
    // (or whose sign-in just found none) creates one; a sign-in the cluster
    // has no account for turns any player to creating one, in place.
    const layout = () => {
      const notice = signUpNotice(access());
      const canSignUp = notice === null;
      const noAccount = noAccountHereAfter(failure);
      const unknown = passkeyUnknownAfter(failure);
      const createFirst =
        canSignUp && (invited ? invitedFirst(knownAccount(phase, this.deps), noAccount) === "create" : unknown);
      if (createFirst) actions.prepend(signUpGroup);
      else actions.prepend(signInGroup);
      signUpBtn.className = `mbl-btn ${createFirst ? "green" : "ghost"}`;
      signInBtn.className = `mbl-btn ${createFirst ? "ghost" : "green"}`;
      signUpBtn.textContent = invited ? "Create your account and join" : unknown ? "Create an account here" : "Create account";
      signInBtn.textContent =
        invited && createFirst ? "Already have an account here? Join with your passkey" : "Sign in with a passkey";
      const switched = invited && canSignUp && noAccount;
      switchedEl.hidden = !switched;
      switchedEl.textContent = switched ? noAccountCopy("a world", unknown) : "";
      if (notice) signUpBtn.disabled = true;
      unavailableEl.hidden = notice === null;
      unavailableEl.textContent = notice ?? "";
    };
    layout();
    void readSignUpPolicy(phase.client).then((p) => {
      policy = p;
      layout();
    });
    // The sign-up in flight. Its second prompt (core's 412 CONFIRM_REQUIRED)
    // is asked right after the first; only when that fails or is refused
    // (Safari's user-gesture rule, a blocked prompt, a closed prompt) does it
    // wait for "Approve with your new passkey". A failure is shown and
    // Approve stays (signUpFlow).
    let flow: SignUpFlow | null = null;
    const showFlow = () => {
      const approving = flow !== null && (flow.stage === "approve" || flow.stage === "confirm");
      buttons.forEach((b) => (b.hidden = approving));
      approveStep.hidden = !approving;
      if (!flow || !approving) return;
      approveBtn.disabled = flow.stage !== "approve";
      approveBtn.textContent = flow.stage === "confirm" ? "Waiting for your passkey…" : "Approve with your new passkey";
      cancelBtn.hidden = flow.stage !== "approve";
      approveNote.textContent = flow.stage === "approve" ? SIGN_UP_READY : SIGN_UP_CONFIRMING;
      errEl.textContent = flow.confirmFailure ? describeSignUpNotFinished(flow.confirmFailure.error) : "";
      if (flow.stage === "approve") approveBtn.focus();
    };
    approveBtn.addEventListener("click", () => flow?.approve());
    cancelBtn.addEventListener("click", () => flow?.cancel());
    const ceremony = async (
      during: CeremonyFailure["during"],
      run: () => Promise<SignedIn>,
      signingUp: SignUpFlow | null = null,
    ) => {
      errEl.textContent = "";
      failure = null;
      buttons.forEach((b) => (b.disabled = true));
      flow = signingUp;
      try {
        this.phase = await run();
        this.sessionChanged();
        this.renderPlayCard(defaults, done);
      } catch (e) {
        // A sign-up refused because of its invite (unknown, used up,
        // expired, its org gone): the token is dropped and never sent again,
        // and the card says why, offering the account without it where the
        // cluster takes one.
        const refused = during === "sign-up" && invited ? inviteRefusal(e) : null;
        if (refused) {
          invited = false;
          this.invites.drop();
          el.querySelector("[data-testid=invite-note]")?.remove();
          failure = null;
          buttons.forEach((b) => (b.disabled = false));
          layout();
          const canSignUp = signUpNotice(access()) === null;
          errEl.textContent = `${describeInviteRefusal(refused)}${canSignUp ? " You can still create your account without it." : ""}`;
          return;
        }
        // A dismissed prompt (or a cancel at Approve) is quiet. An invited
        // player whose sign-in found no account is told so by the switch.
        failure = { error: e, during };
        const switched = invited && noAccountHereAfter(failure);
        errEl.textContent = switched ? "" : (describeCeremonyFailure(failure, access()) ?? "");
        buttons.forEach((b) => (b.disabled = false));
        layout();
        if (noAccountHereAfter(failure) && !signUpBtn.disabled) signUpBtn.focus();
      } finally {
        if (flow === signingUp) flow = null;
        showFlow();
      }
    };
    signInBtn.addEventListener("click", () => {
      void ceremony("sign-in", () => signIn(phase, this.deps));
    });
    signUpBtn.addEventListener("click", () => {
      const account = el.querySelector<HTMLInputElement>("#mbl-account")?.value.trim() || defaults.name || "Player";
      const signingUp: SignUpFlow = newSignUp(phase, showFlow, this.deps);
      void ceremony(
        "sign-up",
        async () => {
          const pending = this.invites.pending();
          const { joined, ...signedIn } = await signUp(
            phase,
            account,
            this.deps,
            { invite: invited ? (pending?.token ?? null) : null, policy },
            signingUp.passkey,
          );
          // Joined at sign-up: nothing is left to ask or redeem.
          if (joined) {
            this.invites.drop();
            this.joined = { org: joined.org ?? pending?.org ?? null, world: invitedWorld(pending) };
          }
          return signedIn;
        },
        signingUp,
      );
    });
  }

  // state 3: signed in — the Minecraft world list. The world last played
  // renders first, with one-click Enter; the rest load as cards below it.
  /**
   * "A new version is available" (@calimero-apps/passkey/upgrade) while the
   * world list shows: once per sign-in, to someone who may upgrade a world
   * (its owner, or MANAGE_APPLICATION in its organization) only.
   */
  private offerUpgrades(phase: SignedIn | null): void {
    if (!phase) {
      this.stopUpgrades?.();
      this.stopUpgrades = null;
      return;
    }
    this.stopUpgrades ??= watchUpgrades({
      client: phase.client,
      package: PACKAGE,
      appName: "Mero Blocks",
      accountId: phase.accountId,
      ...(this.deps.storage ? { storage: this.deps.storage } : {}),
    });
  }

  private renderWorldPicker(phase: SignedIn, defaults: { name: string; seed: number }, done: (c: LaunchChoice) => void): void {
    this.offerUpgrades(phase);
    const el = this.playCardEl();
    const source = worldSource(this.deps.env);
    el.innerHTML = `
      <h3>Choose a world</h3>
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

    // `joined`: an invite just let the player in, so a world's org without
    // their name asks for it rather than adopting an older one. `name`: the
    // one the create dialog just took.
    let entering = false;
    const enter = async (w: AppInfo | EnteredWorld, opts: { joined?: boolean; name?: string } = {}) => {
      if (entering) return;
      entering = true;
      const name = opts.name ?? (await this.playerName(phase, w.org ?? null, !!opts.joined, defaults.name));
      rememberWorld(phase.target, phase.accountId, w.appId);
      done({ name, session: phase, world: { appId: w.appId, name: w.name, org: w.org ?? null } });
    };

    el.querySelector("[data-testid=sign-out-btn]")!.addEventListener("click", () => {
      this.offerUpgrades(null);
      // The next person on this browser is not asked to join.
      this.invites.signedOut();
      void signOut(phase).then((next) => {
        this.phase = next;
        this.renderPlayCard(defaults, done);
      });
    });
    el.querySelector("[data-testid=create-world-open-btn]")!.addEventListener("click", () =>
      this.openCreateWorldModal(phase, defaults, enter),
    );

    void (async () => {
      // A sign-up that carried the invite joined in that step: enter the
      // world of the organization it joined, or list it.
      const joined = this.joined;
      this.joined = null;
      if (joined) {
        const world = worldIn(await listWorlds(phase.client, source).catch(() => []), joined.org, joined.world);
        phase.sessions.sync(phase.client);
        if (world) return enter(world, { joined: true });
        noteEl.textContent = "Invitation accepted — pick the world below.";
      }
      // An invitation: asked, never redeemed on its own. Already in its world:
      // enter it, and leave the link unspent for whoever it was for.
      if (this.invites.pending()) {
        const mine = await alreadyInInvitedWorld(phase.client, source, this.invites);
        phase.sessions.sync(phase.client);
        if (mine) return enter(mine);
        const pending = this.invites.pending();
        if (pending) {
          const answer = await this.askToJoin(listEl, phase, pending);
          if (answer.world) return enter(answer.world, { joined: true });
          noteEl.textContent = answer.note;
          listEl.innerHTML = `<div class="mbl-note">Loading worlds…</div>`;
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
            const name = knownName() || defaults.name;
            const from = !name || name === "Player" ? shortAccount(phase.accountId) : name;
            await navigator.clipboard.writeText(worldInviteLink(token, org, { world: current.appId, from }));
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

  /**
   * "Join {inviter}'s game as {account}?" in place of the world list, until
   * the player answers. Join redeems the invite: joined, it answers the world
   * to enter (or a note when the org holds none yet); refused for good, the
   * token is dropped and the note says so. A lapsed session, a rate limit or
   * the network keeps the token and the question, to try again. Not now
   * drops the token and joins nothing.
   */
  private askToJoin(
    listEl: HTMLElement,
    phase: SignedIn,
    pending: PendingInvite,
  ): Promise<{ world: AppInfo | null; note: string }> {
    const from = inviter(pending);
    const joining = from ? `${from}'s game` : "the game";
    listEl.innerHTML = `
      <div class="mbl-ask" data-testid="invite-confirm">
        <h3 data-testid="invite-question">Join ${escapeHtml(joining)} as ${escapeHtml(shortAccount(phase.accountId))}?</h3>
        <div class="mbl-note">Joining makes you a member of its world's organization: you can enter its worlds and build there.</div>
        <div class="mbl-error" data-testid="invite-error" role="alert"></div>
        <div class="mbl-ask-actions">
          <button class="mbl-btn green" data-testid="invite-join">Join</button>
          <button class="mbl-btn ghost" data-testid="invite-not-now">Not now</button>
        </div>
      </div>
    `;
    const joinBtn = listEl.querySelector<HTMLButtonElement>("[data-testid=invite-join]")!;
    const laterBtn = listEl.querySelector<HTMLButtonElement>("[data-testid=invite-not-now]")!;
    const errEl = listEl.querySelector<HTMLElement>("[data-testid=invite-error]")!;
    joinBtn.focus();
    return new Promise((resolve) => {
      laterBtn.addEventListener("click", () => {
        this.invites.drop();
        resolve({ world: null, note: "" });
      });
      joinBtn.addEventListener("click", async () => {
        errEl.textContent = "";
        joinBtn.disabled = true;
        laterBtn.disabled = true;
        joinBtn.textContent = "Joining…";
        try {
          const world = await redeemPendingInvite(phase.client, worldSource(this.deps.env), this.invites);
          resolve({ world, note: world ? "" : "Invitation accepted — pick the world below." });
        } catch (e) {
          if (isSpentInvite(e)) {
            resolve({ world: null, note: describeRedeemFailure(e) });
            return;
          }
          errEl.textContent = describeRedeemFailure(e);
          joinBtn.textContent = "Try again";
          joinBtn.disabled = false;
          laterBtn.disabled = false;
        } finally {
          phase.sessions.sync(phase.client);
        }
      });
    });
  }

  /** one Minecraft-style world card: blurred terrain thumb, name, Enter, ⋯ menu */
  private worldCard(
    phase: SignedIn,
    w: AppInfo,
    isCurrent: boolean,
    index: number,
    enter: (w: AppInfo) => Promise<void>,
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
        ${w.org ? `<button data-action="rename">Change your name</button>` : ""}
        <button data-action="forget">Forget local data</button>
      </div>
    `;
    drawWorldThumb(card.querySelector("canvas")!, w.appId);

    card.querySelector<HTMLButtonElement>(`[data-testid="${joinTestId}"]`)!.addEventListener("click", () => {
      errEl.textContent = "";
      void enter(w);
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
    // The name this player shows in this world (its org), changed in place.
    menu.querySelector("[data-action=rename]")?.addEventListener("click", async () => {
      menu.hidden = true;
      const org = w.org!;
      const { name: current } = await readOrgName(phase.client, org, phase.accountId);
      const name = await this.askName(current || knownName(), "Change your name", "Save", true);
      if (name === null) return;
      try {
        await saveOrgName(phase.client, org, phase.accountId, name);
      } catch (e) {
        errEl.textContent = `Could not change your name: ${describeError(e)}`;
      }
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
    enter: (w: EnteredWorld, opts: { name: string }) => Promise<void>,
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
        <label>your name in this world</label>
        <input id="mbl-self-name" data-testid="self-name-input" value="${escapeHtml(knownName() || defaults.name)}" maxlength="16" />
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
      const selfName = shade.querySelector<HTMLInputElement>("#mbl-self-name")?.value.trim() ?? "";
      if (!selfName) {
        errEl.textContent = "Enter the name other players will see.";
        return;
      }
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
        // The world's org holds the player's name from here on. Best effort:
        // a refused write leaves it unset, and the next entry adopts the name
        // remembered here instead of asking.
        rememberLastUsedName(selfName);
        await saveOrgName(phase.client, created.org, phase.accountId, selfName).catch(() => {});
        shade.remove();
        void enter({ appId: created.appId, name: created.name, org: created.org }, { name: selfName });
      } catch (e) {
        errEl.textContent = `Could not create world: ${describeError(e)}`;
        busy = false;
        createBtn.disabled = false;
        closeBtn.disabled = false;
        createBtn.textContent = "Create world";
      }
    });
  }

  /**
   * The name to enter a world as. A world's org that has one is used as is;
   * one without adopts the name this browser knew (worlds from before names
   * lived on the org), or, just joined, asks once and saves it there.
   */
  private async playerName(phase: SignedIn, org: string | null, joined: boolean, fallback: string): Promise<string> {
    const known = knownName();
    if (!org) return known || fallback || "Player";
    const { ready, name } = await readOrgName(phase.client, org, phase.accountId);
    const decision = decideSelfName({ orgReady: ready, orgName: name, fallbacks: joined ? [] : [known] });
    if (decision.kind === "use") return decision.name;
    // The org could not be read: play under the name known here, ask nobody twice.
    if (decision.kind === "wait" && known) return known;
    const chosen =
      decision.kind === "adopt"
        ? decision.name
        : ((await this.askName((decision.kind === "ask" && decision.suggestion) || known, "Your name in this world", "Play")) ?? "Player");
    await saveOrgName(phase.client, org, phase.accountId, chosen).catch(() => rememberLastUsedName(chosen));
    return chosen;
  }

  /** popup: the player's name in a world. `null` when closed without one (only a `cancellable` one closes). */
  private askName(suggestion: string, title: string, action: string, cancellable = false): Promise<string | null> {
    return new Promise((resolve) => {
      const shade = document.createElement("div");
      shade.className = "mbl-modal-shade";
      shade.dataset.testid = "name-modal";
      shade.innerHTML = `
        <div class="mbl-modal">
          <div class="mbl-modal-head">
            <h3>${escapeHtml(title)}</h3>
            ${cancellable ? `<button class="mbl-modal-close" data-testid="name-close" aria-label="Close">✕</button>` : ""}
          </div>
          <label>the name other players see in this world</label>
          <input id="mbl-self-name" data-testid="self-name-input" value="${escapeHtml(suggestion)}" maxlength="16" />
          <button class="mbl-btn green" data-testid="name-save-btn">${escapeHtml(action)}</button>
          <div class="mbl-error" data-testid="name-error"></div>
        </div>
      `;
      this.root.appendChild(shade);
      const input = shade.querySelector<HTMLInputElement>("#mbl-self-name")!;
      const finish = (name: string | null) => {
        shade.remove();
        resolve(name);
      };
      const save = () => {
        const name = input.value.trim();
        if (name) finish(name);
        else shade.querySelector<HTMLElement>("[data-testid=name-error]")!.textContent = "Enter a name.";
      };
      shade.querySelector("[data-testid=name-save-btn]")!.addEventListener("click", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
      });
      shade.querySelector("[data-testid=name-close]")?.addEventListener("click", () => finish(null));
      input.focus();
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

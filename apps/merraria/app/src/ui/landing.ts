// Landing page + launcher. Two states:
//  1. signed out → sign in with a passkey, or create an account (a new
//                  passkey). The account is the player, on merod local in
//                  development and on the Calimero Cloud cluster in
//                  production (net/session.ts picks which).
//  2. signed in  → pick one of the worlds this account reaches (the world
//                  last played renders first, one click to enter) or create
//                  one; invite friends into the world last played.
// An invitation link waits in the shared invite store (net/worlds.ts). Once
// signed in, the person is asked "Join {inviter}'s game as {account}?" (Join or
// Not now), and Join enters the invited world; nothing is redeemed before that.

import type { SignUpPolicy } from "@calimero-network/mero-js";
import {
  describeError,
  describeInviteRefusal,
  describeRedeemFailure,
  inviteRefusal,
  isSpentInvite,
  readSignUpPolicy,
  signUpAccess,
  signUpNotice,
  type AppSource,
  type InviteStore,
  type PendingInvite,
} from "@calimero-apps/connect";
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

import {
  CURRENT_WORLD,
  alreadyInInvitedWorld,
  createWorld,
  invitedWorld,
  inviter,
  invites as gameInvites,
  inviteToken,
  listWorlds,
  readCurrentWorld,
  redeemPendingInvite,
  worldIn,
  worldInviteLink,
  writeCurrentWorld,
  type World,
} from "../net/worlds";
import { toSeed } from "../net/merraria";
import { shortAccount, type Connection } from "../net/session";
import { deleteWorld } from "../state/persistence";
import { WorldAnim } from "./worldAnim";
import { showLandingAgain } from "../pages/landing/mount";

export interface LaunchChoice {
  name: string;
  world: World;
}

export interface LandingOptions {
  /** skip this screen's own logo/title/pitch (the unified landing just showed them) */
  chromeless?: boolean;
}


type Defaults = { name: string; seed: number };

const css = `
#mt-landing { position: fixed; inset: 0; overflow-y: auto; z-index: 20;
  background: #0b0e14; color: #fff; font-family: system-ui, -apple-system, sans-serif; }
.mtl-bg { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
.mtl-scrim { position: fixed; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(6,8,14,0.55) 0%, rgba(6,8,14,0.15) 35%,
    rgba(6,8,14,0.15) 65%, rgba(6,8,14,0.7) 100%); }
.mtl-wrap { position: relative; max-width: 520px; margin: 0 auto; padding: 20px 24px 18px;
  min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; }
/* The hero: the logo and the game's NAME, at the size a title screen wants.
   This replaces a 34px logo in a top-left nav bar plus a sentence-case h1 that
   was the pitch rather than the title — the launcher never actually said what
   the game is called. Mirrors the Mero Blocks title screen. */
.mtl-hero { display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding-top: 8px; }
.mtl-logo { width: 78px; height: 78px; display: grid; place-items: center;
  filter: drop-shadow(0 6px 12px rgba(0,0,0,0.5)); }
.mtl-logo svg { width: 78px; height: 78px; border-radius: 12px; display: block; }
.mtl-title { margin: 0; font-size: clamp(38px, 11vw, 60px); font-weight: 900;
  letter-spacing: 4px; text-transform: uppercase; line-height: 1; text-align: center;
  color: #fff; text-shadow: 0 4px 0 rgba(0,0,0,0.45), 0 0 28px rgba(0,0,0,0.5); }
.mtl-title em { font-style: normal; color: #58c56b; }
.mtl-tag { margin: 0; font-size: 13px; color: #cfe3d6; letter-spacing: 1px;
  text-align: center; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
.mtl-tag em { font-style: normal; color: #58c56b; }
.mtl-center { flex: 1; display: flex; flex-direction: column; justify-content: center;
  padding: 14px 0; }
.mtl-card { background: rgba(11,14,20,0.82); backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.14); border-radius: 16px; padding: 18px 24px 20px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.45); }
.mtl-card h3 { margin: 0 0 16px; font-size: 16px; }
.mtl-card label, .mtl-modal label { display: block; text-align: left; font-size: 12px;
  color: #9fb0c3; margin: 12px 0 4px; }
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
.mtl-link[hidden] { display: none; }
/* A sign-up's second prompt, which waits for its own click. */
.mtl-approve { text-align: center; }
.mtl-divider { display: flex; align-items: center; gap: 10px; color: #6d7f92; font-size: 11px;
  margin-top: 18px; text-transform: uppercase; letter-spacing: 1px; }
.mtl-divider::before, .mtl-divider::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,0.12); }
.mtl-worlds { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; max-height: 260px;
  overflow-y: auto; }
.mtl-world-card { position: relative; height: 78px; border-radius: 10px; overflow: hidden; flex: none;
  border: 1px solid rgba(255,255,255,0.16); background: #0d1117; }
.mtl-world-card > canvas { position: absolute; inset: 0; width: 100%; height: 100%;
  filter: blur(2.5px); transform: scale(1.12); image-rendering: pixelated; }
.mtl-card-scrim { position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.25) 100%); }
.mtl-card-body { position: relative; z-index: 1; height: 100%; box-sizing: border-box;
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.mtl-card-info { min-width: 0; text-align: left; }
.mtl-card-title { font-size: 13px; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mtl-card-info code { display: block; font-size: 10px; color: #b9c6d4; margin-top: 3px;
  max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mtl-card-tag { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #8fe0a0;
  margin-top: 3px; }
.mtl-card-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; flex: none; }
.mtl-card-actions .mtl-join { padding: 8px 16px; border-radius: 6px; border: none;
  background: #3f9950; color: #fff; font-weight: 600; cursor: pointer; }
.mtl-card-actions .mtl-join.enter { background: #4f8cff; }
.mtl-card-actions .mtl-join:disabled { background: #4a4f57; cursor: default; opacity: 0.7; }
.mtl-kebab { width: 30px; padding: 8px 0; border-radius: 6px; border: none;
  background: rgba(0,0,0,0.55); color: #fff; font-weight: 700; cursor: pointer; line-height: 1; }
.mtl-card-menu { position: absolute; right: 46px; top: 6px; z-index: 3; min-width: 150px;
  background: #131a26; border: 1px solid rgba(255,255,255,0.18); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6); display: flex; flex-direction: column; overflow: hidden; }
.mtl-card-menu[hidden] { display: none; }
.mtl-card-menu button { background: none; border: none; color: #dfe7ee; padding: 9px 12px;
  text-align: left; font-size: 12px; cursor: pointer; }
.mtl-card-menu button:hover { background: rgba(255,255,255,0.08); }
.mtl-world button { padding: 6px 14px; border-radius: 6px; border: none; background: #4f8cff;
  color: #fff; font-weight: 600; cursor: pointer; }
.mtl-note { font-size: 12px; color: #8fa3ba; margin-top: 10px; line-height: 1.5; }
/* The way back out to the marketing page.
   ⚠️ Its own row BELOW the card, centred, so it lands directly under the
   "Merraria runs on your Calimero node — connect one to play …" note: the line
   a visitor with no node reads immediately before they give up and go back.
   Outside the card, and a bordered button rather than a link — an 11px grey
   link on a dark card over the world animation reads as a caption, with
   nothing to say it is pressable. */
.mtl-backrow { text-align: center; margin-top: 14px; }
.mtl-back { display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 13px 7px 11px; border-radius: 8px; cursor: pointer; font-family: inherit;
  font-size: 12px; font-weight: 600; color: #dfe7ee;
  background: rgba(11,14,20,0.82); border: 1px solid rgba(255,255,255,0.22);
  backdrop-filter: blur(6px); box-shadow: 0 4px 16px rgba(0,0,0,0.45); }
.mtl-back:hover { color: #fff; background: rgba(30,38,50,0.9); border-color: rgba(255,255,255,0.4); }
.mtl-back span { font-size: 14px; line-height: 1; }
/* What the keys do, on the screen you read BEFORE the world loads — in game
   the same list is behind Esc/O, which is no help to a first-time player who
   does not know that yet. */
/* The negative side margins let the row use the wrap's own 24px gutter: the
   six bindings need a hair more than the 520px column, and without it "O menu"
   drops to a second line on its own. */
.mtl-controls { margin: 14px -14px 0; color: #cfd9e4; font-size: 12px;
  display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 12px;
  text-shadow: 0 1px 4px rgba(0,0,0,0.85); }
/* each binding is ONE unit — a plain inline run wrapped between a key and the
   verb it belongs to, which read as a different control entirely */
.mtl-controls span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.mtl-controls kbd { background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
  border-radius: 4px; padding: 2px 6px; font-family: ui-monospace, monospace; font-size: 11px; }
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
.mtl-account { font-size: 12px; color: #8fe0a0; margin: -8px 0 4px; }
.mtl-account code { color: #cdd9e5; }
.mtl-ask { text-align: center; }
.mtl-ask h3 { margin: 4px 0 6px; }
.mtl-ask-actions { display: flex; gap: 8px; }
.mtl-ask-actions .mtl-btn { flex: 1; }
.mtl-warn { color: #ffd37a; font-size: 12px; margin-top: 10px; line-height: 1.5; }
.mtl-social { display: flex; gap: 20px; justify-content: center; align-items: center;
  flex-wrap: wrap; margin-top: 8px; }
.mtl-social a { color: #8fa3ba; text-decoration: none; display: inline-flex; align-items: center;
  gap: 6px; font-size: 12px; }
.mtl-social a:hover { color: #fff; }
.mtl-social svg { width: 15px; height: 15px; fill: currentColor; }

/* Chromeless: the unified landing page (src/pages/landing) has already shown the
   logo, the name and the pitch, so when it hands off here the launcher must not
   repeat them — it goes straight to the world picker. See main.ts. */
#mt-landing.is-chromeless .mtl-hero, #mt-landing.is-chromeless .mtl-footer { display: none !important; }
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
    href: "https://github.com/calimero-network/apps",
    icon: `<svg viewBox="0 0 24 24"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.35.95.1-.74.4-1.25.72-1.53-2.55-.29-5.23-1.28-5.23-5.69 0-1.25.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.77 1.05.77 2.13v3.15c0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>`,
  },
  {
    label: "Source",
    href: "https://github.com/calimero-network/apps/tree/main/apps/merraria",
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
  /** A sign-up from this card carried the invite and joined: the org it joined and the world its link named. */
  private joinedAtSignUp: { org: string | null; world: string | null } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly conn: Connection,
    private readonly source: AppSource,
    /** The pending-invite store; the game's own unless a test passes one. */
    private readonly invites: InviteStore = gameInvites,
  ) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "mt-landing";
    this.root.dataset.testid = "landing";
    parent.appendChild(this.root);
  }

  /**
   * `chromeless` skips this screen's own logo/title/pitch and goes straight to
   * the world picker. Passed when the unified landing page has just shown all
   * of that — repeating it would be two landing pages in a row.
   */
  show(defaults: Defaults, opts: LandingOptions = {}): Promise<LaunchChoice> {
    this.sessionChanged();
    return new Promise((resolve) => {
      if (opts.chromeless) this.root.classList.add("is-chromeless");
      this.render(defaults, (choice) => {
        this.anim?.stop();
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
    this.invites.bind(this.conn.target);
    if (this.conn.accountId) this.invites.signedIn(this.conn.accountId);
  }

  /** The world last played by this account on this target. */
  private current(): World | null {
    return readCurrentWorld(localStorage, this.conn.scopedKey(CURRENT_WORLD));
  }

  private setCurrent(world: World | null): void {
    writeCurrentWorld(localStorage, this.conn.scopedKey(CURRENT_WORLD), world);
  }

  private render(defaults: Defaults, done: (c: LaunchChoice) => void): void {
    this.root.innerHTML = `
      <canvas class="mtl-bg" data-testid="world-anim"></canvas>
      <div class="mtl-scrim"></div>
      <div class="mtl-wrap">
        <div class="mtl-hero">
          <div class="mtl-logo">${LOGO_SVG}</div>
          <h1 class="mtl-title">Mer<em>raria</em></h1>
          <p class="mtl-tag">A Terraria-style world that lives on <em>Calimero</em></p>
        </div>
        <div class="mtl-center">
          <div class="mtl-card" data-testid="play-card"><div id="mtl-play"></div></div>
          <div class="mtl-backrow">
            <button type="button" class="mtl-back" data-testid="back-to-landing">
              <span aria-hidden="true">&larr;</span> Back to landing page
            </button>
          </div>
          <div class="mtl-controls" data-testid="controls">
            <span><kbd>A</kbd>&thinsp;<kbd>D</kbd> move</span>
            <span><kbd>Space</kbd> jump</span>
            <span><kbd>LMB</kbd> dig</span>
            <span><kbd>RMB</kbd> place</span>
            <span><kbd>1–9</kbd> tile</span>
            <span><kbd>O</kbd> menu</span>
          </div>
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
    const bg = this.root.querySelector<HTMLCanvasElement>(".mtl-bg")!;
    if (bg.getContext("2d")) {
      this.anim = new WorldAnim(bg);
      this.anim.start();
    }

    // Renders the marketing page ON TOP of this launcher (z-index 50 over 20)
    // rather than tearing the launcher down, so the world animation keeps
    // running and dismissing the page simply uncovers the card left behind.
    this.root.querySelector("[data-testid=back-to-landing]")!.addEventListener("click", () => {
      void showLandingAgain();
    });

    this.renderPlayCard(defaults, done);
  }

  private playCardEl(): HTMLElement {
    return this.root.querySelector("#mtl-play")!;
  }

  private renderPlayCard(defaults: Defaults, done: (c: LaunchChoice) => void): void {
    if (this.conn.accountId) this.renderWorldPicker(defaults, done);
    else this.renderSignIn(defaults, done);
    // Remembered as it is typed: the passkey ceremony can reload nothing, but a
    // player who leaves and comes back keeps the name they chose.
    this.root.querySelector<HTMLInputElement>("#mtl-name")?.addEventListener("input", (e) => {
      localStorage.setItem("mt-name", (e.target as HTMLInputElement).value);
    });
  }

  private commonInputs(defaults: { name: string }): string {
    return `
      <label>player name</label>
      <input id="mtl-name" data-testid="name-input" value="${escapeHtml(defaults.name)}" maxlength="16" />
    `;
  }

  private readName(): string {
    return (this.root.querySelector<HTMLInputElement>("#mtl-name")?.value || "Player").trim() || "Player";
  }

  // state 1: signed out. The game is online-only: the way in is an account.
  // The sign-in every app shares (@calimero-apps/passkey's ceremony): only
  // this cluster's passkeys, "no account here" turns the card to creating
  // one in place, an invited player with no account here sees Create first,
  // and a sign-up carries the invite, joining the world in that step.
  private renderSignIn(defaults: Defaults, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    // An invite the node refuses at sign-up is dropped: the card stops offering it.
    let invited = this.invites.token() !== null;
    el.innerHTML = `
      <h3>${invited ? "You're invited" : "Play now"}</h3>
      ${
        invited
          ? `<div class="mtl-account" data-testid="invite-waiting">You've been invited to join a world in Merraria. Sign in or create an account to accept.</div>`
          : ""
      }
      ${this.commonInputs(defaults)}
      <div class="mtl-note" data-testid="signin-switched" role="status" hidden></div>
      <div data-testid="sign-in-actions">
        <div data-testid="sign-in-group">
          <button class="mtl-btn green" data-testid="sign-in-btn">Sign in with a passkey</button>
          <div class="mtl-note" data-testid="sign-in-hint">${escapeHtml(SIGN_IN_HINT)}</div>
        </div>
        <button class="mtl-btn ghost" data-testid="sign-up-btn">Create an account</button>
      </div>
      <div class="mtl-approve" data-testid="signup-approve-step" hidden>
        <button class="mtl-btn green" data-testid="signup-approve">Approve with your new passkey</button>
        <div class="mtl-note" data-testid="signup-approve-note" aria-live="polite"></div>
        <button class="mtl-link" data-testid="signup-cancel">Cancel</button>
      </div>
      <div class="mtl-note" data-testid="sign-up-unavailable" hidden></div>
      <div class="mtl-error" data-testid="sign-in-error"></div>
      <div class="mtl-note">Accounts are passkeys: nothing to remember, nothing to leak.
        Connected to ${escapeHtml(this.conn.describe())}. A new account takes the player name above.</div>
      ${invited ? `<button class="mtl-link" data-testid="invite-not-now">Not now</button>` : ""}
    `;
    // "Not now": the landing page, over this launcher; the invitation stays
    // stored, so signing in from there (its "Sign in" uncovers this card)
    // still joins the world.
    el.querySelector("[data-testid=invite-not-now]")?.addEventListener("click", () => {
      void showLandingAgain();
    });
    const errEl = el.querySelector<HTMLElement>("[data-testid=sign-in-error]")!;
    const actions = el.querySelector<HTMLElement>("[data-testid=sign-in-actions]")!;
    const signInGroup = el.querySelector<HTMLElement>("[data-testid=sign-in-group]")!;
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
    // invite-only cluster gets no "Create an account", and says why.
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
        canSignUp && (invited ? invitedFirst(this.conn.knownAccount(), noAccount) === "create" : unknown);
      if (createFirst) actions.prepend(signUpBtn);
      else actions.prepend(signInGroup);
      signUpBtn.className = `mtl-btn ${createFirst ? "green" : "ghost"}`;
      signInBtn.className = `mtl-btn ${createFirst ? "ghost" : "green"}`;
      signUpBtn.textContent = invited ? "Create your account and join" : unknown ? "Create an account here" : "Create an account";
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
    void readSignUpPolicy(this.conn.client).then((p) => {
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
      actions.hidden = approving;
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
    const ceremony = async (during: CeremonyFailure["during"], run: () => Promise<unknown>, signUp: SignUpFlow | null = null) => {
      errEl.textContent = "";
      failure = null;
      buttons.forEach((b) => (b.disabled = true));
      flow = signUp;
      try {
        await run();
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
          el.querySelector("[data-testid=invite-waiting]")?.remove();
          el.querySelector("[data-testid=invite-not-now]")?.remove();
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
        if (flow === signUp) flow = null;
        showFlow();
      }
    };
    signInBtn.addEventListener("click", () => void ceremony("sign-in", () => this.conn.signIn()));
    signUpBtn.addEventListener("click", () => {
      const signUp: SignUpFlow = this.conn.newSignUp(showFlow);
      void ceremony(
        "sign-up",
        async () => {
          const pending = this.invites.pending();
          const made = await this.conn.signUp(
            this.readName(),
            { invite: invited ? (pending?.token ?? null) : null, policy },
            signUp.passkey,
          );
          // Joined at sign-up: nothing is left to ask or redeem.
          if (made.joined) {
            this.invites.drop();
            this.joinedAtSignUp = { org: made.joined.org ?? pending?.org ?? null, world: invitedWorld(pending) };
          }
        },
        signUp,
      );
    });
  }

  // state 2: signed in — the Minecraft world list. The world last played (if
  // any) renders first, synchronously, with one-click Enter; the rest of the
  // account's worlds load as cards below it. Creating a world lives in a popup.
  private renderWorldPicker(defaults: Defaults, done: (c: LaunchChoice) => void): void {
    const el = this.playCardEl();
    const current = this.current();
    el.innerHTML = `
      <h3>Choose a world</h3>
      <div class="mtl-account" data-testid="account-badge">Signed in as
        <code>${escapeHtml(shortAccount(this.conn.accountId ?? ""))}</code> on ${escapeHtml(this.conn.describe())}</div>
      ${this.commonInputs(defaults)}
      <div class="mtl-worlds" data-testid="world-list"></div>
      <div class="mtl-warn" data-testid="notice" hidden></div>
      <div class="mtl-error" data-testid="join-error"></div>
      <button class="mtl-btn green" data-testid="create-world-open-btn">Create world</button>
      ${current?.org ? `<button class="mtl-btn ghost" data-testid="invite-btn">Invite friends to ${escapeHtml(current.name || "this world")}</button>` : ""}
      <button class="mtl-link" data-testid="disconnect-btn">Sign out</button>
    `;
    const listEl = el.querySelector<HTMLElement>("[data-testid=world-list]")!;
    const errEl = el.querySelector<HTMLElement>("[data-testid=join-error]")!;
    const noticeEl = el.querySelector<HTMLElement>("[data-testid=notice]")!;

    el.querySelector("[data-testid=disconnect-btn]")!.addEventListener("click", () => {
      // The next person on this browser is not asked to join.
      this.invites.signedOut();
      void this.conn.signOut().then(() => this.renderPlayCard(defaults, done));
    });
    el.querySelector("[data-testid=create-world-open-btn]")!.addEventListener("click", () =>
      this.openCreateWorldModal(defaults, done),
    );

    const inviteBtn = el.querySelector<HTMLButtonElement>("[data-testid=invite-btn]");
    if (inviteBtn && current?.org) {
      const org = current.org;
      inviteBtn.addEventListener("click", async () => {
        errEl.textContent = "";
        inviteBtn.disabled = true;
        inviteBtn.textContent = "Creating invite…";
        try {
          const token = await inviteToken(this.conn.client, org, this.conn.approver());
          const name = this.readName();
          const from = name === "Player" ? shortAccount(this.conn.accountId ?? "") : name;
          const link = worldInviteLink(token, org, { world: current.appId, from });
          await navigator.clipboard.writeText(link);
          inviteBtn.textContent = "Single-use invite link copied!";
        } catch (e) {
          errEl.textContent = `Could not create invite: ${describeError(e)}`;
          inviteBtn.textContent = "Invite friends";
        } finally {
          this.conn.sync();
          setTimeout(() => {
            inviteBtn.textContent = `Invite friends to ${current.name || "this world"}`;
            inviteBtn.disabled = false;
          }, 2500);
        }
      });
    }

    const enter = (w: World) => {
      this.setCurrent(w);
      done({ name: this.readName(), world: w });
    };
    const joined = this.joinedAtSignUp;
    this.joinedAtSignUp = null;
    // An invitation (or a join at sign-up) opens its world, so the world last
    // played does not render first then.
    const inviting = joined !== null || this.invites.pending() !== null;

    // the world last played renders synchronously — entering it must never
    // wait on the world-list fetch
    if (current && !inviting) listEl.appendChild(this.worldCard(current, true, -1, done));
    const loading = document.createElement("div");
    loading.className = "mtl-note";
    loading.textContent = "Loading worlds…";
    listEl.appendChild(loading);

    void (async () => {
      // A sign-up that carried the invite joined in that step: enter the world
      // its link named, else the one in the org it joined.
      if (joined) {
        const world = worldIn(await listWorlds(this.conn.client, this.source).catch(() => []), joined.org, joined.world);
        this.conn.sync();
        if (world) return enter(world);
        noticeEl.textContent = "Invitation accepted: the world is in your list.";
        noticeEl.hidden = false;
      }
      // An invitation: asked, never redeemed on its own. A player already in
      // the invited world (the inviter opening their own link) enters it, and
      // the link stays unspent for the player it was meant for.
      if (this.invites.pending()) {
        const mine = await alreadyInInvitedWorld(this.conn.client, this.source, this.invites);
        this.conn.sync();
        if (mine) return enter(mine);
        const pending = this.invites.pending();
        if (pending) {
          const answer = await this.askToJoin(listEl, pending);
          if (answer.world) return enter(answer.world);
          if (answer.note) {
            noticeEl.textContent = answer.note;
            noticeEl.hidden = false;
          }
          listEl.innerHTML = "";
          if (current) listEl.appendChild(this.worldCard(current, true, -1, done));
          listEl.appendChild(loading);
        }
      }
      try {
        const worlds = await listWorlds(this.conn.client, this.source);
        loading.remove();
        const others = worlds.filter((w) => w.appId !== current?.appId);
        if (!current && others.length === 0) {
          listEl.innerHTML = `<div class="mtl-note">No worlds yet — create one, or open an invite link a friend sent you.</div>`;
          return;
        }
        others.forEach((w, i) => listEl.appendChild(this.worldCard(w, false, i, done)));
      } catch (e) {
        loading.textContent = `Could not list worlds (${describeError(e)}).`;
      } finally {
        this.conn.sync();
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
  private askToJoin(listEl: HTMLElement, pending: PendingInvite): Promise<{ world: World | null; note: string }> {
    const from = inviter(pending);
    const joining = from ? `${from}'s game` : "the game";
    listEl.innerHTML = `
      <div class="mtl-ask" data-testid="invite-confirm">
        <h3 data-testid="invite-question">Join ${escapeHtml(joining)} as ${escapeHtml(shortAccount(this.conn.accountId ?? ""))}?</h3>
        <div class="mtl-note">Joining makes you a member of its world's organization: you can enter its worlds and build there.</div>
        <div class="mtl-error" data-testid="invite-error" role="alert"></div>
        <div class="mtl-ask-actions">
          <button class="mtl-btn green" data-testid="invite-join">Join</button>
          <button class="mtl-btn ghost" data-testid="invite-later">Not now</button>
        </div>
      </div>
    `;
    const joinBtn = listEl.querySelector<HTMLButtonElement>("[data-testid=invite-join]")!;
    const laterBtn = listEl.querySelector<HTMLButtonElement>("[data-testid=invite-later]")!;
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
          const world = await redeemPendingInvite(this.conn.client, this.source, this.invites);
          resolve({ world, note: world ? "" : "Invitation accepted: the world is in your list." });
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
          this.conn.sync();
        }
      });
    });
  }

  /** one Minecraft-style world card: blurred terrain thumb, name, Play/Enter, ⋯ menu */
  private worldCard(w: World, isCurrent: boolean, index: number, done: (c: LaunchChoice) => void): HTMLElement {
    const card = document.createElement("div");
    card.className = "mtl-world-card";
    card.dataset.testid = isCurrent ? "world-card-current" : `world-card-${index}`;
    const joinTestId = isCurrent ? "connect-btn" : `join-world-${index}`;
    const menuTestId = isCurrent ? "world-menu-current" : `world-menu-${index}`;
    card.innerHTML = `
      <canvas></canvas>
      <div class="mtl-card-scrim"></div>
      <div class="mtl-card-body">
        <div class="mtl-card-info">
          <div class="mtl-card-title">${escapeHtml(w.name || "Unnamed world")}</div>
          <code>${escapeHtml(w.appId)}</code>
          ${isCurrent ? `<div class="mtl-card-tag">last played</div>` : ""}
        </div>
        <div class="mtl-card-actions">
          <button class="mtl-join${isCurrent ? " enter" : ""}" data-testid="${joinTestId}">
            ${isCurrent ? "Enter" : "Play"}</button>
          <button class="mtl-kebab" data-testid="${menuTestId}" aria-label="World options">⋯</button>
        </div>
      </div>
      <div class="mtl-card-menu" hidden>
        <button data-action="copy-id">Copy world ID</button>
        <button data-action="forget">Forget local data</button>
      </div>
    `;
    const thumb = card.querySelector("canvas")!;
    if (thumb.getContext("2d")) drawWorldThumb(thumb, w.appId);

    // Every listed world is one this account already reaches (a member of its
    // org): entering it is all there is to do.
    card.querySelector<HTMLButtonElement>(`[data-testid="${joinTestId}"]`)!.addEventListener("click", () => {
      this.setCurrent(w);
      done({ name: this.readName(), world: w });
    });

    const menu = card.querySelector<HTMLElement>(".mtl-card-menu")!;
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
      deleteWorld(w.appId); // local tile edits + player position only
      menu.hidden = true;
    });
    return card;
  }

  /** popup: create a world. Buttons lock while the cluster works — no double-create. */
  private openCreateWorldModal(defaults: Defaults, done: (c: LaunchChoice) => void): void {
    const shade = document.createElement("div");
    shade.className = "mtl-modal-shade";
    shade.dataset.testid = "create-modal";
    shade.innerHTML = `
      <div class="mtl-modal">
        <div class="mtl-modal-head">
          <h3>Create world</h3>
          <button class="mtl-modal-close" data-testid="create-close" aria-label="Close">✕</button>
        </div>
        <label>world name</label>
        <input id="mtl-world-name" data-testid="world-name-input" value="surface" maxlength="24" />
        <label>seed</label>
        <input id="mtl-seed" data-testid="seed-input" value="${defaults.seed}" />
        <button class="mtl-btn green" data-testid="create-world-btn">Create world</button>
        <div class="mtl-error" data-testid="create-error"></div>
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
      const worldName = shade.querySelector<HTMLInputElement>("#mtl-world-name")?.value.trim() || "surface";
      const seed = toSeed(shade.querySelector<HTMLInputElement>("#mtl-seed")?.value, defaults.seed);
      busy = true;
      createBtn.disabled = true;
      closeBtn.disabled = true;
      createBtn.textContent = "Creating…";
      try {
        const world = await createWorld(this.conn.client, this.source, worldName, seed, this.conn.sync);
        this.setCurrent(world);
        shade.remove();
        done({ name: this.readName(), world });
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

/**
 * Static blocky terrain thumbnail for a world card, deterministic from the
 * context id (the world's real seed isn't known before joining) — blurred by
 * CSS into the Minecraft world-list look. Merraria flavor: a side-on strip
 * with dirt, deep stone, and the occasional ore fleck.
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
  sky.addColorStop(0, "#5f97d8");
  sky.addColorStop(1, "#bcdcf7");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffe9a8";
  ctx.fillRect(8 + Math.floor(rnd() * 60), 4 + Math.floor(rnd() * 8), 7, 7);

  const B = 6; // tile size
  let ground = 20 + rnd() * 10;
  for (let x = 0; x < W; x += B) {
    ground = Math.max(14, Math.min(H - 10, ground + (rnd() - 0.5) * 8));
    const top = Math.floor(ground / B) * B;
    ctx.fillStyle = `rgb(${70 + rnd() * 25}, ${160 + rnd() * 30}, ${80 + rnd() * 25})`;
    ctx.fillRect(x, top, B, B);
    for (let y = top + B; y < H; y += B) {
      const deep = y > top + 2 * B;
      if (deep) {
        const ore = rnd();
        ctx.fillStyle =
          ore < 0.06
            ? "#d8b13c" // gold fleck
            : ore < 0.14
              ? "#3a3f46" // coal fleck
              : `rgb(${95 + rnd() * 20}, ${95 + rnd() * 20}, ${100 + rnd() * 20})`;
      } else {
        ctx.fillStyle = `rgb(${125 + rnd() * 25}, ${86 + rnd() * 18}, ${52 + rnd() * 14})`;
      }
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


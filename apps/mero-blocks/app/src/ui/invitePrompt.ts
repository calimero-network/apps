// The invitation prompt: "You've been invited to <world>" — Join / Not now.
//
// An invite reaches this app only as an opened link. The shared capture
// (`primeInvitationCapture` in main.ts) hears it whether the link loaded the
// page (`?invitation=…`) or a running desktop handed it over as a `deep-link`
// event, and holds it until something can act on it. Here it is offered, and
// joined only on a click.
//
// Who can join changes as the player moves: the world picker joins and starts
// the game; a running game has to leave its world first; the connect screen
// cannot join at all. So each screen installs its own `InviteJoiner` while it
// is up, and the prompt shows only while one is installed. An invitation that
// arrives on the connect screen waits for the picker; one the player has not
// answered when the picker hands over to the game is asked again in the game.

import {
  onInvitation,
  shouldRetain,
  type CapturedInvitation,
} from "@calimero-apps/invite";
import { WorldInviteError } from "../net/admin";
import { decodeInvite, type WorldInvitePayload } from "../net/inviteCodec";

export interface InviteJoiner {
  /** Join the invited world and go there. Throws to refuse; the message is shown. */
  join(code: string, payload: WorldInvitePayload): Promise<void>;
  /** The prompt just appeared (the game drops pointer lock and held keys). */
  onShow?(): void;
}

const css = `
.mbi-shade { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  font-family: system-ui, -apple-system, sans-serif; }
.mbi-modal { width: min(400px, 94vw); box-sizing: border-box; background: rgba(10,13,18,0.97);
  border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 18px 20px 20px;
  box-shadow: 0 16px 60px rgba(0,0,0,0.7); color: #fff; text-align: center; }
.mbi-modal h3 { margin: 0 0 8px; font-size: 15px; }
.mbi-modal p { margin: 0; font-size: 13px; color: #cfd9e4; line-height: 1.5; overflow-wrap: anywhere; }
.mbi-modal strong { color: #8fe0a0; }
.mbi-error { color: #ff8686; font-size: 12px; margin-top: 10px; line-height: 1.5; }
.mbi-row { display: flex; gap: 8px; margin-top: 14px; }
.mbi-btn { flex: 1; padding: 11px; border-radius: 5px; border: 2px solid rgba(0,0,0,0.75);
  font-size: 14px; font-weight: 700; cursor: pointer; color: #fff;
  text-shadow: 0 1px 0 rgba(0,0,0,0.45);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.22), inset 0 -3px 0 rgba(0,0,0,0.3); }
.mbi-btn:hover { filter: brightness(1.12); }
.mbi-btn:disabled { cursor: default; opacity: 0.7; filter: none; }
.mbi-btn.green { background: #3f9950; }
.mbi-btn.ghost { background: #6e6e6e; }
`;

let joiner: InviteJoiner | null = null;
/** The invitation being offered, from capture until it is joined or declined. */
let pending: CapturedInvitation | null = null;
let shade: HTMLElement | null = null;
let busy = false;
let subscribed = false;

/**
 * Install (or with `null`, remove) the screen that can join right now. The
 * first install subscribes to the capture, which until then holds any link.
 */
export function setInviteJoiner(next: InviteJoiner | null): void {
  joiner = next;
  if (busy) return; // the join in flight finishes on the joiner that started it
  if (!next) {
    close();
    return;
  }
  if (!subscribed) {
    subscribed = true;
    onInvitation(offer);
  }
  if (pending) show(pending);
}

/** Whether the prompt is on screen (the game freezes its input under it). */
export function invitePromptOpen(): boolean {
  return shade !== null;
}

function offer(invitation: CapturedInvitation): void {
  // A second link while the first is joining waits for the next load: it is
  // not acked, so the capture offers it again then.
  if (busy) return;
  pending = invitation;
  if (joiner) show(invitation);
}

function show(invitation: CapturedInvitation): void {
  close();
  injectStyle();
  const payload = decodeInvite(invitation.token);
  shade = document.createElement("div");
  shade.className = "mbi-shade";
  shade.dataset.testid = "invite-prompt";
  document.body.appendChild(shade);
  joiner?.onShow?.();

  if (!payload) {
    // Nothing to join, now or later — ack it so it stops replaying.
    invitation.resolve();
    pending = null;
    renderFailure("This invite link is damaged — ask for a fresh one.", false);
    wire(null, null);
    return;
  }
  const world = payload.groupAlias?.trim();
  shade.innerHTML = `
    <div class="mbi-modal" role="dialog" aria-modal="true" aria-labelledby="mbi-title">
      <h3 id="mbi-title">World invitation</h3>
      <p data-testid="invite-status">You've been invited to
        ${world ? `<strong>${escapeHtml(world)}</strong>` : "a world"}.</p>
      <div class="mbi-row">
        <button class="mbi-btn ghost" data-testid="invite-decline">Not now</button>
        <button class="mbi-btn green" data-testid="invite-accept">Join</button>
      </div>
    </div>`;
  wire(invitation, payload);
}

/** The reason a join failed, with Try again (if it can still work) and a way out. */
function renderFailure(message: string, retryable: boolean): void {
  if (!shade) return;
  shade.innerHTML = `
    <div class="mbi-modal" role="dialog" aria-modal="true" aria-labelledby="mbi-title">
      <h3 id="mbi-title">World invitation</h3>
      <div class="mbi-error" data-testid="invite-error">${escapeHtml(message)}</div>
      <div class="mbi-row">
        <button class="mbi-btn ghost" data-testid="invite-decline">${retryable ? "Not now" : "Close"}</button>
        ${retryable ? `<button class="mbi-btn green" data-testid="invite-retry">Try again</button>` : ""}
      </div>
    </div>`;
}

/** Hook up whatever the prompt shows: the way out, and Join / Try again if present. */
function wire(
  invitation: CapturedInvitation | null,
  payload: WorldInvitePayload | null,
): void {
  if (!shade) return;
  shade
    .querySelector("[data-testid=invite-decline]")!
    .addEventListener("click", decline);
  const accept = shade.querySelector<HTMLButtonElement>(
    "[data-testid=invite-accept], [data-testid=invite-retry]",
  );
  if (accept && invitation && payload)
    accept.addEventListener("click", () => void join(invitation, payload));
}

async function join(
  invitation: CapturedInvitation,
  payload: WorldInvitePayload,
): Promise<void> {
  const by = joiner;
  if (busy || !by || !shade) return;
  busy = true;
  for (const b of shade.querySelectorAll<HTMLButtonElement>("button"))
    b.disabled = true;
  const accept = shade.querySelector<HTMLButtonElement>(
    "[data-testid=invite-accept], [data-testid=invite-retry]",
  );
  if (accept) accept.textContent = "Joining…";
  try {
    await by.join(invitation.token, payload);
    invitation.resolve();
    pending = null;
    busy = false;
    close();
  } catch (e) {
    busy = false;
    // Finished with (expired, invalid, refused): ack it. Anything else — no
    // member online, node unreachable, the world not synced yet — may work on
    // a retry, so it stays offered, here and on the next load.
    const final = e instanceof WorldInviteError && !shouldRetain(e.outcome);
    if (final) {
      invitation.resolve();
      pending = null;
    }
    renderFailure(
      `Could not join: ${e instanceof Error ? e.message : String(e)}`,
      !final,
    );
    wire(invitation, payload);
    // The screen that offered it went away while the join ran: nothing here can
    // retry it now, and the next screen that can will offer it again.
    if (!joiner) close();
  }
}

/** "Not now": the player has answered, so the link is not offered again. */
function decline(): void {
  if (busy) return;
  pending?.resolve();
  pending = null;
  close();
}

function close(): void {
  shade?.remove();
  shade = null;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Test seam: forget the joiner, the offered invitation and the subscription. */
export function resetInvitePromptForTests(): void {
  close();
  joiner = null;
  pending = null;
  busy = false;
  subscribed = false;
}

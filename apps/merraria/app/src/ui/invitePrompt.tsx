// The invitation prompt: mero-react's `InvitationDialog` — Join / Not now, then
// joining, then syncing until the joined world has loaded from the node.
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
// is up, and the prompt asks only while one is installed. An invitation that
// arrives on the connect screen waits for the picker; one the player has not
// answered when the picker hands over to the game is asked again in the game.
//
// The game is not React, so the dialog lives in a small React root of its own,
// mounted the first time a screen installs a joiner. It outlives the screens:
// a join from the picker starts the game underneath it, and the dialog stays
// on "Syncing…" until the game reports the world loaded (`reportWorldLoaded`).

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  InvitationDialog,
  useInviteRedemption,
  type ParsedInvitation,
  type RedeemOutcome,
} from "@calimero-network/mero-react";
import { WorldInviteError } from "../net/admin";
import {
  decodeInvite,
  namespaceIdOfInvite,
  type WorldInvitePayload,
} from "../net/inviteCodec";

export interface InviteJoiner {
  /**
   * Join the invited world and go there; resolves with the world's context id.
   * Throws to refuse: a `WorldInviteError` carries whether a retry can work,
   * anything else is shown as is and may be retried.
   */
  join(code: string, payload: WorldInvitePayload): Promise<{ contextId: string; already?: boolean }>;
  /** The prompt just appeared (the game drops held keys and its menu). */
  onShow?(): void;
}

interface WorldInvitation extends ParsedInvitation {
  token: string;
  payload: WorldInvitePayload;
}

// ── The two facts the dialog reads from outside React ────────────────────────

let joiner: InviteJoiner | null = null;
/** The world the game has read from the node: its meta and its edits. */
let loadedWorld: string | null = null;
let open = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/**
 * The dialog in this game's own look: the dark in-game panel, pale text and
 * green action the old prompt had. mero-react styles the dialog through
 * `--mero-*` variables; `body > .mero-invite-overlay` outranks its rule.
 */
const GAME_DIALOG_CSS = `
body > .mero-invite-overlay {
  --mero-overlay: rgba(0, 0, 0, 0.6);
  --mero-bg-secondary: rgba(10, 13, 18, 0.97);
  --mero-bg-tertiary: rgba(255, 255, 255, 0.08);
  --mero-text: #ffffff;
  --mero-text-secondary: #cfd9e4;
  --mero-accent: #3f9950;
  --mero-accent-hover: #4aad5c;
  --mero-on-primary: #ffffff;
  --mero-border: rgba(255, 255, 255, 0.18);
  --mero-error: #ff8686;
  --mero-radius: 9px;
  font-family: system-ui, -apple-system, sans-serif;
}
body > .mero-invite-overlay .mero-invite-icon { color: #8fe0a0; }
`;

let root: Root | null = null;
let host: HTMLElement | null = null;

/**
 * Install (or with `null`, remove) the screen that can join right now. The
 * first install mounts the dialog, which until then leaves any link held by
 * the capture.
 */
export function setInviteJoiner(next: InviteJoiner | null): void {
  joiner = next;
  if (next && !root) {
    const style = document.createElement("style");
    style.dataset.role = "invite-style";
    style.textContent = GAME_DIALOG_CSS;
    document.head.appendChild(style);
    host = document.createElement("div");
    host.dataset.role = "invite-root";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<InvitePrompt />);
    return;
  }
  notify();
}

/**
 * The game has read `contextId`'s state from the node (an empty world counts).
 * That is what ends the dialog's "Syncing…" after a join.
 */
export function reportWorldLoaded(contextId: string): void {
  loadedWorld = contextId;
  notify();
}

/** Whether the prompt is on screen (the game freezes its input under it). */
export function invitePromptOpen(): boolean {
  return open;
}

function InvitePrompt() {
  const current = useSyncExternalStore(subscribe, () => joiner);
  const loaded = useSyncExternalStore(subscribe, () => loadedWorld);
  const [joinedWorld, setJoinedWorld] = useState<string | null>(null);

  const parse = useCallback((token: string): WorldInvitation | null => {
    const payload = decodeInvite(token);
    if (!payload) return null;
    return {
      namespaceId: namespaceIdOfInvite(payload),
      invitation: payload.invitation,
      teamName: payload.groupAlias?.trim() || undefined,
      token,
      payload,
    };
  }, []);

  const redeem = useCallback(
    async ({ token, payload, namespaceId, teamName }: WorldInvitation): Promise<RedeemOutcome> => {
      // The joiner installed NOW, not at render: the picker hands over to the
      // game while this runs, and a retry belongs to whichever screen is up.
      const by = joiner;
      if (!by) {
        return {
          status: "failed",
          namespaceId,
          message: "Open the world list to join this world.",
          reason: "unknown",
          retryable: true,
        };
      }
      try {
        const { contextId, already } = await by.join(token, payload);
        setJoinedWorld(contextId);
        return { status: already ? "already-member" : "joined", namespaceId, teamName };
      } catch (e) {
        // A refusal the node decided carries its outcome; anything later (the
        // subgroup or context join) is thrown as is, which redemption reads as
        // a retryable failure and shows in the node's own words.
        if (e instanceof WorldInviteError) return e.outcome;
        throw e;
      }
    },
    [],
  );

  const redemption = useInviteRedemption({ parse, redeem, enabled: current !== null });
  const stage = redemption.state.stage;
  // A question nobody here can act on (the picker gave way to the connect
  // screen, or is handing over to the game) waits for the next screen to ask it.
  const visible = stage !== "idle" && !(stage === "awaiting-confirmation" && !current);

  useEffect(() => {
    open = visible;
    if (visible) joiner?.onShow?.();
  }, [visible]);
  useEffect(() => () => void (open = false), []);

  if (!visible) return null;
  return (
    <InvitationDialog
      redemption={redemption}
      noun="world"
      appName="Merraria"
      synced={joinedWorld !== null && loaded === joinedWorld}
    />
  );
}

/** Test seam: unmount the dialog and forget the joiner and the loaded world. */
export function resetInvitePromptForTests(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  joiner = null;
  loadedWorld = null;
  open = false;
}

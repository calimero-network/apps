import { useDeepLink } from "@calimero-network/mero-platform-react";

import { clearNamespaceReady } from "../utils/session";

/**
 * An invitation opened while already inside a workspace.
 *
 * Only the workspace picker (`NamespaceEntryPopup` on /login) redeems
 * invitations, so one that arrived here sat in the pending-intent store until
 * the user happened to go back to it. Leave it there, unacknowledged, and go
 * to the picker, which consumes it exactly as it does on a cold open.
 *
 * Once per invitation per session: the picker keeps one that failed
 * transiently, to retry on a later load, and handing that off on every visit
 * here would bounce between the two pages for as long as it keeps failing.
 *
 * A real navigation by default: see Home's guard for why a client-side one can
 * ping-pong against App's route gate.
 */
const HANDED_OFF_KEY = "curb:invitations-handed-off";

function handedOff(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(HANDED_OFF_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function useInvitationHandoff(
  go: (path: string) => void = (path) => window.location.replace(path),
): void {
  useDeepLink((intent) => {
    const invitation = intent.params.invitation;
    if (!invitation) return;
    const seen = handedOff();
    if (seen.includes(invitation)) return;
    try {
      sessionStorage.setItem(HANDED_OFF_KEY, JSON.stringify([...seen, invitation]));
    } catch {
      return; // cannot remember it, so do not risk the loop
    }
    clearNamespaceReady();
    go("/login");
  });
}

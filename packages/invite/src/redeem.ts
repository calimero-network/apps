// ── Redeeming an invitation: joining once, and knowing whether it worked ──────
//
// The engine lives in mero-js (calimero-network/mero-js#207, 21.3.0), which this
// package's copy was ported to: join once, then check membership, so a request
// that failed while the join landed anyway (the desktop proxy aborts at 30s; a
// join with no member online takes up to 95s) is `already-member`, not a
// failure that replays the link on every load. The failure reason is read off
// the node's status (core rc.56+), and off its message for an older node.
//
// It is re-exported here so the apps' imports stay where they are. What stays
// local is the copy a person reads, which is this repo's to word.

import type { InviteFailureReason } from "@calimero-network/mero-js";

export {
  redeemInvitation,
  isSettled,
  shouldRetain,
} from "@calimero-network/mero-js";
export type {
  InviteFailureReason,
  InviteRedeemer,
  RedeemOutcome,
} from "@calimero-network/mero-js";

/**
 * What to tell a person about a failed join, or `null` to show the node's own
 * message (an `unknown` failure has nothing better to offer).
 *
 * `noun` is what the app calls the thing being joined: "team", "space", "vault".
 */
export function describeInviteFailure(
  reason: InviteFailureReason,
  noun = "team",
): string | null {
  switch (reason) {
    case "expired":
      return "This invitation has expired. Ask for a new link.";
    case "invalid":
      return "This invitation link isn't valid. Ask for a new one.";
    case "refused":
      return `You can't join this ${noun} with this invitation. Ask an admin to invite you again.`;
    case "signed-out":
      return "Your session with your node has ended. Sign in again to finish joining.";
    case "no-one-online":
      return `No one in this ${noun} is online to let you in yet. It will try again the next time you open the app.`;
    case "node-unreachable":
      return "Couldn't reach your node. Check that it is running, then try again.";
    case "unknown":
      return null;
  }
}

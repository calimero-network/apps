import { describeInviteFailure, type RedeemOutcome } from "@calimero-apps/invite";

/** What to tell the user about a failed join, in this app's noun. */
export function inviteFailureMessage(
  outcome: Extract<RedeemOutcome, { status: "failed" }>,
): string {
  return describeInviteFailure(outcome.reason, "workspace") ?? outcome.message;
}

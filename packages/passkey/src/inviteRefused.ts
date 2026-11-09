import { describeInviteRefusal, signUpNotice, type InviteRefusal, type SignUpAccess } from "@calimero-apps/connect";

/** A sign-up the node refused because of the page's invite. */
export interface InviteRefused {
  reason: InviteRefusal;
  /** The token it refused: never sent again. */
  token: string;
  /**
   * Whether the browser had made the new passkey before the refusal. The node
   * judges the invite at `register/begin`, before any passkey is made, so this
   * is `false` unless the invite went bad between the two halves; then the
   * passkey has no account behind it. `null` when the hook cannot tell (a
   * sign-up without `approveWithClick`'s flow).
   */
  passkeyMade: boolean | null;
}

/**
 * What a refused invite says: why, whether the account can still be created
 * without it (by the cluster's policy, `access` read without the token; where
 * it cannot, the control says why under its disabled button), and
 * the orphan passkey when there is one.
 */
export function describeInviteRefused(refused: InviteRefused, access: SignUpAccess): string {
  const parts = [describeInviteRefusal(refused.reason)];
  // Where the policy takes no account without one, the control says why.
  if (signUpNotice(access) === null) parts.push("You can still create your account without it.");
  if (refused.passkeyMade) {
    parts.push("The passkey your browser made for this sign-up has no account behind it: you can delete it from your passkeys.");
  }
  return parts.join(" ");
}

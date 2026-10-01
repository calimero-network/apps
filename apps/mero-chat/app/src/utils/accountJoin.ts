import {
  redeemInvitation,
  type InviteRedeemer,
  type JoinInvitationInput,
} from "@calimero-network/mero-react";

import type { GroupInvitationPayload } from "./invitation";

/** The namespace an invitation admits to, hex — the form admin routes take. */
export function invitationNamespaceId(parsed: GroupInvitationPayload): string {
  const inv = parsed.invitation.invitation as unknown as Record<string, unknown>;
  const rawId = inv.group_id ?? inv.groupId;
  return Array.isArray(rawId)
    ? (rawId as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
    : String(rawId ?? "");
}

export type AccountJoinResult =
  | { ok: true; groupId: string; memberIdentity: string }
  | { ok: false; message: string; retryable: boolean };

/**
 * Join a workspace as an account, through mero-react's redeemer.
 *
 * Not the node's `joinGroup`: an account that has just enrolled holds a
 * credential and no relay, so there is no client to call yet. The redeemer
 * reaches the admitter the invitation names. The member is the account itself:
 * an account has no per-namespace identity of its own to look up.
 */
export async function joinAsAccount(
  parsed: GroupInvitationPayload,
  account: string,
  redeemerFor: (input: JoinInvitationInput) => InviteRedeemer,
): Promise<AccountJoinResult> {
  const namespaceId = invitationNamespaceId(parsed);
  // The app's own copy of the invitation type, without mero-js's brand for "a
  // node signed this": the bytes are the inviter's either way, and the node
  // that admits the claim is what checks the signature.
  const invitation = parsed.invitation as unknown as JoinInvitationInput["invitation"];
  const outcome = await redeemInvitation(
    { namespaceId, invitation },
    redeemerFor({ namespaceId, invitation }),
  );
  if (outcome.status === "failed") {
    return { ok: false, message: outcome.message, retryable: outcome.retryable };
  }
  return { ok: true, groupId: namespaceId, memberIdentity: account };
}

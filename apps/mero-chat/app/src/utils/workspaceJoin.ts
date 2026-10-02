import { redeemInvitation, shouldRetain } from "@calimero-apps/invite";
import type { InviteRedeemer, JoinInvitationInput } from "@calimero-network/mero-react";

import type { GroupInvitationPayload } from "./invitation";
import { inviteFailureMessage } from "./redeemInvitation";

/** The namespace an invitation admits to, hex — the form admin routes take. */
export function invitationNamespaceId(parsed: GroupInvitationPayload): string {
  const inv = parsed.invitation.invitation as unknown as Record<string, unknown>;
  const rawId = inv.group_id ?? inv.groupId;
  return Array.isArray(rawId)
    ? (rawId as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
    : String(rawId ?? "");
}

export type WorkspaceJoinResult =
  | { ok: true; groupId: string; memberIdentity: string }
  | { ok: false; message: string; retryable: boolean };

/**
 * Join a workspace from an invitation, through mero-react's redeemer — the
 * same call on a node (it joins on itself) and on an account (through the
 * admitter the invitation names, even with no relay yet). The member is the
 * session's own account, `whoAmI` answers it for both.
 */
export async function joinWorkspace(
  parsed: GroupInvitationPayload,
  whoAmI: () => Promise<string>,
  redeemerFor: (input: JoinInvitationInput) => InviteRedeemer,
): Promise<WorkspaceJoinResult> {
  const namespaceId = invitationNamespaceId(parsed);
  // The app's own copy of the invitation type, without mero-js's brand for "a
  // node signed this": the bytes are the inviter's either way, and the node
  // that admits the claim is what checks the signature.
  const invitation = parsed.invitation as unknown as JoinInvitationInput["invitation"];
  // Membership decides, not whether the join request resolved: the desktop
  // proxy aborts admin requests at 30s while a join can land anyway, and that
  // is a member (`already-member`), not a failure.
  const outcome = await redeemInvitation(
    { namespaceId, invitation, teamName: parsed.groupAlias },
    redeemerFor({ namespaceId, invitation }),
  );
  if (outcome.status === "failed") {
    // In this app's words, and acked only when no retry can help: a transient
    // failure (no online member, a timeout) keeps the invitation.
    return { ok: false, message: inviteFailureMessage(outcome), retryable: shouldRetain(outcome) };
  }
  return { ok: true, groupId: namespaceId, memberIdentity: await whoAmI() };
}

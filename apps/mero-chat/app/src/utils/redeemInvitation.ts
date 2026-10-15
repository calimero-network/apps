import type { InviteRedeemer, ParsedInvitation } from "@calimero-network/mero-react";
import type { GroupApi } from "../api/groupApi";
import {
  decodeInvitationPayload,
  parseGroupInvitationPayload,
  type GroupInvitationPayload,
} from "./invitation";

/** The two calls redeeming needs, so tests can drive them without a node. */
export interface GroupInvitationRedeemer {
  /** This app's namespace join (`GroupApiDataSource.joinGroup`). */
  joinGroup: GroupApi["joinGroup"];
  /** The session's namespaces, as the session admin's `listNamespaces()` answers. */
  listNamespaces: () => Promise<
    readonly { namespaceId?: string; groupId?: string }[] | null | undefined
  >;
}

/** The namespace a signed invitation grants (`group_id`, hex or bytes). */
function invitedNamespaceId(payload: GroupInvitationPayload): string {
  const inv = payload.invitation.invitation as unknown as Record<
    string,
    unknown
  >;
  const rawId = inv.group_id ?? inv.groupId;
  return Array.isArray(rawId)
    ? (rawId as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
    : String(rawId ?? "");
}

/**
 * Read the token an opened link carried into what the prompt shows and the
 * join sends. Null when it is not a chat invitation at all.
 *
 * `invitation` is the whole wrapped payload, so the join can send the alias the
 * inviter named the workspace with alongside the signed invitation.
 */
export function parseInvitationToken(token: string): ParsedInvitation | null {
  const json = decodeInvitationPayload(token);
  const payload = json ? parseGroupInvitationPayload(json) : null;
  if (!payload) return null;
  return {
    namespaceId: invitedNamespaceId(payload),
    invitation: payload,
    teamName: payload.groupAlias?.trim() || undefined,
  };
}

/**
 * This app's join, in the shape `redeemInvitation` drives.
 *
 * Membership decides, not whether the join request resolved: the desktop proxy
 * aborts admin requests at 30s while a namespace join can take far longer and
 * land anyway, and that is a member, not a failure. `redeemInvitation` settles
 * a failed request against the node's namespace list.
 *
 * `onMemberIdentity` hears the identity the join answered with. It is not
 * called when the node did not say — an `already-member` outcome never reached
 * a response — so the caller resolves it from the member list.
 */
export function groupInvitationRedeemer(
  redeemer: GroupInvitationRedeemer,
  onMemberIdentity?: (memberIdentity: string) => void,
): InviteRedeemer {
  return {
    join: async (_namespaceId, invitation) => {
      const payload = invitation as GroupInvitationPayload;
      const res = await redeemer.joinGroup({
        invitation: payload.invitation,
        groupAlias: payload.groupAlias,
      });
      if (res.error || !res.data) {
        const message = res.error?.message || "Failed to join namespace";
        // The node's own proof of membership; not a failure.
        if (/already a member/i.test(message)) return;
        // `joinGroup` answers in an envelope rather than throwing; rethrow
        // with the status so the outcome can say why.
        throw Object.assign(new Error(message), { status: res.error?.code });
      }
      onMemberIdentity?.(res.data.memberIdentity);
    },
    memberships: async () =>
      ((await redeemer.listNamespaces()) ?? []).flatMap((n) => {
        const id = n.namespaceId ?? n.groupId;
        return id ? [id] : [];
      }),
  };
}

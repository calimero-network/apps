import {
  describeInviteFailure,
  redeemInvitation,
  type RedeemOutcome,
} from "@calimero-apps/invite";
import type { GroupApi } from "../api/groupApi";
import type { GroupInvitationPayload } from "./invitation";

/** The two calls redeeming needs, so tests can drive them without a node. */
export interface GroupInvitationRedeemer {
  /** This app's namespace join (`GroupApiDataSource.joinGroup`). */
  joinGroup: GroupApi["joinGroup"];
  /** The session's namespaces, as the session admin's `listNamespaces()` answers. */
  listNamespaces: () => Promise<
    readonly { namespaceId?: string; groupId?: string }[] | null | undefined
  >;
}

export interface RedeemedGroupInvitation {
  outcome: RedeemOutcome;
  /**
   * The member identity the join answered with. Empty when the node did not
   * say — an `already-member` outcome never reached a response — so the
   * caller resolves it from the member list.
   */
  memberIdentity: string;
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
 * Join the workspace an invitation names, and say whether it worked.
 *
 * Membership decides, not whether the join request resolved: the desktop proxy
 * aborts admin requests at 30s while a namespace join can take far longer and
 * land anyway, and that is a member, not a failure. `redeemInvitation` settles
 * a failed request against the node's namespace list.
 */
export async function redeemGroupInvitation(
  payload: GroupInvitationPayload,
  redeemer: GroupInvitationRedeemer,
): Promise<RedeemedGroupInvitation> {
  let memberIdentity = "";
  const outcome = await redeemInvitation(
    {
      namespaceId: invitedNamespaceId(payload),
      invitation: payload.invitation,
      teamName: payload.groupAlias,
    },
    {
      join: async () => {
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
        memberIdentity = res.data.memberIdentity;
      },
      memberships: async () =>
        ((await redeemer.listNamespaces()) ?? []).flatMap((n) => {
          const id = n.namespaceId ?? n.groupId;
          return id ? [id] : [];
        }),
    },
  );
  return { outcome, memberIdentity };
}

/** What to tell the user about a failed join, in this app's noun. */
export function inviteFailureMessage(
  outcome: Extract<RedeemOutcome, { status: "failed" }>,
): string {
  return describeInviteFailure(outcome.reason, "workspace") ?? outcome.message;
}

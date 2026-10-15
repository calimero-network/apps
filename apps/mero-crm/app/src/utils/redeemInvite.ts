/**
 * Redeeming a workspace invitation: read the token a link carried, join once,
 * and say what happened.
 *
 * The two halves `useInviteRedemption` (from `@calimero-apps/invite`) asks an
 * app for: `parseInviteToken` reads the token without touching the node, so the
 * prompt can name the workspace before anyone clicks; `inviteRedeemer` is the
 * pair of node calls. The join-and-decide part is the package's
 * `redeemInvitation`, which asks the node whether this workspace is now listed
 * instead of trusting the request alone. That matters because the desktop proxy
 * aborts a request at 30s while a join can take far longer and still land:
 * judged by the request, a workspace the node had joined read as "could not
 * join", and the invitation replayed on every load.
 *
 * Kept free of React so the whole path — decode, join, classify — is testable
 * against a fake admin client.
 */
import type { InviteRedeemer, ParsedInvitation } from "@calimero-apps/invite";
import type { AdminApiClient } from "@calimero-network/mero-js";
import { decodeInvitation } from "./invitation";
import {
  groupIdOfInvite,
  parseInvitePayload,
  type SignedInvitation,
} from "./invitePayload";

/** The two node calls a redeem makes: `mero.admin`, narrowed. */
export type InviteAdmin = Pick<
  AdminApiClient,
  "joinNamespace" | "listNamespaces"
>;

/**
 * The `joinNamespace` body, which is what `ParsedInvitation.invitation` carries
 * here: the signed invitation plus the workspace's name. `groupName` rides along
 * because it is what makes the joiner's sidebar say "Platform team" instead of
 * `20150f8a`, and the redeemer is handed only the id and this.
 */
export interface JoinBody {
  invitation: SignedInvitation;
  groupName?: string;
}

/**
 * Read the token a link carried. `null` for one that names nothing to join —
 * the redemption hook reports that as an unreadable invitation.
 */
export function parseInviteToken(token: string): ParsedInvitation | null {
  let decoded: unknown;
  try {
    decoded = decodeInvitation(token);
  } catch {
    return null;
  }
  const payload = parseInvitePayload(decoded);
  if (!payload) return null;

  // The id to act on comes from INSIDE the signed invitation, never from the
  // wrapper around it, so a tampered link cannot redirect a join. The wrapper's
  // `groupId` is only a fallback for a node that signs no group id.
  const namespaceId = groupIdOfInvite(payload) || payload.groupId || "";
  if (!namespaceId) return null;

  const body: JoinBody = {
    invitation: payload.invitation,
    ...(payload.groupAlias ? { groupName: payload.groupAlias } : {}),
  };
  return { namespaceId, invitation: body, teamName: payload.groupAlias };
}

/** The node calls behind a join. `admin` is null until a session exists. */
export function inviteRedeemer(admin: InviteAdmin | null): InviteRedeemer {
  return {
    join: async (id, body) => {
      if (!admin) throw new Error("Not connected to your node.");
      await admin.joinNamespace(id, body as never);
    },
    memberships: async () => {
      if (!admin) throw new Error("Not connected to your node.");
      return (await admin.listNamespaces()).map((n) => n.namespaceId);
    },
  };
}

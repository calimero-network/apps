/**
 * Redeeming a workspace invite code: read it, join once, and say what happened.
 *
 * The join-and-decide part is `@calimero-apps/invite`'s `redeemInvitation`,
 * which asks the node whether this workspace is now listed instead of trusting
 * the request alone. That matters because the desktop proxy aborts a request at
 * 30s while a join can take far longer and still land: judged by the request, a
 * workspace the node had joined read as "could not join", and the invitation
 * replayed on every load.
 *
 * Kept free of React so the whole path — decode, join, classify — is testable
 * against a fake admin client.
 */
import {
  describeInviteFailure,
  redeemInvitation,
  type RedeemOutcome,
} from '@calimero-apps/invite';
import type { AdminApiClient } from '@calimero-network/mero-js';
import { decodeInvitation } from './invitation';
import { groupIdOfInvite, parseInvitePayload } from './invitePayload';

/** The two node calls a redeem makes: `mero.admin`, narrowed. */
export type InviteAdmin = Pick<AdminApiClient, 'joinNamespace' | 'listNamespaces'>;

/** A code that could not even be read names nothing to join, so it is final. */
function unreadable(message: string): RedeemOutcome {
  return { status: 'failed', namespaceId: null, message, reason: 'invalid', retryable: false };
}

/**
 * Join the workspace `code` invites to. Never throws: an unreadable code, a
 * refused join and an unreachable node are all a `failed` outcome.
 */
export async function redeemInviteCode(
  code: string,
  admin: InviteAdmin | null,
): Promise<RedeemOutcome> {
  let decoded: unknown;
  try {
    decoded = decodeInvitation(code);
  } catch (err) {
    return unreadable(err instanceof Error ? err.message : 'That invite link could not be read.');
  }
  const payload = parseInvitePayload(decoded);
  if (!payload) return unreadable('That invite link could not be read.');

  // The id to act on comes from INSIDE the signed invitation, never from the
  // wrapper around it, so a tampered link cannot redirect a join. The wrapper's
  // `groupId` is only a fallback for a node that signs no group id.
  const namespaceId = groupIdOfInvite(payload) || payload.groupId || null;
  if (!namespaceId) return unreadable('Invalid invitation: cannot determine namespace.');

  return redeemInvitation(
    { namespaceId, invitation: payload.invitation, teamName: payload.groupAlias },
    {
      join: async (id, invitation) => {
        if (!admin) throw new Error('Not connected to your node.');
        // `groupName` is the creator's workspace name, riding along in the
        // payload. Passing it is what makes the joiner's sidebar say "Platform
        // team" instead of `20150f8a`.
        await admin.joinNamespace(id, {
          invitation: invitation as never,
          ...(payload.groupAlias ? { groupName: payload.groupAlias } : {}),
        });
      },
      memberships: async () => {
        if (!admin) throw new Error('Not connected to your node.');
        return (await admin.listNamespaces()).map((n) => n.namespaceId);
      },
    },
  );
}

/** What the join dialog says about a failed redeem. */
export function inviteFailureCopy(outcome: Extract<RedeemOutcome, { status: 'failed' }>): string {
  return describeInviteFailure(outcome.reason, 'workspace') ?? outcome.message;
}

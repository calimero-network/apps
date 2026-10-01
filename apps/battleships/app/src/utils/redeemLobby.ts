import type { MeroJs } from '@calimero-network/mero-js';
import {
  describeInviteFailure,
  redeemInvitation,
  type RedeemOutcome,
} from '@calimero-apps/invite';

/** The two admin calls a lobby join needs, as `useMero().mero.admin` has them. */
export type LobbyAdmin = Pick<MeroJs['admin'], 'joinNamespace' | 'listNamespaces'>;

export type FailedRedeem = Extract<RedeemOutcome, { status: 'failed' }>;

/**
 * Join the lobby's namespace with a pasted invitation, and say what happened.
 *
 * The admin client directly, not mero-react's `useJoinNamespace`: that hook
 * catches a failed request and resolves `null`, so a refused join could not
 * say why. `redeemInvitation` sends the join once and settles a failed request
 * against the node's namespace list — the desktop proxy aborts at 30s while a
 * join can take far longer and land anyway, and a link pasted twice fails the
 * same way. Both are `already-member`, not a failure.
 */
export function redeemLobbyInvitation(
  admin: LobbyAdmin,
  namespaceId: string,
  invitation: unknown,
  groupName?: string,
): Promise<RedeemOutcome> {
  return redeemInvitation(
    { namespaceId, invitation },
    {
      join: async () => {
        await admin.joinNamespace(namespaceId, {
          invitation: invitation as Parameters<LobbyAdmin['joinNamespace']>[1]['invitation'],
          groupName,
        });
      },
      memberships: async () =>
        ((await admin.listNamespaces()) ?? []).map((n) => n.namespaceId),
    },
  );
}

/** What to tell the player about a failed join, in this app's noun. */
export function lobbyJoinFailureMessage(outcome: FailedRedeem): string {
  return describeInviteFailure(outcome.reason, 'lobby') ?? outcome.message;
}

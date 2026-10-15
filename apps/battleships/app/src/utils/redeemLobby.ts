import type { MeroJs } from '@calimero-network/mero-js';
import type { InviteRedeemer } from '@calimero-apps/invite';

/** The two admin calls a lobby join needs, as `useMero().mero.admin` has them. */
export type LobbyAdmin = Pick<MeroJs['admin'], 'joinNamespace' | 'listNamespaces'>;

/**
 * The two calls that join a lobby, for `useInviteRedemption`.
 *
 * The admin client directly, not mero-react's `useJoinNamespace`: that hook
 * catches a failed request and resolves `null`, so a refused join could not
 * say why. The redemption sends the join once and settles a failed request
 * against the node's namespace list — the desktop proxy aborts at 30s while a
 * join can take far longer and land anyway, and a link opened twice fails the
 * same way. Both are `already-member`, not a failure.
 *
 * `groupName` is what the joining node calls the group locally; read off the
 * invitation at the time of the join, hence a getter.
 */
export function lobbyRedeemer(
  admin: LobbyAdmin,
  groupName: () => string | undefined = () => undefined,
): InviteRedeemer {
  return {
    join: async (namespaceId, invitation) => {
      await admin.joinNamespace(namespaceId, {
        invitation: invitation as Parameters<LobbyAdmin['joinNamespace']>[1]['invitation'],
        groupName: groupName(),
      });
    },
    memberships: async () =>
      ((await admin.listNamespaces()) ?? []).map((n) => n.namespaceId),
  };
}

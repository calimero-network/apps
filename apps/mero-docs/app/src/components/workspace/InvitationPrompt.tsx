// The one way into a workspace someone invited you to: open the link they
// sent, and say yes here.
//
// Fed by mero-react's capture (primed in index.tsx), which takes the link from
// wherever it arrived - the links page appending `?invitation=…` to this app's
// URL (web, PWA, a cold desktop start), or a running desktop's `deep-link`
// event - and buffers it until something asks. Mounted above the routes, so a
// link opened on any page, including one handed to an app already open on
// /app, reaches it.
//
// It asks before joining, and only once the session can join: signed out, the
// invitation waits in the capture's store (it survives the sign-in redirect)
// and the prompt appears after sign-in.
//
// The prompt is mero-react's `InvitationDialog`: ask, join, sync, done. Its
// "Syncing…" lasts until WorkspaceLayout has the joined workspace's data, by
// the same gate that holds its "Syncing workspace from peers…" state, and
// then it closes by itself. Test ids are the contract the journeys and the
// e2e fixture drive: `invite-prompt`, `invite-accept`, `invite-decline`,
// `invite-error`.

import React, { useCallback, useRef } from 'react';
import {
  InvitationDialog,
  InvitationGate,
  usePendingInvitation,
  useInviteRedemption,
  useMero,
  type ParsedInvitation,
  type RedeemOutcome,
} from '@calimero-apps/cloud';
import { useApplicationId } from '@/hooks/useApplicationId';
import { useAppNamespaces } from '@/hooks/useAppNamespaces';
import {
  type ParsedInvite,
  isInviteExpired,
  parseInviteUrl,
  useJoinFolderByInvite,
  useJoinNamespaceByInvite,
} from '@/hooks/useNamespaceInvitation';
import { inviteFailureCopy, redeemInvite } from '@/lib/redeemInvite';
import { markNamespaceJustJoined } from '@/hooks/useDriveWorkspace';
import { rememberNamespaceName } from '@/hooks/namespaceNames';

interface Props {
  /** After a successful join (or one for a workspace already joined): take
   *  the person into what they joined. */
  onJoined: () => void;
}

interface DocsInvitation extends ParsedInvitation {
  invite: ParsedInvite;
}

const scopeOf = (invite: ParsedInvite) =>
  invite.kind === 'namespace' ? 'workspace' : 'folder';

export function InvitationPrompt({ onJoined }: Props) {
  // `admin`, not `mero.admin`: the session-aware client (apps#348). On an
  // account the raw client's `listNamespaces` is the relay's route under the
  // account's token, which lists only what the token may - the account admin
  // is built for exactly that caller.
  const { admin, isAuthenticated } = useMero();
  // ⚠️ NOT `useMero().applicationId`. The membership pre-check below lists
  // namespaces scoped by application id, and the provider's id belongs to
  // whichever app last logged in on this origin - so on a shared dev origin
  // this listed another app's namespaces and told a real member they were not
  // one. Resolve mero-docs's own id from the node, by package. See lib/appId.
  const { appId } = useApplicationId();
  const { join: joinNs } = useJoinNamespaceByInvite();
  const { join: joinGroup } = useJoinFolderByInvite();

  // The link's params are the invitation: `invitation`, `kind`, `id`, `name`.
  const parse = useCallback(
    (_token: string, params: Record<string, string>): DocsInvitation | null => {
      const invite = parseInviteUrl(new URLSearchParams(params));
      if ('error' in invite) return null;
      return {
        namespaceId: invite.targetId,
        invitation: invite.invitation,
        teamName: invite.targetName,
        invite,
      };
    },
    [],
  );

  // Read through a ref: the pre-check answers after the prompt is up, and the
  // redeem must see its latest answer, not the one it was created with.
  const isMemberRef = useRef(false);

  const redeem = useCallback(
    async ({ invite }: DocsInvitation): Promise<RedeemOutcome> => {
      if (isInviteExpired(invite.invitation)) {
        // Nothing to ask the node: it would refuse the same way.
        return {
          status: 'failed',
          namespaceId: invite.targetId,
          message: 'invitation has expired',
          reason: 'expired',
          retryable: false,
        };
      }
      if (isMemberRef.current) {
        return {
          status: 'already-member',
          namespaceId: invite.targetId,
          teamName: invite.targetName,
        };
      }
      // The name goes to the NODE, not just to this browser: `groupName` on
      // the join request is what files the creator's chosen workspace name
      // against the joiner's own governance row, so it is there for every
      // tab and every future session on this machine - and for the desktop
      // app, which shares the node and not the localStorage.
      const outcome = await redeemInvite(invite, {
        joinNamespace: joinNs,
        joinFolder: joinGroup,
        listNamespaces: async () => {
          if (!admin) throw new Error('Mero client not ready');
          return admin.listNamespaces();
        },
      });
      if (outcome.status === 'failed') {
        // This app's own words, which name a spent link or a removal; the
        // dialog shows the message as it is for an `unknown` reason. Whether
        // the invitation is kept still follows `retryable`.
        return {
          ...outcome,
          reason: 'unknown',
          message: inviteFailureCopy(outcome, scopeOf(invite)),
        };
      }
      // `joined` and `already-member` land the same way: an already-member is
      // a join the request did not see finish (the desktop proxy aborts at
      // 30s), or a link followed twice.
      if (invite.kind === 'namespace') {
        // Mirror the name into the local snapshot as well. Belt and braces for
        // the window between the join returning and the node's namespace list
        // reporting a name: `listNamespacesForApplication` omits `name` until
        // the root-group metadata has synced, which on a small cluster can lag
        // indefinitely. The snapshot is only ever read when the node has no
        // name of its own (see useNamespaceDisplayNames), so it can never
        // shadow a real rename.
        if (invite.targetName) {
          rememberNamespaceName(invite.targetId, invite.targetName);
        }
        // Flag the fresh namespace so useDriveWorkspace shows a
        // "Syncing from peers…" state while the governance op +
        // registry state propagate, rather than a raw empty view. Its
        // lifting is also what ends the dialog's "Syncing…".
        markNamespaceJustJoined(invite.targetId);
      }
      return outcome;
    },
    [admin, joinNs, joinGroup],
  );

  const redemption = useInviteRedemption({
    parse,
    redeem,
    onJoined: () => onJoined(),
    enabled: !!isAuthenticated && !!admin,
  });
  const invite = redemption.parsed?.invite ?? null;

  // Pre-check namespace invites against the user's own namespace list so
  // "already a member" is said before the click, not met as a server error.
  // Folder invites have no cheap client-side membership source; the join
  // call's error mapping covers them.
  const { namespaces } = useAppNamespaces(
    isAuthenticated && invite?.kind === 'namespace' && appId ? appId : null,
  );
  const isMember =
    invite?.kind === 'namespace' &&
    namespaces.some((n) => n.namespaceId === invite.targetId);
  isMemberRef.current = isMember;

  const scope = invite ? scopeOf(invite) : 'workspace';
  // Logged out, redemption has not read the link yet; read it for the gate.
  const waiting = usePendingInvitation();
  const waitingInvite = !invite && waiting ? parse(waiting.token, waiting.params)?.invite : null;
  const detail = !invite
    ? undefined
    : isInviteExpired(invite.invitation)
      ? 'This invitation has expired. Ask the person who invited you for a new link.'
      : isMember
        ? `You're already a member of this ${scope}.`
        : invite.kind === 'group'
          ? "You'll only gain access to this folder, not the rest of the workspace."
          : "You'll be added to the workspace.";

  return (
    <>
      {/* Logged out with a link opened: "you're invited" and the login, not the landing page. */}
      <InvitationGate parse={parse} noun={waitingInvite ? scopeOf(waitingInvite) : scope} appName="Mero Docs" />
      <InvitationDialog
        redemption={redemption}
        noun={scope}
        appName="Mero Docs"
        detail={detail}
      />
    </>
  );
}

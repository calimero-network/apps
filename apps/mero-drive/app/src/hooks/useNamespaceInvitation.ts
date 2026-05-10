// Invite creation + join, for both namespace-scoped and folder-scoped
// invites. We bypass mero-react's hooks because both wrap mero-js in
// `useAsyncMutation`, which swallows exceptions into a `null` return
// — callers can't distinguish "server rejected" from "still loading".
// Calling mero.admin directly surfaces real errors to the user.
//
// Invite URL shape:
//   /join?kind={kind}&id={targetId}&invite={base64url(JSON(SignedGroupOpenInvitation))}
//
// `kind` is either `'namespace'` or `'group'`. Namespace invites drop
// the invitee into the namespace root group; group invites add them
// to exactly the named folder subgroup. For back-compat with the
// first iteration (namespace-only), `ns=` is also accepted as an alias
// for `id=` when kind is namespace (or missing).

import { useCallback } from 'react';
import {
  useMero,
  type SignedGroupOpenInvitation,
  type CreateNamespaceInvitationResponseData,
  type CreateRecursiveInvitationResponseData,
  type CreateGroupInvitationResponseData,
  type CreateRecursiveGroupInvitationResponseData,
} from '@calimero-network/mero-react';

export type InviteKind = 'namespace' | 'group';

export interface InviteCreation {
  kind: InviteKind;
  targetId: string;
  invitation: SignedGroupOpenInvitation;
  url: string;
}

export interface ParsedInvite {
  kind: InviteKind;
  targetId: string;
  invitation: SignedGroupOpenInvitation;
}

function base64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (s.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

export function buildInviteUrl(
  origin: string,
  kind: InviteKind,
  targetId: string,
  invitation: SignedGroupOpenInvitation,
): string {
  const payload = base64urlEncode(JSON.stringify(invitation));
  return `${origin}/join?kind=${kind}&id=${targetId}&invite=${payload}`;
}

/** Parse an invite URL. Returns null-shape error if the params are
 *  missing or the payload can't be decoded. */
export function parseInviteUrl(
  params: URLSearchParams,
): ParsedInvite | { error: string } {
  const rawKind = params.get('kind');
  const id = params.get('id') ?? params.get('ns'); // `ns` for back-compat
  const raw = params.get('invite');

  // Validate kind first so the type narrowing below is sound — older
  // versions of this code chained ternaries with an unreachable IIFE
  // returning `null as never`, which type-checked but would have leaked
  // a runtime null if the validation guard was ever moved or removed.
  if (rawKind !== null && rawKind !== 'namespace' && rawKind !== 'group') {
    return { error: `Unknown invite kind: ${rawKind}` };
  }
  // Back-compat: early links had no `kind` — treat as namespace
  // (the only invite shape that existed before the param was added).
  const kind: InviteKind = rawKind === 'group' ? 'group' : 'namespace';

  if (!id) return { error: 'Missing target id in invite link.' };
  if (!raw) return { error: 'Missing invitation payload in invite link.' };

  try {
    const invitation = JSON.parse(
      base64urlDecode(raw),
    ) as SignedGroupOpenInvitation;
    return { kind, targetId: id, invitation };
  } catch {
    return {
      error:
        'Invitation payload could not be decoded. The link may be truncated or corrupted.',
    };
  }
}

export function useCreateNamespaceInvite() {
  const { mero } = useMero();

  const create = useCallback(
    async (namespaceId: string): Promise<InviteCreation> => {
      if (!mero) throw new Error('Mero client not ready');
      const response = await mero.admin.createNamespaceInvitation(
        namespaceId,
        { recursive: false },
      );
      if ('invitations' in (response as CreateRecursiveInvitationResponseData)) {
        throw new Error(
          'Unexpected recursive invitation response — asked for single',
        );
      }
      const single = response as CreateNamespaceInvitationResponseData;
      const url = buildInviteUrl(
        window.location.origin,
        'namespace',
        namespaceId,
        single.invitation,
      );
      return {
        kind: 'namespace',
        targetId: namespaceId,
        invitation: single.invitation,
        url,
      };
    },
    [mero],
  );

  return { create };
}

export function useJoinNamespaceByInvite() {
  const { mero } = useMero();

  const join = useCallback(
    async (
      namespaceId: string,
      invitation: SignedGroupOpenInvitation,
    ): Promise<string> => {
      if (!mero) throw new Error('Mero client not ready');
      const response = await mero.admin.joinNamespace(namespaceId, {
        invitation,
      });
      return response.groupId;
    },
    [mero],
  );

  return { join };
}

export function useCreateFolderInvite() {
  const { mero } = useMero();

  const create = useCallback(
    async (folderId: string): Promise<InviteCreation> => {
      if (!mero) throw new Error('Mero client not ready');
      const response = await mero.admin.createGroupInvitation(folderId, {
        recursive: false,
      });
      if (
        'invitations' in (response as CreateRecursiveGroupInvitationResponseData)
      ) {
        throw new Error(
          'Unexpected recursive invitation response — asked for single',
        );
      }
      const single = response as CreateGroupInvitationResponseData;
      const url = buildInviteUrl(
        window.location.origin,
        'group',
        folderId,
        single.invitation,
      );
      return {
        kind: 'group',
        targetId: folderId,
        invitation: single.invitation,
        url,
      };
    },
    [mero],
  );

  return { create };
}

export function useJoinFolderByInvite() {
  const { mero } = useMero();

  const join = useCallback(
    async (invitation: SignedGroupOpenInvitation): Promise<string> => {
      if (!mero) throw new Error('Mero client not ready');
      // mero-js's joinGroup uses the `group_id` carried inside the
      // signed invitation — no separate groupId path param, unlike
      // joinNamespace. The API takes only `{invitation}`.
      const response = await mero.admin.joinGroup({ invitation });
      return response.groupId;
    },
    [mero],
  );

  return { join };
}

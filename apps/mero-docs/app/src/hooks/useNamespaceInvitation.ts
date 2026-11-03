// Invitations into a workspace or one folder, on Calimero 1.0's org invites.
//
// v1 minted a signed group invitation, carried it in the link as a base64 JSON
// payload, and the joiner's node joined the namespace or the subgroup with it.
// Here an invitation is an org invite token (`client.invite`, a passkey
// step-up for the inviter): a workspace invite makes the joiner a member of
// the org, a folder invite does that and gives them a row in the folder's
// team, so they reach the folder whether or not it is Restricted. The link is
// this frontend's own URL with `?invite=<token>`; the token is redeemed after
// sign-in, once the person says yes (InvitationPrompt).

import { useCallback } from 'react';
import { useMero } from '@/calimero/react';
import { nodeUrl } from '@/lib/servedByNode';

export type InviteKind = 'namespace' | 'group';

export interface InviteCreation {
  kind: InviteKind;
  /** The workspace (org) id, or the folder (team) id. */
  targetId: string;
  token: string;
  /** The target's name, shown to the person invited. */
  name?: string;
  url: string;
}

/** A link opened with an invitation in it. */
export interface PendingInvite {
  token: string;
  kind: InviteKind;
  /** The workspace for a workspace invite, the folder for a folder invite. */
  targetId: string | null;
  /** The workspace the invite is into, when the link names it. */
  workspaceId: string | null;
  targetName?: string;
}

const PENDING_KEY = 'mero-docs:pending-invite';

/** The link that opens this frontend with `token` to redeem. */
export function buildInviteUrl(
  kind: InviteKind,
  token: string,
  ids: { workspace: string; folder?: string },
  name?: string,
): string {
  const url = new URL(nodeUrl('/'));
  url.searchParams.set('invite', token);
  url.searchParams.set('kind', kind);
  url.searchParams.set('ws', ids.workspace);
  if (ids.folder) url.searchParams.set('folder', ids.folder);
  if (name) url.searchParams.set('name', name);
  return url.toString();
}

/** The invitation in `params`, or null when there is none. */
export function parseInviteUrl(params: URLSearchParams): PendingInvite | null {
  const token = params.get('invite');
  if (!token || !token.trim()) return null;
  const kind: InviteKind = params.get('kind') === 'group' ? 'group' : 'namespace';
  const workspaceId = params.get('ws');
  const folder = params.get('folder');
  return {
    token: token.trim(),
    kind,
    targetId: kind === 'group' ? folder : workspaceId,
    workspaceId,
    targetName: params.get('name') ?? undefined,
  };
}

/**
 * Takes an invitation off the address bar into storage before anything
 * renders: a person opening a link is usually not signed in yet, and the
 * token has to survive the passkey sign-in.
 */
export function captureInvite(storage: Storage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const invite = parseInviteUrl(url.searchParams);
  if (!invite) return;
  try {
    storage.setItem(PENDING_KEY, JSON.stringify(invite));
  } catch {
    return;
  }
  for (const key of ['invite', 'kind', 'ws', 'folder', 'name']) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', url.toString());
}

export function pendingInvite(storage: Storage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof parsed.token !== 'string' || !parsed.token) return null;
    return {
      token: parsed.token,
      kind: parsed.kind === 'group' ? 'group' : 'namespace',
      targetId: typeof parsed.targetId === 'string' ? parsed.targetId : null,
      workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : null,
      targetName: typeof parsed.targetName === 'string' ? parsed.targetName : undefined,
    };
  } catch {
    return null;
  }
}

export function dropInvite(storage: Storage = localStorage): void {
  try {
    storage.removeItem(PENDING_KEY);
  } catch {
    /* nothing stored */
  }
}

/** A workspace invitation link (an org invite, as a member). */
export function useCreateNamespaceInvite() {
  const { admin } = useMero();
  const create = useCallback(
    async (namespaceId: string, name?: string): Promise<InviteCreation> => {
      if (!admin) throw new Error('Not signed in');
      const token = await admin.createNamespaceInvitation(namespaceId);
      return {
        kind: 'namespace',
        targetId: namespaceId,
        token,
        name,
        url: buildInviteUrl('namespace', token, { workspace: namespaceId }, name),
      };
    },
    [admin],
  );
  return { create };
}

/** A folder invitation link (an org invite naming the folder's team). */
export function useCreateFolderInvite() {
  const { admin } = useMero();
  const create = useCallback(
    async (folderId: string, name?: string): Promise<InviteCreation> => {
      if (!admin) throw new Error('Not signed in');
      const { token, namespaceId } = await admin.createGroupInvitation(folderId);
      return {
        kind: 'group',
        targetId: folderId,
        token,
        name,
        url: buildInviteUrl('group', token, { workspace: namespaceId, folder: folderId }, name),
      };
    },
    [admin],
  );
  return { create };
}

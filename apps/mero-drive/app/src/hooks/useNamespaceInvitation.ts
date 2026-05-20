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
  /** Namespace display name carried on the invite URL (`&name=`).
   *  Present for namespace invites minted after this field was added;
   *  the join flow persists it via `rememberNamespaceName`. */
  namespaceName?: string;
}

// UTF-8-safe base64url codec. Earlier versions used
// `btoa(unescape(encodeURIComponent(s)))`, which relies on the
// deprecated `unescape` and throws `InvalidCharacterError` from
// `btoa` if the JSON payload contains non-Latin1 characters (e.g.
// emoji or non-ASCII text in invitation metadata). We route bytes
// through `TextEncoder`/`TextDecoder` so the codec is UTF-8 across
// the full code-point range.
function base64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function buildInviteUrl(
  origin: string,
  kind: InviteKind,
  targetId: string,
  invitation: SignedGroupOpenInvitation,
  // Namespace display name — resolved by core's
  // `createNamespaceInvitation` as `groupName`. Carried on the URL so
  // the joiner can show the real name immediately:
  // `listNamespacesForApplication` won't surface it until the joined
  // node has synced the namespace's root-group metadata.
  name?: string,
): string {
  const payload = base64urlEncode(JSON.stringify(invitation));
  let url = `${origin}/join?kind=${kind}&id=${targetId}&invite=${payload}`;
  if (name) url += `&name=${encodeURIComponent(name)}`;
  return url;
}

/** Pull invite params out of free-form user input. Accepts a full URL
 *  from any host (so links copied from older/staging deployments still
 *  work), a bare query string with or without the leading `?`, and
 *  tolerates surrounding whitespace. Returns `null` when no usable
 *  `invite=` param is present — the caller should treat that as
 *  "input doesn't contain an invite" and prompt the user. The returned
 *  `URLSearchParams` is suitable for direct hand-off to
 *  `parseInviteUrl`. */
export function extractInviteParams(input: string): URLSearchParams | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Path 1: full URL — works for any host, any path. The dialog's
  // primary input. We intentionally don't restrict the host so links
  // copied from the localhost dev server or a previous Vercel preview
  // domain still parse.
  try {
    const url = new URL(trimmed);
    if (url.searchParams.has('invite')) return url.searchParams;
  } catch {
    /* not a URL — fall through to bare-query handling */
  }

  // Path 2: bare query string. Covers users who copied only the
  // `?kind=…&id=…&invite=…` tail of a link.
  const queryOnly = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed;
  if (queryOnly.includes('invite=')) {
    const params = new URLSearchParams(queryOnly);
    if (params.has('invite')) return params;
  }

  return null;
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

  const name = params.get('name');
  try {
    const invitation = JSON.parse(
      base64urlDecode(raw),
    ) as SignedGroupOpenInvitation;
    return {
      kind,
      targetId: id,
      invitation,
      namespaceName: name ?? undefined,
    };
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
        // core resolves the namespace's metadata name here; carrying it
        // on the URL lets the joiner display it without waiting for a
        // metadata sync that may never converge on a small cluster.
        single.groupName,
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

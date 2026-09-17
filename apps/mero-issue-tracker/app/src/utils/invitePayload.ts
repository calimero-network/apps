/**
 * The invitation PAYLOAD — what travels inside the link, as opposed to how it is
 * compressed and wrapped (`utils/invitation.ts`).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The app used to share whatever `createNamespaceInvitation(ns, {recursive:true})
 * returned, `JSON.stringify`d verbatim. Three things were wrong with that:
 *
 *   1. **The workspace name never travelled.** `useWorkspace.join` read
 *      `parsed.invitations[0].groupAlias`, but the recursive entry's field is
 *      spelled `groupName` on the wire (`RecursiveInvitationEntry`), so the value
 *      was `undefined` every single time. `joinNamespace(ns, {groupName})` then
 *      recorded no name, and the joiner's sidebar showed a truncated hex id
 *      forever while the creator saw "Platform team".
 *   2. **The single-invitation shape could not be read at all.** The fallback
 *      branch looked for `parsed.invitation.groupId`; the signed body spells it
 *      `group_id` and it is a BYTE ARRAY, not a string. So a non-recursive
 *      invitation — the shape every other mero app emits — failed with
 *      "cannot determine namespace".
 *   3. **It was not the ecosystem's shape.** mero-stream, mero-meet and
 *      mero-chat all encode `{invitation, groupAlias, groupId, kind}`. A code
 *      minted here could not be pasted there, and vice versa, even though both
 *      sides used base58(deflate(JSON)).
 *
 * So: one payload type, built on the way out and parsed on the way in, matching
 * mero-stream's `StreamInvitePayload` field for field for the fields we use.
 *
 * Pure functions — no network, no storage — so the tests exercise the real thing.
 */

/** admin-api `SignedGroupOpenInvitation`. Field spelling varies across nodes. */
export interface SignedInvitation {
  invitation: Record<string, unknown>;
  inviter_signature?: string;
  inviterSignature?: string;
}

/**
 * The shared wire payload. Deliberately the same keys mero-stream/mero-meet use:
 * `groupAlias` is the namespace's display name and `kind` names the join route.
 *
 * Only `invitation` is signed. `groupAlias` and `groupId` are a label and a
 * routing hint, so the join path re-reads the group id out of the signed body
 * (see {@link groupIdOfInvite}) rather than trusting the wrapper.
 */
export interface WorkspaceInvitePayload {
  invitation: SignedInvitation;
  /** The workspace (namespace) name the creator typed. */
  groupAlias?: string;
  /** Unsigned hint; the signed body is authoritative. */
  groupId?: string;
  /** Always "namespace" here — this app invites to a workspace, not a subgroup. */
  kind?: 'namespace';
}

export function isSignedInvitation(v: unknown): v is SignedInvitation {
  if (!v || typeof v !== 'object') return false;
  const t = v as SignedInvitation;
  return (
    (typeof t.inviter_signature === 'string' || typeof t.inviterSignature === 'string') &&
    !!t.invitation &&
    typeof t.invitation === 'object'
  );
}

function hex(bytes: readonly number[]): string {
  return bytes.map((b) => Number(b).toString(16).padStart(2, '0')).join('');
}

/**
 * The namespace this invitation actually grants, read out of the SIGNED body.
 *
 * Both spellings are tolerated (`group_id` is what current nodes send; `groupId`
 * appears on some builds) and a byte array is hex-encoded, which is the form
 * every admin route takes as a path segment.
 *
 * Returns "" when the body names no group — the caller reports that rather than
 * joining something it guessed at.
 */
export function groupIdOfInvite(payload: WorkspaceInvitePayload | SignedInvitation): string {
  const signed = isSignedInvitation((payload as WorkspaceInvitePayload).invitation)
    ? (payload as WorkspaceInvitePayload).invitation
    : (payload as SignedInvitation);
  const body = signed?.invitation as Record<string, unknown> | undefined;
  const raw = body?.group_id ?? body?.groupId;
  if (Array.isArray(raw)) return hex(raw as number[]);
  return typeof raw === 'string' ? raw : '';
}

/**
 * Wrap whatever `createNamespaceInvitation` returned into the shared payload,
 * attaching the workspace name so the joiner's node can record it.
 *
 * Handles both response shapes: `{invitation, groupName?}` (the default) and
 * `{invitations: [{groupId, invitation, groupName?}]}` (`recursive: true`). For
 * the recursive one the FIRST entry is the outermost group — the namespace —
 * which is the only one this app grants.
 *
 * Returns null when the node answered without a signature, so the caller can say
 * so instead of minting a link that cannot be redeemed.
 */
export function buildInvitePayload(
  response: unknown,
  opts: { namespaceId?: string | null; namespaceName?: string | null } = {},
): WorkspaceInvitePayload | null {
  const root = (response as { data?: unknown })?.data ?? response;
  if (!root || typeof root !== 'object') return null;

  const container = root as {
    invitation?: unknown;
    invitations?: unknown;
    groupName?: unknown;
    groupAlias?: unknown;
  };

  let signed: SignedInvitation | null = null;
  let groupId = opts.namespaceId?.trim() || undefined;
  let alias =
    (typeof container.groupName === 'string' && container.groupName.trim()) ||
    (typeof container.groupAlias === 'string' && container.groupAlias.trim()) ||
    undefined;

  if (Array.isArray(container.invitations) && container.invitations.length > 0) {
    const first = container.invitations[0] as {
      groupId?: unknown;
      invitation?: unknown;
      groupName?: unknown;
      groupAlias?: unknown;
    };
    if (isSignedInvitation(first?.invitation)) signed = first.invitation;
    if (typeof first?.groupId === 'string' && first.groupId) groupId = first.groupId;
    alias =
      (typeof first?.groupName === 'string' && first.groupName.trim()) ||
      (typeof first?.groupAlias === 'string' && first.groupAlias.trim()) ||
      alias;
  } else if (isSignedInvitation(container.invitation)) {
    signed = container.invitation;
  } else if (isSignedInvitation(root)) {
    signed = root as SignedInvitation;
  }

  if (!signed) return null;

  // The caller's name wins: it is the name this node has for the workspace right
  // now, where the node's echoed `groupName` is whatever it happened to store.
  const name = opts.namespaceName?.trim() || alias;

  return {
    invitation: signed,
    kind: 'namespace',
    groupId: groupIdOfInvite(signed) || groupId,
    ...(name ? { groupAlias: name } : {}),
  };
}

/**
 * Parse a decoded invitation back to the payload, accepting every shape that has
 * ever been in circulation:
 *
 *   - `{invitation, groupAlias|groupName, groupId, kind}` — the shared shape,
 *     which is also what mero-stream, mero-meet and mero-chat mint;
 *   - `{invitations: [...]}` — this app's own pre-fix recursive codes;
 *   - a bare `SignedGroupOpenInvitation` — an admin-api response pasted raw;
 *   - any of the above inside a `{data: …}` envelope.
 *
 * Returns null rather than throwing: the input is a pasted string and every
 * caller wants "that code is not valid", not an exception.
 */
export function parseInvitePayload(decoded: unknown): WorkspaceInvitePayload | null {
  const root = (decoded as { data?: unknown })?.data ?? decoded;
  if (!root || typeof root !== 'object') return null;

  const container = root as {
    invitation?: unknown;
    invitations?: unknown;
    groupAlias?: unknown;
    groupName?: unknown;
    groupId?: unknown;
  };

  if (Array.isArray(container.invitations)) {
    const built = buildInvitePayload(root);
    return built;
  }

  if (isSignedInvitation(container.invitation)) {
    const alias =
      (typeof container.groupAlias === 'string' && container.groupAlias.trim()) ||
      (typeof container.groupName === 'string' && container.groupName.trim()) ||
      undefined;
    const signed = container.invitation;
    return {
      invitation: signed,
      kind: 'namespace',
      groupId:
        groupIdOfInvite(signed) ||
        (typeof container.groupId === 'string' ? container.groupId : undefined),
      ...(alias ? { groupAlias: alias } : {}),
    };
  }

  if (isSignedInvitation(root)) {
    const signed = root as SignedInvitation;
    return { invitation: signed, kind: 'namespace', groupId: groupIdOfInvite(signed) };
  }

  return null;
}

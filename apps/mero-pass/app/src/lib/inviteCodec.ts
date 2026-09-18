// Invitation codec — the SAME wire format mero-chat (curb), mero-blocks,
// mero-stream and mero-meet use, so a code minted by any of them is shaped
// identically: the JSON payload is deflate-compressed and base58-encoded into
// one compact pasteable string.
//
// Why compress at all: a `SignedGroupOpenInvitation` is a few hundred bytes of
// JSON with a signature and a byte-array group id. Raw, it is unusable as
// something a person pastes into a chat window; deflate+base58 gets it to a
// single line with no characters that break on copy (no `+`, `/`, `=`, quotes
// or whiteteam).
//
// Base58 rather than base64 for exactly that reason — base64's `+/=` get mangled
// by URL encoders, chat clients and shell quoting, which is precisely where
// invite codes travel.
//
// ⚠️ WHAT IS NOT IN HERE, AND MUST NEVER BE. This app holds passwords. An
// invitation carries a signed grant of NAMESPACE MEMBERSHIP and some unsigned
// routing hints, and that is the whole of it. No secret, no vault contents, no
// derived key material — nothing that would still be sensitive after the link
// has been forwarded, screenshotted or pasted into a bug report. The payload
// below is deliberately small enough to audit at a glance for that reason.
//
// Pure functions, no session or network access, so both the app and any test
// can import them.

import bs58 from 'bs58';
import { deflateSync, inflateSync } from 'fflate';

/** admin-api `SignedGroupOpenInvitation`. Field spelling varies across nodes. */
export interface SignedInvitation {
  invitation: Record<string, unknown>;
  inviterSignature?: string;
  inviter_signature?: string;
}

/**
 * What the invitation in `invitation` actually grants, and therefore which join
 * endpoint accepts it. `joinNamespace` and `joinGroup` are different routes and
 * a signed invitation is only valid on the one matching its scope, so guessing
 * costs a round-trip and a confusing 4xx.
 */
export type InviteKind = 'namespace' | 'vault';

/** One link in a recursive invitation: an invitation to ONE group in the chain. */
export interface InviteChainEntry {
  groupId: string;
  invitation: SignedInvitation;
  groupName?: string;
  /** Namespace root vs subgroup — decides joinNamespace vs joinGroup. */
  kind: InviteKind;
}

export interface PassInvitePayload {
  invitation: SignedInvitation;
  /** Team name. curb calls this groupAlias; kept for cross-app compatibility. */
  groupAlias?: string;
  /** Optional: jump straight into this vault's context after joining. */
  contextId?: string;
  /** The group `invitation` grants — normally the namespace. */
  groupId?: string;
  /**
   * What this code is FOR: land the joiner in the team, or in one vault of it.
   *
   * Note this describes the destination, not the grant. A vault code still
   * grants the NAMESPACE (see `mintVaultInvite`), because vault access is
   * inherited from it.
   */
  kind?: InviteKind;
  /**
   * The vault (subgroup) to open after joining. A ROUTING HINT and nothing more
   * — it is outside the signature, so it cannot grant anything. Entering the
   * vault still requires the node to admit us, which it only does for a member
   * of the parent team.
   */
  vaultId?: string;
  /** Display name of the vault, when this is a vault invite. */
  vaultName?: string;
  /**
   * A VAULT invite for someone who is not in the team yet needs BOTH joins: a
   * subgroup invitation alone is not enough, because membership is inherited
   * from the parent. Core can mint the whole chain in one call
   * (`createNamespaceInvitation(id, {recursive: true})`), and this carries it —
   * outermost (namespace) FIRST, so a joiner can walk it in order.
   *
   * Absent for a plain team invite, and absent when the recursive mint is
   * unavailable, in which case `invitation` alone is all there is.
   */
  chain?: InviteChainEntry[];
}

function isSignedInvitation(v: unknown): v is SignedInvitation {
  if (!v || typeof v !== 'object') return false;
  const t = v as SignedInvitation;
  return (
    (typeof t.inviterSignature === 'string' ||
      typeof t.inviter_signature === 'string') &&
    !!t.invitation &&
    typeof t.invitation === 'object'
  );
}

/**
 * Validate a pasted `chain` entry by entry, dropping anything malformed rather
 * than rejecting the whole code: an unusable chain still leaves `invitation`,
 * which is enough for a joiner who is already a team member.
 */
function parseChain(raw: unknown): InviteChainEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: InviteChainEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const entry = e as Partial<InviteChainEntry>;
    if (typeof entry.groupId !== 'string' || !entry.groupId) continue;
    if (!isSignedInvitation(entry.invitation)) continue;
    out.push({
      groupId: entry.groupId,
      invitation: entry.invitation,
      groupName:
        typeof entry.groupName === 'string' ? entry.groupName : undefined,
      // Anything not explicitly the namespace root is joined as a subgroup. The
      // safer default: joinGroup on a namespace root fails loudly, whereas
      // joinNamespace on a subgroup can appear to succeed against the parent
      // and leave the joiner outside the vault they were invited to.
      kind: entry.kind === 'namespace' ? 'namespace' : 'vault',
    });
  }
  return out.length > 0 ? out : undefined;
}

function parsePayload(json: string): PassInvitePayload | null {
  try {
    const parsed = JSON.parse(json);
    // Tolerate an admin-api envelope (`{data: …}`) being pasted verbatim.
    const inner = parsed?.data ?? parsed;
    if (!inner || typeof inner !== 'object') return null;

    if (isSignedInvitation((inner as PassInvitePayload).invitation)) {
      const p = inner as Omit<PassInvitePayload, 'kind'> & {
        groupName?: string;
        /**
         * `kind` is read as a bare string, not as `InviteKind`: this is
         * PARSED input, and the sibling apps' spelling (`"room"`) is a value
         * the union deliberately does not contain.
         */
        kind?: string;
        /** mero-stream and mero-meet spell the sub-destination `room*`. */
        roomId?: string;
        roomName?: string;
      };
      return {
        invitation: p.invitation,
        groupAlias:
          typeof p.groupName === 'string' ? p.groupName : p.groupAlias,
        contextId: typeof p.contextId === 'string' ? p.contextId : undefined,
        groupId: typeof p.groupId === 'string' ? p.groupId : undefined,
        kind:
          p.kind === 'vault' || p.kind === 'room'
            ? 'vault'
            : p.kind === 'namespace'
              ? 'namespace'
              : undefined,
        // Read the sibling apps' spelling too. A code minted by mero-stream is
        // a valid namespace grant here; honouring its `roomId` costs one `??`
        // and means a cross-app code lands on the right subgroup instead of
        // dumping the joiner at the top of a team.
        vaultId:
          typeof p.vaultId === 'string'
            ? p.vaultId
            : typeof p.roomId === 'string'
              ? p.roomId
              : undefined,
        vaultName:
          typeof p.vaultName === 'string'
            ? p.vaultName
            : typeof p.roomName === 'string'
              ? p.roomName
              : undefined,
        chain: parseChain(p.chain),
      };
    }
    // Bare `SignedGroupOpenInvitation` — what the admin API returns directly.
    if (isSignedInvitation(inner)) return { invitation: inner };
    return null;
  } catch {
    return null;
  }
}

/** Compress + base58-encode the payload into the shareable invite code. */
export function encodeInvite(payload: PassInvitePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return bs58.encode(deflateSync(bytes, { level: 9 }));
}

/**
 * Decode pasted input. Accepts, in order of preference:
 *   - base58(deflate(JSON))  — what `encodeInvite` produces
 *   - base58(JSON)           — uncompressed, for curb-era codes
 *   - raw JSON               — for debugging and for pasting an API response
 *
 * Returns null rather than throwing: this is user input, and every caller wants
 * "that code is not valid" rather than an exception.
 */
export function decodeInvite(input: string): PassInvitePayload | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return parsePayload(trimmed);
  try {
    const bytes = bs58.decode(trimmed);
    let json: string;
    try {
      json = new TextDecoder().decode(inflateSync(bytes));
    } catch {
      json = new TextDecoder().decode(bytes); // uncompressed legacy form
    }
    return parsePayload(json);
  } catch {
    return null;
  }
}

/**
 * The group to join, read out of the SIGNED invitation itself rather than
 * carried alongside it — so a tampered wrapper cannot redirect a join.
 *
 * "Group" is deliberately generic here: for a team invite this is the
 * namespace, for a vault invite it is the vault's subgroup. Same field either
 * way, because a namespace IS a group in core.
 *
 * The group id is a byte array on current nodes and already a string on some
 * versions; hex-encode the former. Both key spellings are tolerated.
 */
export function groupIdOfInvite(
  invitation: SignedInvitation | PassInvitePayload,
): string {
  const signed = (
    'invitation' in invitation &&
    isSignedInvitation((invitation as PassInvitePayload).invitation)
      ? (invitation as PassInvitePayload).invitation
      : (invitation as SignedInvitation)
  ).invitation as Record<string, unknown>;
  const raw = signed?.groupId ?? signed?.group_id;
  if (Array.isArray(raw)) {
    return (raw as number[])
      .map((b) => Number(b).toString(16).padStart(2, '0'))
      .join('');
  }
  return typeof raw === 'string' ? raw : '';
}

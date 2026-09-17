// Namespace-invite codec — the SAME wire format mero-chat (curb), mero-blocks
// and mero-stream use, so a code minted by any of them is shaped identically:
// the JSON payload is deflate-compressed and base58-encoded into one compact
// pasteable string.
//
// ── What this replaced ──────────────────────────────────────────────────────
//
// The deleted `utils/invitation.ts` encoded the invitation as base64 of raw
// JSON. Two things were wrong with it. First, base64's `+`, `/` and `=` are
// exactly the characters
// URL encoders, chat clients and shell quoting mangle — and an invite code's
// whole life is being pasted through those. Second, it was mero-sheets' own
// private format: a code from mero-chat or mero-blocks could not be read here,
// and a code from here could not be read there, for no reason other than that
// nobody had picked the same one.
//
// Why compress at all: a `SignedGroupOpenInvitation` is a few hundred bytes of
// JSON with a signature and a byte-array group id. Raw, it is unusable as
// something a person pastes anywhere; deflate+base58 gets it to a single line
// with no characters that break on copy.
//
// Pure functions, no session or network access, so both the app and its tests
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
 * a signed invitation is only valid on the one matching its scope.
 *
 * mero-sheets only ever mints `"namespace"`: its spreadsheets are contexts bound
 * directly to the namespace root, not subgroups, so there is no second group to
 * invite anyone to. `"room"` is understood on the way IN so a code pasted from
 * mero-stream still decodes rather than looking corrupt.
 */
export type InviteKind = 'namespace' | 'room';

/** One link in a recursive invitation: an invitation to ONE group in the chain. */
export interface InviteChainEntry {
  groupId: string;
  invitation: SignedInvitation;
  groupName?: string;
  /** Namespace root vs subgroup — decides joinNamespace vs joinGroup. */
  kind: InviteKind;
}

export interface SheetsInvitePayload {
  invitation: SignedInvitation;
  /** Namespace name. curb calls this `groupAlias`; kept for cross-app compatibility. */
  groupAlias?: string;
  /**
   * The spreadsheet to open after joining. A ROUTING HINT and nothing more — it
   * sits outside the signature, so it cannot grant anything. Entering the
   * context still requires the node to admit us, which it only does for a member
   * of the namespace the signed invitation just made us.
   */
  contextId?: string;
  /** The group `invitation` grants — for this app, always the namespace. */
  groupId?: string;
  /** Absent on pre-`kind` codes ⇒ "namespace". */
  kind?: InviteKind;
  /** Display name of the spreadsheet this code opens, when it names one. */
  projectName?: string;
  /**
   * A recursive chain, outermost FIRST. Never minted here (there is no subgroup
   * to chain to) but understood, so a code from an app that does mint one walks
   * correctly instead of joining only its outermost group.
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
 * which is enough for a joiner who is already a namespace member.
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
      // Anything not explicitly the namespace root is joined as a subgroup: a
      // joinGroup on a namespace root fails loudly, whereas a joinNamespace on a
      // subgroup can appear to succeed against the parent and leave the joiner
      // outside what they were invited to.
      kind: entry.kind === 'namespace' ? 'namespace' : 'room',
    });
  }
  return out.length > 0 ? out : undefined;
}

function parsePayload(json: string): SheetsInvitePayload | null {
  try {
    const parsed = JSON.parse(json);
    // Tolerate an admin-api envelope (`{data: …}`) being pasted verbatim.
    const inner = parsed?.data ?? parsed;
    if (!inner || typeof inner !== 'object') return null;

    // The shape mero-sheets used to emit: `createNamespaceInvitation(ns,
    // {recursive: true})` answers `{invitations: [{groupId, invitation,
    // groupAlias}]}` and the old codec base64'd that whole object. Read as a
    // chain so an invite code already sent to somebody still works.
    const recursive = (inner as { invitations?: unknown }).invitations;
    if (Array.isArray(recursive)) {
      const chain = parseChain(
        recursive.map((e) => ({
          ...(e as object),
          // The old shape had no `kind`; its first entry IS the namespace.
          kind: 'namespace',
          groupName: (e as { groupAlias?: string })?.groupAlias,
        })),
      );
      const head = chain?.[0];
      if (head) {
        return {
          invitation: head.invitation,
          kind: 'namespace',
          groupId: head.groupId,
          groupAlias: head.groupName,
          chain: chain.length > 1 ? chain : undefined,
        };
      }
      return null;
    }

    // Wrapped form: {invitation, groupAlias?, contextId?, groupId?, kind?, …}
    if (isSignedInvitation((inner as SheetsInvitePayload).invitation)) {
      const p = inner as SheetsInvitePayload & {
        groupName?: string;
        /** mero-stream's spelling for "the thing this code opens". */
        roomName?: string;
      };
      return {
        invitation: p.invitation,
        groupAlias:
          typeof p.groupName === 'string' ? p.groupName : p.groupAlias,
        contextId: typeof p.contextId === 'string' ? p.contextId : undefined,
        groupId: typeof p.groupId === 'string' ? p.groupId : undefined,
        kind:
          p.kind === 'room'
            ? 'room'
            : p.kind === 'namespace'
              ? 'namespace'
              : undefined,
        projectName:
          typeof p.projectName === 'string'
            ? p.projectName
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

/**
 * Compress + base58-encode the payload into the shareable invite code.
 *
 * `roomName` is written ALONGSIDE `projectName`, carrying the same value: it is
 * the spelling mero-stream reads, and emitting both costs a dozen bytes and
 * keeps a sheets code legible to the other apps.
 */
export function encodeInvite(payload: SheetsInvitePayload): string {
  const wire = payload.projectName
    ? { ...payload, roomName: payload.projectName }
    : payload;
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  return bs58.encode(deflateSync(bytes, { level: 9 }));
}

/**
 * Decode pasted input. Accepts, in order of preference:
 *   - base58(deflate(JSON))  — what `encodeInvite` produces
 *   - base58(JSON)           — uncompressed, for curb-era codes
 *   - base64(JSON)           — what mero-sheets itself emitted before this
 *   - raw JSON               — for debugging and for pasting an API response
 *
 * Returns null rather than throwing: this is user input, and every caller wants
 * "that code is not valid" rather than an exception.
 */
export function decodeInvite(input: string): SheetsInvitePayload | null {
  const trimmed = input.trim().replace(/\s+/g, '');
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return parsePayload(input.trim());

  try {
    const bytes = bs58.decode(trimmed);
    let json: string;
    try {
      json = new TextDecoder().decode(inflateSync(bytes));
    } catch {
      json = new TextDecoder().decode(bytes); // uncompressed legacy form
    }
    const parsed = parsePayload(json);
    if (parsed) return parsed;
  } catch {
    // Not base58 at all — `+`, `/` and `=` are outside its alphabet, which is
    // precisely how an old base64 code lands here.
  }
  return decodeLegacyBase64(trimmed);
}

/**
 * The format this app shipped before adopting the shared one: base64 of raw
 * JSON. Read, never written. Anyone already holding one of those codes should
 * not have it stop working because we changed our minds about the encoding.
 */
function decodeLegacyBase64(code: string): SheetsInvitePayload | null {
  try {
    const bin = atob(code);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return parsePayload(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * The group to join, read out of the SIGNED invitation itself rather than
 * carried alongside it — so a tampered wrapper cannot redirect a join somewhere
 * else.
 *
 * The group id is a byte array on current nodes and already a string on some
 * versions; hex-encode the former. Both key spellings are tolerated.
 */
export function namespaceIdOfInvite(
  invitation: SignedInvitation | SheetsInvitePayload,
): string {
  const signed = (
    'invitation' in invitation &&
    isSignedInvitation((invitation as SheetsInvitePayload).invitation)
      ? (invitation as SheetsInvitePayload).invitation
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

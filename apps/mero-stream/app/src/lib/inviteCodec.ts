// Namespace-invite codec — the SAME wire format mero-chat (curb) and mero-blocks
// use, so a code minted by any of them is shaped identically: the JSON payload is
// deflate-compressed and base58-encoded into one compact pasteable string.
//
// Why compress at all: a `SignedGroupOpenInvitation` is a few hundred bytes of JSON
// with a signature and a byte-array group id. Raw, it is unusable as something a
// person pastes into a chat window; deflate+base58 gets it to a single line with no
// characters that break on copy (no `+`, `/`, `=`, quotes or whitespace).
//
// Base58 rather than base64 for exactly that reason — base64's `+/=` get mangled by
// URL encoders, chat clients and shell quoting, which is precisely where invite
// codes travel.
//
// Pure functions, no session or network access, so both the app and the e2e suite
// can import them.

import bs58 from "bs58";
import { deflateSync, inflateSync } from "fflate";

/** admin-api `SignedGroupOpenInvitation`. Field spelling varies across nodes. */
export interface SignedInvitation {
  invitation: Record<string, unknown>;
  inviterSignature?: string;
  inviter_signature?: string;
}

/**
 * What the invitation in `invitation` actually grants, and therefore which join
 * endpoint accepts it. `joinNamespace` and `joinGroup` are different routes and a
 * signed invitation is only valid on the one matching its scope, so guessing costs
 * a round-trip and a confusing 4xx.
 *
 * Absent on codes minted before rooms existed — treat that as "namespace".
 */
export type InviteKind = "namespace" | "room";

/** One link in a recursive invitation: an invitation to ONE group in the chain. */
export interface InviteChainEntry {
  groupId: string;
  invitation: SignedInvitation;
  groupName?: string;
  /** Namespace root vs subgroup — decides joinNamespace vs joinGroup. */
  kind: InviteKind;
}

export interface StreamInvitePayload {
  invitation: SignedInvitation;
  /** Namespace name. curb calls this groupAlias; kept for cross-app compatibility. */
  groupAlias?: string;
  /** Optional: jump straight into this room's context after joining. */
  contextId?: string;
  /** The group `invitation` grants — normally the namespace. */
  groupId?: string;
  /**
   * What this code is FOR: land the joiner in the namespace, or in one room of it.
   * Absent on pre-rooms codes ⇒ "namespace".
   *
   * Note this describes the destination, not the grant. On current nodes a room
   * code still grants the NAMESPACE (see `mintRoomInvite`), because room access is
   * inherited from it.
   */
  kind?: InviteKind;
  /**
   * The room (subgroup) to open after joining. A ROUTING HINT and nothing more —
   * it is outside the signature, so it cannot grant anything. Entering the room
   * still requires the node to admit us, which it only does for a member of the
   * parent namespace.
   */
  roomId?: string;
  /** Display name of the room, when this is a room invite. */
  roomName?: string;
  /**
   * A ROOM invite for someone who is not in the namespace yet needs BOTH joins:
   * a subgroup invitation alone is not enough, because membership is inherited
   * from the parent. Core mints the whole chain in one call
   * (`createGroupInvitation(id, {recursive: true})`), and this carries it —
   * outermost (namespace) FIRST, so a joiner can walk it in order.
   *
   * Absent for a plain namespace invite, and absent when the recursive mint is
   * unavailable, in which case `invitation` alone is all there is.
   */
  chain?: InviteChainEntry[];
}

function isSignedInvitation(v: unknown): v is SignedInvitation {
  if (!v || typeof v !== "object") return false;
  const t = v as SignedInvitation;
  return (
    (typeof t.inviterSignature === "string" ||
      typeof t.inviter_signature === "string") &&
    !!t.invitation &&
    typeof t.invitation === "object"
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
    if (!e || typeof e !== "object") continue;
    const entry = e as Partial<InviteChainEntry>;
    if (typeof entry.groupId !== "string" || !entry.groupId) continue;
    if (!isSignedInvitation(entry.invitation)) continue;
    out.push({
      groupId: entry.groupId,
      invitation: entry.invitation,
      groupName:
        typeof entry.groupName === "string" ? entry.groupName : undefined,
      // Anything not explicitly the namespace root is joined as a subgroup. The
      // safer default: joinGroup on a namespace root fails loudly, whereas
      // joinNamespace on a subgroup can appear to succeed against the parent and
      // leave the joiner outside the room they were invited to.
      kind: entry.kind === "namespace" ? "namespace" : "room",
    });
  }
  return out.length > 0 ? out : undefined;
}

function parsePayload(json: string): StreamInvitePayload | null {
  try {
    const parsed = JSON.parse(json);
    // Tolerate an admin-api envelope (`{data: …}`) being pasted verbatim.
    const inner = parsed?.data ?? parsed;
    if (!inner || typeof inner !== "object") return null;

    // Wrapped form: {invitation, groupAlias?, contextId?, groupId?, kind?, chain?}
    if (isSignedInvitation((inner as StreamInvitePayload).invitation)) {
      const p = inner as StreamInvitePayload & { groupName?: string };
      return {
        invitation: p.invitation,
        groupAlias:
          typeof p.groupName === "string" ? p.groupName : p.groupAlias,
        contextId: typeof p.contextId === "string" ? p.contextId : undefined,
        groupId: typeof p.groupId === "string" ? p.groupId : undefined,
        kind:
          p.kind === "room"
            ? "room"
            : p.kind === "namespace"
              ? "namespace"
              : undefined,
        roomId: typeof p.roomId === "string" ? p.roomId : undefined,
        roomName: typeof p.roomName === "string" ? p.roomName : undefined,
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
export function encodeInvite(payload: StreamInvitePayload): string {
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
export function decodeInvite(input: string): StreamInvitePayload | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return parsePayload(trimmed);
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
 * The group to join, read out of the SIGNED invitation itself rather than carried
 * alongside it — so a tampered wrapper cannot redirect a join.
 *
 * "Group" is deliberately generic here: for a namespace invite this is the
 * namespace, for a room invite it is the room's subgroup. Same field either way,
 * because a namespace IS a group in core.
 *
 * The group id is a byte array on current nodes and already a string on some
 * versions; hex-encode the former. Both key spellings are tolerated.
 */
export function groupIdOfInvite(
  invitation: SignedInvitation | StreamInvitePayload,
): string {
  const signed = (
    "invitation" in invitation &&
    isSignedInvitation((invitation as StreamInvitePayload).invitation)
      ? (invitation as StreamInvitePayload).invitation
      : (invitation as SignedInvitation)
  ).invitation as Record<string, unknown>;
  const raw = signed?.groupId ?? signed?.group_id;
  if (Array.isArray(raw)) {
    return (raw as number[])
      .map((b) => Number(b).toString(16).padStart(2, "0"))
      .join("");
  }
  return typeof raw === "string" ? raw : "";
}

/**
 * Back-compat name for {@link groupIdOfInvite}. Kept because "namespace" is what
 * this returns for the namespace invites that were the only kind at first, and
 * the name reads correctly at those call sites.
 */
export const namespaceIdOfInvite = groupIdOfInvite;

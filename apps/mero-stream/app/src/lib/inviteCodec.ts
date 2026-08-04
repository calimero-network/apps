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

export interface StreamInvitePayload {
  invitation: SignedInvitation;
  /** Namespace name. curb calls this groupAlias; kept for cross-app compatibility. */
  groupAlias?: string;
  /** Optional: jump straight into this room's context after joining. */
  contextId?: string;
  /** Optional: the room (subgroup) the inviter wants you in. */
  groupId?: string;
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

function parsePayload(json: string): StreamInvitePayload | null {
  try {
    const parsed = JSON.parse(json);
    // Tolerate an admin-api envelope (`{data: …}`) being pasted verbatim.
    const inner = parsed?.data ?? parsed;
    if (!inner || typeof inner !== "object") return null;

    // Wrapped form: {invitation, groupAlias?, contextId?, groupId?}
    if (isSignedInvitation((inner as StreamInvitePayload).invitation)) {
      const p = inner as StreamInvitePayload & { groupName?: string };
      return {
        invitation: p.invitation,
        groupAlias:
          typeof p.groupName === "string" ? p.groupName : p.groupAlias,
        contextId: typeof p.contextId === "string" ? p.contextId : undefined,
        groupId: typeof p.groupId === "string" ? p.groupId : undefined,
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
 * The namespace to join, read out of the SIGNED invitation itself rather than
 * carried alongside it — so a tampered wrapper cannot redirect a join.
 *
 * The group id is a byte array on current nodes and already a string on some
 * versions; hex-encode the former. Both key spellings are tolerated.
 */
export function namespaceIdOfInvite(payload: StreamInvitePayload): string {
  const inner = payload.invitation.invitation as Record<string, unknown>;
  const raw = inner.groupId ?? inner.group_id;
  if (Array.isArray(raw)) {
    return (raw as number[])
      .map((b) => Number(b).toString(16).padStart(2, "0"))
      .join("");
  }
  return typeof raw === "string" ? raw : "";
}

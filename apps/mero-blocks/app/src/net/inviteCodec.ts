// World-invite codec — the same wire format as mero-chat (curb): the JSON
// payload is deflate-compressed and base58-encoded into a compact string you
// paste on another client. Pure functions, no session/network access, so both
// the app and the e2e suite can import it.

import bs58 from "bs58";
import { deflateSync, inflateSync } from "fflate";

/** admin-api `SignedGroupOpenInvitation` (field names vary across nodes) */
export interface SignedInvitation {
  invitation: Record<string, unknown>;
  inviterSignature?: string;
  inviter_signature?: string;
}

export interface WorldInvitePayload {
  invitation: SignedInvitation;
  /** world name — curb calls this groupAlias, keep the field for compatibility */
  groupAlias?: string;
  /** mero-blocks extensions: jump straight into the world after joining */
  contextId?: string;
  groupId?: string;
}

function isSignedInvitation(v: unknown): v is SignedInvitation {
  if (!v || typeof v !== "object") return false;
  const t = v as SignedInvitation;
  return (
    (typeof t.inviterSignature === "string" || typeof t.inviter_signature === "string") &&
    !!t.invitation &&
    typeof t.invitation === "object"
  );
}

function parsePayload(json: string): WorldInvitePayload | null {
  try {
    const parsed = JSON.parse(json);
    const inner = parsed?.data ?? parsed;
    if (!inner || typeof inner !== "object") return null;
    // wrapped form {invitation, groupAlias?, contextId?, groupId?}
    if (isSignedInvitation((inner as WorldInvitePayload).invitation)) {
      const p = inner as WorldInvitePayload & { groupName?: string };
      return {
        invitation: p.invitation,
        groupAlias: typeof p.groupName === "string" ? p.groupName : p.groupAlias,
        contextId: typeof p.contextId === "string" ? p.contextId : undefined,
        groupId: typeof p.groupId === "string" ? p.groupId : undefined,
      };
    }
    // bare SignedGroupOpenInvitation (a curb-style namespace invite)
    if (isSignedInvitation(inner)) return { invitation: inner };
    return null;
  } catch {
    return null;
  }
}

/** Compress + base58-encode the payload into the shareable invite string. */
export function encodeInvite(payload: WorldInvitePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return bs58.encode(deflateSync(bytes, { level: 9 }));
}

/**
 * Decode pasted input: base58(deflate(JSON)) — also tolerates uncompressed
 * base58 and raw JSON, so curb-era invites and debugging paste-ins work.
 */
export function decodeInvite(input: string): WorldInvitePayload | null {
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
 * The namespace to join is carried inside the signed invitation as its
 * group id — a byte array on current nodes (hex-encode it) or already a
 * string on some versions. Tolerates both key spellings.
 */
export function namespaceIdOfInvite(payload: WorldInvitePayload): string {
  const inner = payload.invitation.invitation as Record<string, unknown>;
  const raw = inner.groupId ?? inner.group_id;
  if (Array.isArray(raw)) {
    return (raw as number[]).map((b) => Number(b).toString(16).padStart(2, "0")).join("");
  }
  return typeof raw === "string" ? raw : "";
}

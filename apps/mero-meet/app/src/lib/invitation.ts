// ── Room invitations ──────────────────────────────────────────────────────────
//
// A Mero Meet room == a Calimero context inside a namespace. Sharing a room with
// someone on another node is a namespace invitation: the host generates a signed
// invitation (POST /namespaces/{id}/invite), the invitee joins the namespace
// (POST /namespaces/{id}/join), then joins the room context. Same mechanism the
// other mero apps use (mero-design Teams, mero-chat namespaces).
//
// We ship the signed invitation as a url-safe base64 token so it pastes cleanly.

/** UTF-8 → url-safe base64 (btoa is Latin1-only, so encode bytes first). */
export function encodeInvitation(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function decodeInvitation(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  try {
    const bin = atob(pad ? padded + "=".repeat(4 - pad) : padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return encoded;
  }
}

/** Encode an invitation object (signed node response + extras like the room name). */
export function encodeInvitationObject(obj: unknown): string {
  return encodeInvitation(JSON.stringify(obj));
}

/** Decode a token from {@link encodeInvitationObject} back to its object. */
export function decodeInvitationObject<T = Record<string, unknown>>(encoded: string): T {
  return JSON.parse(decodeInvitation(encoded)) as T;
}

type Dict = Record<string, unknown>;

/**
 * Pull the signed invitation struct + the namespace id out of a decoded token.
 *
 * The node's invitation nests as
 *   { invitation: { invitation: { group_id: [...bytes] }, inviterSignature, applicationId } }
 * `group_id` may be a byte array (→ hex) or already a string. The join endpoint
 * wants the *outer* signed struct wrapped as `{ invitation: <outer> }`.
 */
export function parseRoomInvitation(token: string): {
  namespaceId: string;
  signed: unknown;
  roomName?: string;
} {
  const obj = decodeInvitationObject<Dict>(token);
  const outer = (obj.invitation as Dict) ?? obj;
  const inner = (outer?.invitation as Dict) ?? outer;
  const rawGroupId =
    (inner?.group_id ?? inner?.groupId ?? outer?.group_id ?? outer?.groupId) as
      | number[]
      | string
      | undefined;
  const namespaceId = Array.isArray(rawGroupId)
    ? rawGroupId.map((b) => b.toString(16).padStart(2, "0")).join("")
    : String(rawGroupId ?? "");
  const roomName = typeof obj.__roomName === "string" ? obj.__roomName : undefined;
  return { namespaceId, signed: outer, roomName };
}

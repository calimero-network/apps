export function encodeInvitation(raw: string): string {
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function decodeInvitation(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  try {
    return atob(pad ? padded + "=".repeat(4 - pad) : padded);
  } catch {
    return encoded;
  }
}

/** Encode an invitation *object* (the node's signed invitation response, plus
 *  any extra fields like the team name) as a url-safe base64 token. */
export function encodeInvitationObject(obj: unknown): string {
  return encodeInvitation(JSON.stringify(obj));
}

/** Decode a token produced by {@link encodeInvitationObject} back to its object. */
export function decodeInvitationObject<T = Record<string, unknown>>(encoded: string): T {
  return JSON.parse(decodeInvitation(encoded)) as T;
}

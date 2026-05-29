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

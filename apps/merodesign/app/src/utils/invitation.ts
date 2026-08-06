import { createLink } from "@calimero-network/mero-platform";

export function encodeInvitation(raw: string): string {
  // btoa only accepts Latin1 (code points 0-255) and throws on anything else, so
  // UTF-8-encode to bytes first — otherwise a team name with an emoji or accented
  // character would break invitation generation. ASCII input is unchanged.
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

/** Encode an invitation *object* (the node's signed invitation response, plus
 *  any extra fields like the team name) as a url-safe base64 token. */
export function encodeInvitationObject(obj: unknown): string {
  return encodeInvitation(JSON.stringify(obj));
}

/** Decode a token produced by {@link encodeInvitationObject} back to its object. */
export function decodeInvitationObject<T = Record<string, unknown>>(encoded: string): T {
  return JSON.parse(decodeInvitation(encoded)) as T;
}

/**
 * The app's deep-link slug. The desktop resolves a link by
 * `Application.package`, and links.calimero.network resolves the web build by
 * asking the registry for that same package — so the slug IS the package id.
 * Keep equal to `slug`/`package` in `logic/Cargo.toml`.
 */
export const APP_SLUG = "com.calimero.merodesign";

/**
 * The shareable form of an invitation token: a canonical HTTPS link that opens
 * the desktop app where it is installed and the published web build otherwise.
 * {@link invitationTokenFrom} reads it back, so a bare token still works.
 */
export function invitationLink(token: string): string {
  return createLink(APP_SLUG, "join", { invitation: token });
}

/** The token carried by an invitation link, or the input unchanged if it isn't one. */
export function invitationTokenFrom(input: string): string {
  const trimmed = input.trim();
  if (!/^(https?|calimero):\/\//i.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed).searchParams.get("invitation") ?? trimmed;
  } catch {
    return trimmed;
  }
}

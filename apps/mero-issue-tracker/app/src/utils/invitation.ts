/**
 * Invitation encoding and the shareable link.
 *
 * A raw namespace invitation is a large JSON object full of byte arrays
 * (e.g. `inviter_identity: [117, 166, …]`) — far too long to put in a URL
 * verbatim. We deflate it and base58 it, then wrap that in the one HTTPS link
 * every app shares. Decoding accepts every older shape we ever emitted (plain
 * base64, base64url, percent-encoded JSON) so an invite in flight during an
 * upgrade still works.
 *
 * The link is the only way in: it is opened, never pasted. The shared capture
 * (`primeInvitationCapture`, see `auth/ssoBootstrap`) hands the app the token
 * out of it, and `decodeInvitation` reads that token.
 */
import bs58 from "bs58";
import { deflateSync, inflateSync } from "fflate";
import { buildInviteLink } from "@calimero-network/mero-react";
import { APP_PACKAGE } from "../config";

/**
 * Deep-link slug. The desktop launcher resolves a link by `Application.package`,
 * and links.calimero.network resolves the web frontend by asking the registry
 * for that same package — so the slug IS the package id, not a friendly name.
 */
export const APP_SLUG = APP_PACKAGE;

/** Deflate + base58. Roughly halves the link length versus raw base64 JSON. */
export function encodeInvitationPayload(payload: string): string {
  return bs58.encode(
    deflateSync(new TextEncoder().encode(payload), { level: 9 }),
  );
}

/**
 * Decode a share code back to its JSON string, trying every format we have
 * emitted. Each candidate must parse as JSON to be accepted — base58 and base64
 * alphabets overlap, so a successful *decode* is not evidence of the right
 * format. Returns null when nothing yields JSON.
 */
export function decodeInvitationPayload(encoded: string): string | null {
  if (!encoded || typeof encoded !== "string") return null;
  const s = encoded.trim().replace(/\s+/g, "");
  if (!s) return null;

  for (const candidate of decodeCandidates(s)) {
    if (candidate === null) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* wrong format — keep trying */
    }
  }
  return null;
}

function* decodeCandidates(s: string): Generator<string | null> {
  yield tryOr(() => new TextDecoder().decode(inflateSync(bs58.decode(s))));
  yield tryOr(() => new TextDecoder().decode(bs58.decode(s)));
  yield tryOr(() => utf8FromBase64(s));
  yield tryOr(() => decodeURIComponent(s));
  yield s;
}

function tryOr(fn: () => string): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * The canonical shareable link (HTTPS). One link works everywhere: a device with
 * Calimero Desktop installed hands it to the app, and otherwise the landing page
 * resolves this package's published `links.frontend` from the registry and
 * forwards the query untouched. Sharing `window.location.origin` instead would
 * pin the invite to whichever deployment the inviter happened to be on.
 */
export function generateInvitationUrl(payload: string): string {
  return buildInviteLink(APP_SLUG, encodeInvitationPayload(payload));
}

// ── Object-level helpers used by the invite/join call sites ─────────────────

/** Encode an invitation object to a share code. */
export function encodeInvitation(invitation: unknown): string {
  return encodeInvitationPayload(JSON.stringify(invitation));
}

/** Decode the token a link carries (or a legacy raw-JSON one) back to the invitation object. */
export function decodeInvitation(token: string): unknown {
  const s = token.trim();
  if (!s) throw new Error("Empty invitation.");
  // Raw JSON first, as-is: the codec below strips whitespace, which would
  // mangle a name with a space in it.
  const json =
    (s.startsWith("{") ? tryOr(() => (JSON.parse(s), s)) : null) ??
    decodeInvitationPayload(s);
  if (!json) throw new Error("That invitation could not be read.");
  return JSON.parse(json);
}

function utf8FromBase64(b64: string): string {
  // Accept base64url (-_) alongside standard base64, and re-pad either way.
  const std = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = std.length % 4;
  const padded = pad ? std + "=".repeat(4 - pad) : std;
  if (typeof atob === "function" && typeof TextDecoder !== "undefined") {
    const bin = atob(padded);
    return new TextDecoder().decode(
      Uint8Array.from(bin, (c) => c.charCodeAt(0)),
    );
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}

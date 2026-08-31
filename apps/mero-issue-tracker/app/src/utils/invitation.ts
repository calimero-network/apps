/**
 * Invitation encoding and shareable deep links.
 *
 * A raw namespace invitation is a large JSON object full of byte arrays
 * (e.g. `inviter_identity: [117, 166, …]`) — far too long to paste into a URL
 * verbatim. We deflate it and base58 it, then wrap that in an HTTPS deep link
 * built by the platform SDK. Decoding accepts every older shape we ever emitted
 * (plain base64, base64url, percent-encoded JSON) so an invite in flight during
 * an upgrade still works.
 */
import bs58 from 'bs58';
import { deflateSync, inflateSync } from 'fflate';
import { createLink } from '@calimero-network/mero-platform';
import { APP_PACKAGE } from '../config';

/**
 * Deep-link slug. The desktop launcher resolves a link by `Application.package`,
 * and links.calimero.network resolves the web frontend by asking the registry
 * for that same package — so the slug IS the package id, not a friendly name.
 */
export const APP_SLUG = APP_PACKAGE;

/** Device-local transport for the desktop app; not a shareable link. */
export const CALIMERO_JOIN_DEEP_LINK = `calimero://${APP_SLUG}/join`;

/** Deflate + base58. Roughly halves the link length versus raw base64 JSON. */
export function encodeInvitationPayload(payload: string): string {
  return bs58.encode(deflateSync(new TextEncoder().encode(payload), { level: 9 }));
}

/**
 * Decode a share code back to its JSON string, trying every format we have
 * emitted. Each candidate must parse as JSON to be accepted — base58 and base64
 * alphabets overlap, so a successful *decode* is not evidence of the right
 * format. Returns null when nothing yields JSON.
 */
export function decodeInvitationPayload(encoded: string): string | null {
  if (!encoded || typeof encoded !== 'string') return null;
  const s = encoded.trim().replace(/\s+/g, '');
  if (!s) return null;

  for (const candidate of decodeCandidates(s)) {
    if (candidate === null) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch { /* wrong format — keep trying */ }
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
  try { return fn(); } catch { return null; }
}

/**
 * Normalise user input to the invitation JSON string. Accepts a full link
 * (`https://links.calimero.network/…?invitation=…` or `calimero://…`), a bare
 * share code, or raw JSON.
 */
export function parseInvitationInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  if (/^(https?|calimero):\/\//.test(s)) {
    const raw = tryOr(() => new URL(s).searchParams.get('invitation') ?? '');
    return raw ? decodeInvitationPayload(raw) : null;
  }
  if (s.startsWith('{') || s.startsWith('[')) {
    return tryOr(() => (JSON.parse(s), s));
  }
  return decodeInvitationPayload(s);
}

/**
 * The canonical shareable link (HTTPS). One link works everywhere: a device with
 * Calimero Desktop installed hands it to the app, and otherwise the landing page
 * resolves this package's published `links.frontend` from the registry and
 * forwards the query untouched. Sharing `window.location.origin` instead would
 * pin the invite to whichever deployment the inviter happened to be on.
 */
export function generateInvitationUrl(payload: string): string {
  return createLink(APP_SLUG, 'join', { invitation: encodeInvitationPayload(payload) });
}

/** `calimero://…/join?invitation=…` — for Windows/Linux, which cannot intercept the HTTPS link. */
export function generateInvitationDeepLink(payload: string): string {
  return `${CALIMERO_JOIN_DEEP_LINK}?invitation=${encodeInvitationPayload(payload)}`;
}

// ── Object-level helpers used by the invite/join call sites ─────────────────

/** Encode an invitation object to a share code. */
export function encodeInvitation(invitation: unknown): string {
  return encodeInvitationPayload(JSON.stringify(invitation));
}

/** Decode a share code, link, or raw JSON back to the invitation object. */
export function decodeInvitation(input: string): unknown {
  if (!input.trim()) throw new Error('Empty invitation.');
  const json = parseInvitationInput(input);
  if (!json) throw new Error('That does not look like a valid invite link or code.');
  return JSON.parse(json);
}

function utf8FromBase64(b64: string): string {
  // Accept base64url (-_) alongside standard base64, and re-pad either way.
  const std = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4;
  const padded = pad ? std + '='.repeat(4 - pad) : std;
  if (typeof atob === 'function' && typeof TextDecoder !== 'undefined') {
    const bin = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  return Buffer.from(padded, 'base64').toString('utf-8');
}

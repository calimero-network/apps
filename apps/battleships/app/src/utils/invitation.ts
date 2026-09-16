import bs58 from 'bs58';
import { deflateSync, inflateSync } from 'fflate';
import { createLink } from '@calimero-network/mero-platform';

/**
 * Shareable invitations and deep links for Battleships.
 *
 * Ported from `apps/kv-store/app/src/utils/invitation.ts`, which is the
 * reference implementation in this repo, with one deliberate difference: the
 * payload is OPAQUE here.
 *
 * kv-store models its payload (`{ invitation, namespaceId, contextId }`)
 * because it has to open a specific context after joining. Battleships does
 * not — `joinLobby` already accepts both shapes the lobby emits (a single
 * `{ invitation, inviterSignature }` and the recursive
 * `{ invitations: [...] }`), and the SDK's own docs warn that re-modelling an
 * invitation through a client's own type drops unknown fields and invalidates
 * the signature with them. So this file moves the JSON around and never looks
 * inside it.
 *
 * Everything here is pure — no React, no node client — so it is unit-testable
 * without either.
 */

/**
 * The deep-link slug IS the bundle's `package` id.
 *
 * The desktop launcher resolves a link by matching `Application.package`, not a
 * display name or a name-derived slug. Keep this equal to
 * `[package.metadata.calimero].package` in logic/Cargo.toml — they are the same
 * identifier, and drift between them produces links that silently never open.
 */
export const APP_SLUG = 'com.calimero.battleships';

/** Refuse anything larger before decoding it. */
const MAX_ENCODED_CHARS = 64 * 1024;
/** Cap on what an inflate may produce, so a small blob cannot expand forever. */
const MAX_INFLATED_BYTES = 1024 * 1024;

const BASE58_ALPHABET = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Inflate, refusing anything that expands past the cap. Null = over budget. */
function inflateBounded(bytes: Uint8Array): Uint8Array | null {
  const out = inflateSync(bytes);
  if (out.length > MAX_INFLATED_BYTES) return null;
  return out;
}

/**
 * Compress, then base58.
 *
 * A namespace invitation is long, and the link has to survive being pasted into
 * a chat message. deflate before encoding is what keeps it short; base58 is
 * chosen over base64url because it has no characters a URL, a shell, or a
 * double-click selection treats specially.
 */
export function encodeInvitationPayload(payload: string): string {
  const bytes = new TextEncoder().encode(payload);
  return bs58.encode(deflateSync(bytes, { level: 9 }));
}

/**
 * Decode a payload, trying each format this app has ever emitted.
 *
 * The fallback chain is not defensiveness for its own sake: an invitation is a
 * link someone already sent, so a decoder that only understands today's format
 * breaks links that are already in the wild. Order is newest first — compressed
 * base58, then uncompressed base58, then base64url, then percent-encoded JSON.
 *
 * Returns the raw JSON string, or null.
 */
export function decodeInvitationPayload(encoded: string): string | null {
  if (!encoded || typeof encoded !== 'string') return null;
  const trimmed = encoded.trim();
  if (!trimmed) return null;
  // Refuse before decoding anything: the cheapest place to stop a hostile blob
  // is before it reaches a decompressor.
  if (trimmed.length > MAX_ENCODED_CHARS) return null;

  if (BASE58_ALPHABET.test(trimmed)) {
    try {
      const bytes = bs58.decode(trimmed);
      if (bytes.length > MAX_ENCODED_CHARS) return null;
      try {
        const inflated = inflateBounded(bytes);
        // null = over the output cap. Do NOT fall through to the "base58 but
        // not deflated" branch here: that would return the compressed bytes as
        // if they were text, turning a rejected bomb into garbage that looks
        // like a payload.
        if (inflated === null) return null;
        return new TextDecoder().decode(inflated);
      } catch {
        // Base58 but not deflated — an older link.
        return new TextDecoder().decode(bytes);
      }
    } catch {
      // Not base58 after all; fall through.
    }
  }

  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    try {
      const base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
      const pad = trimmed.length % 4;
      const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      // fall through
    }
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return null;
  }
}

/**
 * Accept whatever the user pasted: a full https or `calimero://` link, a bare
 * encoded blob, or raw JSON. Returns the payload JSON string, or null.
 *
 * Raw JSON stays accepted on purpose. Every invitation this app issued before
 * links existed was a pretty-printed JSON blob, and people have them saved.
 */
export function parseInvitationInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('calimero://')
    ) {
      const parsed = new URL(trimmed);
      const invitation = parsed.searchParams.get('invitation');
      return invitation ? decodeInvitationPayload(invitation) : null;
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
    return decodeInvitationPayload(trimmed);
  } catch {
    return null;
  }
}

/**
 * The canonical shareable link — HTTPS, built by the platform SDK:
 * `https://links.calimero.network/com.calimero.battleships/join?invitation=…`
 *
 * ⚠️ This only opens anything once the published bundle declares
 * `links.frontend`. The desktop resolves a link to an installed app, reads
 * `metadata.links.frontend`, and FORGETS the link if that field is missing
 * ("app has no frontend URL; cannot open"). So shipping this code is necessary
 * but not sufficient: the app also needs a deployed frontend whose origin is in
 * the bundle.
 */
export function generateInvitationUrl(payloadJson: string): string {
  return createLink(APP_SLUG, 'join', {
    invitation: encodeInvitationPayload(payloadJson),
  });
}

/**
 * Device-local link. Kept separate and NOT offered in the UI.
 *
 * The HTTPS link above already hands off to the desktop on a machine that has
 * it, so showing both asks the user to make a choice they cannot evaluate.
 */
export const CALIMERO_JOIN_DEEP_LINK = `calimero://${APP_SLUG}/join`;

export function generateInvitationDeepLink(payloadJson: string): string {
  return `${CALIMERO_JOIN_DEEP_LINK}?invitation=${encodeInvitationPayload(payloadJson)}`;
}

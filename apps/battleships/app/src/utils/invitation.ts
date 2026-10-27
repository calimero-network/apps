import bs58 from 'bs58';
import { deflateSync, inflateSync } from 'fflate';
import { buildInviteLink } from '@calimero-apps/cloud';
import { embeddedInviterKey } from './knownPlayers';
import { embeddedLobbyName } from './lobbyName';

/**
 * Shareable invitations and deep links for Battleships.
 *
 * Ported from `apps/kv-store/app/src/utils/invitation.ts`, which is the
 * reference implementation in this repo, with one deliberate difference: the
 * payload is OPAQUE here.
 *
 * kv-store models its payload (`{ invitation, namespaceId, contextId }`)
 * because it has to open a specific context after joining. Battleships does
 * not — the join already accepts both shapes the lobby emits (a single
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

/** A group id as the node lists it: hex, whether it arrived as bytes or a string. */
function groupIdHex(gid: unknown): string | null {
  if (Array.isArray(gid)) {
    return gid.length > 0
      ? gid.map((b: number) => Number(b).toString(16).padStart(2, '0')).join('')
      : null;
  }
  return typeof gid === 'string' && gid ? gid : null;
}

/** What an opened invitation link carries, read out of its token. */
export interface LobbyInvitation {
  namespaceId: string;
  /** The signed invitation, exactly as the inviter's node produced it. */
  invitation: unknown;
  /** The group alias the node put in a recursive invitation, if any. */
  groupAlias?: string;
  /** The lobby's human name the inviter embedded beside the invitation. */
  lobbyName?: string;
  /** The inviter's player key, so the joiner has someone to challenge. */
  inviterKey?: string;
}

/**
 * Read the token of an opened invitation link into what a join needs.
 *
 * Both shapes the lobby has emitted are accepted — the recursive
 * `{ invitations: [{ groupId, invitation, groupAlias }] }` and the single
 * `{ invitation: { groupId: number[], … }, inviterSignature }` — and the
 * invitation itself is handed on untouched (see the top of this file). Returns
 * null for anything that names no namespace.
 */
export function readLobbyInvitation(token: string): LobbyInvitation | null {
  const json = decodeInvitationPayload(token);
  if (!json) return null;
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object') return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }

  let namespaceId: string | null = null;
  let invitation: unknown = parsed;
  let groupAlias: string | undefined;
  const list = parsed.invitations;
  const single = parsed.invitation as { groupId?: unknown } | undefined;
  if (Array.isArray(list) && list.length > 0) {
    const first = list[0] as {
      groupId?: unknown;
      invitation?: unknown;
      groupAlias?: unknown;
    };
    namespaceId = groupIdHex(first?.groupId);
    invitation = first?.invitation;
    groupAlias =
      typeof first?.groupAlias === 'string' && first.groupAlias
        ? first.groupAlias
        : undefined;
  } else if (single?.groupId) {
    namespaceId = groupIdHex(single.groupId);
    groupAlias =
      typeof parsed.groupAlias === 'string' && parsed.groupAlias
        ? parsed.groupAlias
        : undefined;
  }
  if (!namespaceId) return null;

  return {
    namespaceId,
    invitation,
    groupAlias,
    lobbyName: embeddedLobbyName(parsed) || groupAlias || undefined,
    inviterKey: embeddedInviterKey(parsed) || undefined,
  };
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
  return buildInviteLink(APP_SLUG, encodeInvitationPayload(payloadJson));
}

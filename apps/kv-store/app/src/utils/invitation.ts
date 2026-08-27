import bs58 from "bs58";
import { deflateSync, inflateSync } from "fflate";
import { createLink } from "@calimero-network/mero-platform";
import type { SignedGroupOpenInvitation } from "@calimero-network/mero-js";

/**
 * Shareable invitations and deep links for kv-store.
 *
 * Ported from `mero-chat-pwa/app/src/utils/invitation.ts`, which is the
 * reference implementation, with the payload adapted: chat invites someone to a
 * chat group, this invites someone to a KV *context*, which means carrying the
 * namespace invitation plus the ids needed to join the context inside it.
 *
 * Everything here is pure — no React, no node client — so it is unit-testable
 * without either, and is the first thing that should move to a shared package
 * once a second app in this repo needs it.
 */

/**
 * The deep-link slug IS the bundle's `package` id.
 *
 * The desktop launcher resolves a link by matching `Application.package`, not a
 * display name or a name-derived slug. Package ids are globally unique and
 * survive renames; display names collide. Keep this equal to
 * `[package.metadata.calimero].package` in logic/Cargo.toml — they are the same
 * identifier and a drift between them produces links that silently never open.
 */
export const APP_SLUG = "com.calimero.kv-store";

/** What a kv-store invitation actually carries. */
export interface KvInvitationPayload {
  /**
   * The signed invitation, exactly as `createNamespaceInvitation` returned it.
   *
   * A STRUCTURE, not a string, and it must round-trip byte-for-byte: the object
   * carries `inviter_signature` over a signed body, plus unsigned bootstrap
   * fields (`inviter_account`) that sit deliberately OUTSIDE the signature. The
   * SDK's own docs warn that a client which re-models the invitation through its
   * own type drops unknown fields and invalidates the signature with them — so
   * this is passed through opaquely and never reconstructed.
   */
  invitation: SignedGroupOpenInvitation;
  /** The namespace the invitation admits you to. */
  namespaceId: string;
  /** The context inside it to open once joined. */
  contextId: string;
}

export function serializeInvitationPayload(payload: KvInvitationPayload): string {
  return JSON.stringify(payload);
}

/** Parse a payload JSON string, returning null rather than throwing. */
export function parseInvitationPayload(json: string): KvInvitationPayload | null {
  try {
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== "object") return null;
    const { invitation, namespaceId, contextId } = v as Record<string, unknown>;
    if (typeof namespaceId !== "string" || !namespaceId) return null;
    if (typeof contextId !== "string" || !contextId) return null;
    // Shape-check the invitation only as far as "is it the signed envelope" —
    // deliberately NOT field-by-field. Validating it against a local model is
    // how a client drops an unsigned bootstrap field it does not know about and
    // breaks the signature; the node is the only thing that should judge it.
    if (!invitation || typeof invitation !== "object") return null;
    if (!("inviter_signature" in invitation)) return null;
    return {
      invitation: invitation as SignedGroupOpenInvitation,
      namespaceId,
      contextId,
    };
  } catch {
    return null;
  }
}

const BASE58_ALPHABET =
  /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

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
  if (!encoded || typeof encoded !== "string") return null;
  const trimmed = encoded.trim();
  if (!trimmed) return null;

  if (BASE58_ALPHABET.test(trimmed)) {
    try {
      const bytes = bs58.decode(trimmed);
      try {
        return new TextDecoder().decode(inflateSync(bytes));
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
      const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
      const pad = trimmed.length % 4;
      const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
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
 */
export function parseInvitationInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("calimero://")
    ) {
      const parsed = new URL(trimmed);
      const invitation = parsed.searchParams.get("invitation");
      return invitation ? decodeInvitationPayload(invitation) : null;
    }
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
    return decodeInvitationPayload(trimmed);
  } catch {
    return null;
  }
}

/**
 * True only when a join failure means the invitation itself will never work.
 *
 * Deliberately errs toward FALSE — an unrecognised error keeps the pending
 * invitation for the next load. The asymmetry is the whole point: a dropped
 * invitation is unrecoverable for the user (they have to ask for another one),
 * while a retried one costs a round trip. So "no online member", a timeout, a
 * network blip, or anything unfamiliar must not discard it.
 */
export function isTerminalInvitationError(
  message: string | undefined | null,
): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return [
    "expired",
    "invalid",
    "malformed",
    "signature",
    "not admin",
    "revoked",
    "already a member",
  ].some((t) => m.includes(t));
}

/**
 * The canonical shareable link — HTTPS, built by the platform SDK:
 * `https://links.calimero.network/com.calimero.kv-store/join?invitation=…`
 *
 * ⚠️ This only opens anything once the published bundle declares
 * `links.frontend`. The desktop resolves a link to an installed app, reads
 * `metadata.links.frontend`, and FORGETS the link if that field is missing
 * ("app has no frontend URL; cannot open"). So shipping this code is necessary
 * but not sufficient: the app also has to have a deployed frontend whose origin
 * is in the bundle.
 */
export function generateInvitationUrl(payloadJson: string): string {
  return createLink(APP_SLUG, "join", {
    invitation: encodeInvitationPayload(payloadJson),
  });
}

/**
 * Device-local link. Kept separate and NOT offered in the UI.
 *
 * The HTTPS link above already hands off to the desktop on a machine that has
 * it, so showing both asks the user to make a choice they cannot evaluate —
 * mero-chat-pwa dropped its second link for exactly this reason (its PR #9).
 * This stays exported for a "copy desktop link" affordance if one is ever
 * genuinely needed, and because the platform SDK is HTTPS-only by design.
 */
export const CALIMERO_JOIN_DEEP_LINK = `calimero://${APP_SLUG}/join`;

export function generateInvitationDeepLink(payloadJson: string): string {
  return `${CALIMERO_JOIN_DEEP_LINK}?invitation=${encodeInvitationPayload(payloadJson)}`;
}

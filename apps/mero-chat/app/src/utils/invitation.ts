import bs58 from "bs58";
import { deflateSync, inflateSync } from "fflate";
import { createLink } from "@calimero-network/mero-platform";
import type { SignedGroupOpenInvitation } from "../api/groupApi";

/**
 * Invitation utility functions for handling invitation payloads.
 * Uses base64url encoding for compact, URL-safe invitation links.
 */

export const INVITATION_STORAGE_KEY = "curb-invitation-payload";

/**
 * App slug used for deep links. The desktop launcher resolves links by
 * `Application.package`, so the slug IS the package id (not a friendly name).
 */
export const CURB_APP_SLUG = "com.calimero.curb";

export interface GroupInvitationPayload {
  invitation: SignedGroupOpenInvitation;
  groupAlias?: string;
}

function isSignedGroupOpenInvitation(
  value: unknown,
): value is SignedGroupOpenInvitation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const typedValue = value as {
    invitation?: Record<string, unknown>;
    inviterSignature?: unknown;
    inviter_signature?: unknown;
  };

  return (
    (typeof typedValue.inviterSignature === "string" ||
      typeof typedValue.inviter_signature === "string") &&
    !!typedValue.invitation &&
    typeof typedValue.invitation === "object"
  );
}

function isWrappedGroupInvitationPayload(
  value: unknown,
): value is GroupInvitationPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const typedValue = value as {
    invitation?: unknown;
    groupAlias?: unknown;
    groupName?: unknown;
  };

  return (
    isSignedGroupOpenInvitation(typedValue.invitation) &&
    (typedValue.groupAlias === undefined ||
      typeof typedValue.groupAlias === "string") &&
    (typedValue.groupName === undefined ||
      typeof typedValue.groupName === "string")
  );
}

function normalizeGroupInvitationPayload(
  payload: SignedGroupOpenInvitation | GroupInvitationPayload,
): GroupInvitationPayload {
  if (isSignedGroupOpenInvitation(payload)) {
    return { invitation: payload };
  }

  const p = payload as GroupInvitationPayload & { groupName?: string };
  return {
    invitation: payload.invitation,
    // groupName (mero-js ≥2.1) takes precedence; groupAlias kept for older nodes
    groupAlias:
      typeof p.groupName === "string"
        ? p.groupName
        : typeof payload.groupAlias === "string"
          ? payload.groupAlias
          : undefined,
  };
}

export function serializeGroupInvitationPayload(
  invitation: SignedGroupOpenInvitation | GroupInvitationPayload,
): string {
  return JSON.stringify(normalizeGroupInvitationPayload(invitation));
}

export function parseGroupInvitationPayload(
  payload: string,
): GroupInvitationPayload | null {
  try {
    const parsed = JSON.parse(payload.trim());
    const inner = parsed?.data ?? parsed;
    if (isWrappedGroupInvitationPayload(inner)) {
      return normalizeGroupInvitationPayload(inner);
    }

    return isSignedGroupOpenInvitation(inner)
      ? normalizeGroupInvitationPayload(inner)
      : null;
  } catch {
    return null;
  }
}

const BASE58_ALPHABET = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

/** Compress + base58 encode a JSON payload string. Shorter URLs than plain base58. */
export function encodeInvitationPayload(payload: string): string {
  const bytes = new TextEncoder().encode(payload);
  const compressed = deflateSync(bytes, { level: 9 });
  return bs58.encode(compressed);
}

/**
 * Decode an invitation payload. Tries base58 first, then legacy base64url, then
 * percent-encoded JSON, so old invitations still work.
 * Returns the raw JSON string, or null on failure.
 */
export function decodeInvitationPayload(encoded: string): string | null {
  if (!encoded || typeof encoded !== "string") return null;
  const trimmed = encoded.trim();

  // Try base58 (new: compressed; old: raw UTF-8)
  if (BASE58_ALPHABET.test(trimmed)) {
    try {
      const bytes = bs58.decode(trimmed);
      try {
        return new TextDecoder().decode(inflateSync(bytes));
      } catch {
        // Not compressed — old invitation format
        return new TextDecoder().decode(bytes);
      }
    } catch {
      // fall through
    }
  }

  // Legacy: base64url
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    try {
      const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
      const pad = base64.length % 4;
      const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
      return decodeURIComponent(escape(atob(padded)));
    } catch {
      // fall through
    }
  }

  // Legacy: percent-encoded JSON
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return null;
  }
}

/**
 * Parse user input: full URL (https or calimero), or raw encoded string, or raw JSON.
 * Returns the invitation payload string (JSON) or null.
 */
export function parseInvitationInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("calimero://")) {
      const parsed = new URL(trimmed);
      const invitation = parsed.searchParams.get("invitation");
      return invitation ? decodeInvitationPayload(invitation) : null;
    }
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed;
    }
    return decodeInvitationPayload(trimmed);
  } catch {
    return null;
  }
}

/**
 * True when a join error means the invitation itself is bad and will never
 * succeed (expired / invalid / malformed / bad signature) — safe to forget the
 * stored invitation. False for transient or unrecognized errors (network,
 * timeout, "no online member", or anything we don't recognize), so the pending
 * invitation is KEPT and retried on the next load. Errs toward keeping.
 */
export function isTerminalInvitationError(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  const TERMINAL = [
    "expired",
    "invalid",
    "malformed",
    "signature",
    "not admin",
    "revoked",
    "already a member",
  ];
  return TERMINAL.some((t) => m.includes(t));
}

/**
 * Device-local deep link (`calimero://com.calimero.curb/join?invitation=…`).
 *
 * The platform SDK is HTTPS-only by design (the `calimero://` scheme is a
 * device transport, not a shareable link), so this thin helper stays local for
 * the "copy desktop link" affordance. The primary shareable link is HTTPS via
 * {@link generateInvitationUrl}. Slug is the app package for launcher parity.
 */
export const CALIMERO_CURB_JOIN_DEEP_LINK = `calimero://${CURB_APP_SLUG}/join`;

export function generateInvitationDeepLink(invitationPayload: string): string {
  const encoded = encodeInvitationPayload(invitationPayload);
  return `${CALIMERO_CURB_JOIN_DEEP_LINK}?invitation=${encoded}`;
}

/**
 * Canonical shareable invitation link (HTTPS), built by the platform SDK:
 * `https://links.calimero.network/com.calimero.curb/join?invitation=…`.
 *
 * An HTTPS link works everywhere: it opens the web/PWA app directly, and on a
 * device with the desktop installed hands off to the launcher.
 */
export function generateInvitationUrl(invitationPayload: string): string {
  return createLink(CURB_APP_SLUG, "join", {
    invitation: encodeInvitationPayload(invitationPayload),
  });
}


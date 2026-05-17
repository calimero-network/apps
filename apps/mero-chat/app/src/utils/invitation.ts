import bs58 from "bs58";
import type { SignedGroupOpenInvitation } from "../api/groupApi";

/**
 * Invitation utility functions for handling invitation payloads.
 * Uses base64url encoding for compact, URL-safe invitation links.
 */

const INVITATION_STORAGE_KEY = "curb-invitation-payload";

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

/** Base58 encode a JSON payload string. Compact and copy-friendly (no +/= chars). */
export function encodeInvitationPayload(payload: string): string {
  return bs58.encode(new TextEncoder().encode(payload));
}

/**
 * Decode an invitation payload. Tries base58 first, then legacy base64url, then
 * percent-encoded JSON, so old invitations still work.
 * Returns the raw JSON string, or null on failure.
 */
export function decodeInvitationPayload(encoded: string): string | null {
  if (!encoded || typeof encoded !== "string") return null;
  const trimmed = encoded.trim();

  // Try base58
  if (BASE58_ALPHABET.test(trimmed)) {
    try {
      return new TextDecoder().decode(bs58.decode(trimmed));
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

export function saveInvitationToStorage(invitationPayload: string): void {
  try {
    localStorage.setItem(INVITATION_STORAGE_KEY, invitationPayload);
  } catch (error) {
    console.error("Failed to save invitation to localStorage:", error);
  }
}

export function getInvitationFromStorage(): string | null {
  try {
    return localStorage.getItem(INVITATION_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to retrieve invitation from localStorage:", error);
    return null;
  }
}

export function clearInvitationFromStorage(): void {
  try {
    localStorage.removeItem(INVITATION_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear invitation from localStorage:", error);
  }
}

/** Deep link for Calimero Desktop App: calimero://curb/join?invitation={encoded} */
export const CALIMERO_CURB_JOIN_DEEP_LINK = "calimero://curb/join";

export function generateInvitationDeepLink(invitationPayload: string): string {
  const encoded = encodeInvitationPayload(invitationPayload);
  return `${CALIMERO_CURB_JOIN_DEEP_LINK}?invitation=${encoded}`;
}

/**
 * Web invitation URL (https). Same behavior when opened: browser decodes param and app uses it.
 */
export function generateInvitationUrl(invitationPayload: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const encoded = encodeInvitationPayload(invitationPayload);
  return `${base}/?invitation=${encoded}`;
}

/**
 * Extract invitation payload from current page URL query (e.g. after opening web invite link).
 * Decodes base64url first, then app uses the payload as usual.
 */
export function extractInvitationFromUrl(): string | null {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const invitation = urlParams.get("invitation");
    return invitation ? decodeInvitationPayload(invitation) : null;
  } catch (error) {
    console.error("Failed to extract invitation from URL:", error);
    return null;
  }
}

export function extractInvitationFromCalimeroUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const invitation = parsed.searchParams.get("invitation");
    return invitation ? decodeInvitationPayload(invitation) : null;
  } catch {
    return null;
  }
}

export function hasPendingInvitation(): boolean {
  return !!(extractInvitationFromUrl() || getInvitationFromStorage());
}

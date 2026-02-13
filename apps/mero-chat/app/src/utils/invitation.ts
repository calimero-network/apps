/**
 * Invitation utility functions for handling invitation payloads.
 * Uses base64url encoding for compact, URL-safe invitation links.
 */

const INVITATION_STORAGE_KEY = "curb-invitation-payload";

/** Base64url encode (URL-safe base64, no padding). Shorter and cleaner than percent-encoded JSON. */
export function encodeInvitationPayload(payload: string): string {
  const base64 = btoa(unescape(encodeURIComponent(payload)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode invitation payload from base64url (or legacy percent-encoded JSON).
 * Returns the raw JSON payload string, or null on failure.
 */
export function decodeInvitationPayload(encoded: string): string | null {
  if (!encoded || typeof encoded !== "string") return null;
  const trimmed = encoded.trim();
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    try {
      const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
      const pad = base64.length % 4;
      const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
      return decodeURIComponent(escape(atob(padded)));
    } catch {
      // fall through to legacy
    }
  }
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

import { buildInviteLink } from "@calimero-apps/cloud";

// ─── Invitation links ─────────────────────────────────────────────────────────
//
// Node B never pastes anything. Node A copies ONE link,
//
//     https://links.calimero.network/com.calimero.scaffolding-e2e/join?invitation=<token>
//
// and Node B opens it: the links page opens this app with `?invitation=…`, or a
// running desktop hands it over as a `deep-link` event. The token carries
// everything the joiner used to type by hand — the namespace id, the signed
// invitation, and the context to join inside the namespace — so opening the
// link is the whole join.

/**
 * The deep-link slug, which is the bundle's package id. Must match
 * `[package.metadata.calimero] slug` in logic/Cargo.toml: the links page and
 * the desktop resolve a link by it, so a mismatch opens nothing.
 */
export const APP_SLUG = "com.calimero.scaffolding-e2e";

/** What an invitation link carries. */
export interface InvitePayload {
  namespaceId: string;
  /** The signed invitation, exactly as Node A's node produced it. */
  invitation: object;
  /** The context Node A was using, joined once the namespace is. */
  contextId?: string;
}

/** Compact encoding: the JSON's UTF-8 bytes as base64url, no padding. */
export function invToCompact(inv: object): string {
  const json = JSON.stringify(inv);
  let binary = "";
  for (const b of new TextEncoder().encode(json))
    binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function compactToInv(s: string): object {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** The link Node A shares. */
export function inviteLink(payload: InvitePayload): string {
  return buildInviteLink(APP_SLUG, invToCompact(payload));
}

/** Read a link's token back, or `null` if it is not one of ours. */
export function readInviteToken(token: string): InvitePayload | null {
  let value: unknown;
  try {
    value = compactToInv(token.trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { namespaceId, invitation, contextId } = value as Record<
    string,
    unknown
  >;
  if (typeof namespaceId !== "string" || !namespaceId) return null;
  if (!invitation || typeof invitation !== "object") return null;
  return {
    namespaceId,
    invitation,
    contextId:
      typeof contextId === "string" && contextId ? contextId : undefined,
  };
}

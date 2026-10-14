import type { SignedGroupOpenInvitation } from "@calimero-network/mero-js";

export interface InviteLink { namespaceId: string; invitation: SignedGroupOpenInvitation }
export const JOIN_SESSION_KEY = "mero-org:join";

function b64url(s: string): string { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64url(s: string): string { const p = s.replace(/-/g, "+").replace(/_/g, "/"); return decodeURIComponent(escape(atob(p + "=".repeat((4 - (p.length % 4)) % 4)))); }

/** `${origin}/join#ns=…&inv=<base64url(JSON)>` — nothing else; the note is found by the invitation's own hash. */
export function encodeInviteLink(origin: string, link: InviteLink): string {
  const q = new URLSearchParams({ ns: link.namespaceId, inv: b64url(JSON.stringify(link.invitation)) });
  return `${origin.replace(/\/+$/, "")}/join#${q.toString()}`;
}

export function decodeInviteLink(hash: string): InviteLink | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const ns = q.get("ns"), inv = q.get("inv");
  if (!ns || !inv) return null;
  try { return { namespaceId: ns, invitation: JSON.parse(unb64url(inv)) as SignedGroupOpenInvitation }; } catch { return null; }
}

/** Reads the hash once (and strips it so a reload cannot replay it), keeping the link in sessionStorage for the wallet round-trip. */
export function stashInviteFromHash(): InviteLink | null {
  const fromHash = decodeInviteLink(window.location.hash);
  if (fromHash) {
    try { sessionStorage.setItem(JOIN_SESSION_KEY, JSON.stringify(fromHash)); } catch { /* private mode: the in-memory copy still serves this load */ }
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return fromHash;
  }
  try { const raw = sessionStorage.getItem(JOIN_SESSION_KEY); return raw ? (JSON.parse(raw) as InviteLink) : null; } catch { return null; }
}

export function clearStashedInvite(): void { try { sessionStorage.removeItem(JOIN_SESSION_KEY); } catch { /* nothing to clear */ } }

/**
 * Human names for lobbies (namespaces).
 *
 * The name given at `createNamespace({ name })` is not reliably readable on the
 * node that JOINED — the namespace metadata may not have synced yet, and until
 * it does the joiner renders a raw 64-hex id for a lobby their opponent calls
 * "Friday game". So the name is cached locally at both ends:
 *
 *   - on create, because the creator typed it
 *   - on join, because the inviter embeds it in the invitation
 *
 * and used as a fallback whenever the server returns no name.
 *
 * Mirrors `utils/teamName.ts` in mero-design and mero-pixart, which is the
 * established pattern in this repo, which in turn mirrors curb's
 * `getStoredGroupAlias()` fallback chain.
 */

const KEY = (namespaceId: string) => `bs-lobby-name-${namespaceId}`;

export function setStoredLobbyName(namespaceId: string, name: string): void {
  if (!namespaceId || !name?.trim()) return;
  try {
    localStorage.setItem(KEY(namespaceId), name.trim());
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function getStoredLobbyName(namespaceId: string): string {
  if (!namespaceId) return '';
  try {
    return localStorage.getItem(KEY(namespaceId))?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Best display name: server name → cached name → a short id. */
export function lobbyLabel(namespaceId: string, serverName?: string | null): string {
  const s = serverName?.trim();
  if (s) return s;
  const cached = getStoredLobbyName(namespaceId);
  if (cached) return cached;
  return `Lobby ${namespaceId.slice(0, 6)}`;
}

/**
 * The key the lobby name travels under, alongside the invitation.
 *
 * ⚠️ A SIBLING of the signed invitation, never inside it. The invitation is
 * signed over its own body, so adding a field to it would invalidate the
 * signature; putting the name next to it leaves every existing decode path
 * (`payload.invitation`, `payload.invitations`) untouched, and an older client
 * that does not know the key simply ignores it.
 */
export const EMBEDDED_NAME_KEY = '__lobbyName';

/** Read the embedded name out of a decoded invitation payload. */
export function embeddedLobbyName(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const v = (payload as Record<string, unknown>)[EMBEDDED_NAME_KEY];
  return typeof v === 'string' ? v.trim() : '';
}

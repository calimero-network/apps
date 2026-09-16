/**
 * Player keys learned from an invitation, cached per namespace.
 *
 * ⚠️ THE NODE DOES NOT TELL A JOINER WHO ELSE IS IN THE LOBBY. Measured against
 * two local nodes sharing one lobby context: the node that CREATED it lists
 * both identities, the node that JOINED lists only its own, and that does not
 * change with time — thirty seconds of polling, still one.
 *
 *     2528 (creator)  /identities → [2800b7a3…, 36db829d…]
 *     2529 (joiner)   /identities → [36db829d…]
 *
 * So an invited player opens the lobby, sees only themselves, and has nobody to
 * challenge — which reads as "creating a game is admin-only". It is not: the
 * contract's `create_match` has no admin gate at all. The joiner simply has no
 * opponent key to put in it.
 *
 * The invitation is the one channel that definitely reaches them, so the
 * inviter puts their own player key in it, exactly as the lobby name travels.
 * That gives a joiner at least the person who invited them, immediately.
 */

const KEY = (namespaceId: string) => `bs-known-players-${namespaceId}`;

/** The key the inviter's player id travels under, beside the invitation. */
export const INVITER_KEY = '__inviterKey';

/** Read the inviter's player key out of a decoded invitation payload. */
export function embeddedInviterKey(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const v = (payload as Record<string, unknown>)[INVITER_KEY];
  return typeof v === 'string' && /^[0-9a-fA-F]{64}$/.test(v.trim()) ? v.trim() : '';
}

export function getKnownPlayers(namespaceId: string): string[] {
  if (!namespaceId) return [];
  try {
    const raw = localStorage.getItem(KEY(namespaceId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Remember a player key for this namespace. Idempotent. */
export function addKnownPlayer(namespaceId: string, key: string): void {
  if (!namespaceId || !/^[0-9a-fA-F]{64}$/.test(key.trim())) return;
  try {
    const next = new Set(getKnownPlayers(namespaceId));
    next.add(key.trim());
    localStorage.setItem(KEY(namespaceId), JSON.stringify([...next]));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

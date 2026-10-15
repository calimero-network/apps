/**
 * TEE fleet nodes in a workspace's member list.
 *
 * A TEE node is admitted to the namespace by hardware attestation and appears
 * in `listGroupMembers` as an ordinary member row with role `ReadOnlyTee` (a
 * replica) or `RelayTee` (a relay). It is infrastructure, not a person: it is
 * split out of the roster once, in `useWorkspace`, so no member list, count,
 * assignee picker, name map or role control ever shows it, and its presence is
 * shown as "TEE enabled" instead.
 */

export type TeeMode = 'Relay' | 'Replica';

export const isTeeRole = (role: string | null | undefined): boolean =>
  role === 'ReadOnlyTee' || role === 'RelayTee';

/** Splits a member list into the people in it and the TEE nodes. */
export function splitTeeMembers<T extends { role?: string | null }>(
  members: readonly T[],
): { people: T[]; tee: T[] } {
  const people: T[] = [];
  const tee: T[] = [];
  for (const m of members) (isTeeRole(m.role) ? tee : people).push(m);
  return { people, tee };
}

/** Relay when any TEE node may relay; null when there is no TEE at all. */
export function teeMode(tee: readonly { role?: string | null }[]): TeeMode | null {
  if (tee.length === 0) return null;
  return tee.some((m) => m.role === 'RelayTee') ? 'Relay' : 'Replica';
}

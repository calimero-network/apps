/**
 * A TEE fleet node admitted by hardware attestation (core's
 * `GroupMemberRole::ReadOnlyTee` / `RelayTee`). It is infrastructure, not a
 * person: never listed or counted as a member, shown as "TEE enabled" instead.
 */
export const isTeeRole = (role: string | undefined): boolean =>
  role === "ReadOnlyTee" || role === "RelayTee";

/**
 * Split a group's member rows into people and TEE nodes. The namespace and
 * every Born Open subgroup admit the TEE node as a member row, so every
 * member listing goes through here before it is shown or counted.
 */
export function splitTeeMembers<T extends { role?: string }>(
  rows: T[],
): { members: T[]; teeMembers: T[] } {
  return {
    members: rows.filter((m) => !isTeeRole(m.role)),
    teeMembers: rows.filter((m) => isTeeRole(m.role)),
  };
}

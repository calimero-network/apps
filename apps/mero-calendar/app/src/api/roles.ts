/**
 * Two roles, over core's capability bitmask.
 *
 * A team (namespace) member could do nothing but read: creating a calendar
 * inside the team needs `CAN_CREATE_CONTEXT`, which only the team's creator
 * held, and there was no way to give it to anybody. This maps the handful of
 * bits that matter onto one choice — Member or Admin — so promoting somebody is
 * a single action rather than five checkboxes nobody can rank.
 *
 * Bit values are core's, from `MemberCapabilities` in
 * `crates/context/config/src/lib.rs`. They are a stable wire format: core notes
 * that rejecting an unknown bit on the wire would make older peers fail to
 * decode the op and diverge, so bits are only ever added.
 */

/** Create a context — in this app, a calendar inside the team. */
export const CAN_CREATE_CONTEXT = 1 << 0;
/** Invite new people to the team. */
export const CAN_INVITE_MEMBERS = 1 << 1;
/**
 * Be inherited into `Open` subgroups beneath the team. Granted to ordinary
 * members by default and used as a DENY-list, so it is preserved rather than
 * recomputed when a role changes — clearing it would quietly cut somebody out
 * of the subgroups they already reach.
 */
export const CAN_JOIN_OPEN_SUBGROUPS = 1 << 2;
/** Add, remove and re-role other members. */
export const MANAGE_MEMBERS = 1 << 3;
/**
 * Set the name of the group, its members or its contexts.
 *
 * ⚠️ Part of Admin on purpose. Without it a promoted member can create a
 * calendar but cannot publish its NAME, so the calendar they just made shows up
 * on everyone else's node as a raw context id — the exact defect this app had
 * before names moved into metadata. Creating and naming are one act to a user.
 */
export const CAN_MANAGE_METADATA = 1 << 8;

/** Everything the Admin role confers. */
export const ADMIN_CAPABILITIES =
  CAN_CREATE_CONTEXT |
  CAN_INVITE_MEMBERS |
  MANAGE_MEMBERS |
  CAN_MANAGE_METADATA;

export type Role = "admin" | "member";

/**
 * Read a role out of a raw mask.
 *
 * Admin means holding ALL of `ADMIN_CAPABILITIES`, not merely some of them: a
 * member carrying one stray bit is still a member, and reporting them as an
 * admin would imply powers they do not have.
 */
export function roleOf(capabilities: number): Role {
  return (capabilities & ADMIN_CAPABILITIES) === ADMIN_CAPABILITIES
    ? "admin"
    : "member";
}

/**
 * The mask to store for `role`, preserving every bit the role does not speak
 * for.
 *
 * ⚠️ Returns `current` unchanged when it already reads as `role`, so a no-op
 * promotion does not rewrite governance state — and, more importantly, so
 * demoting never strips a bit this app knows nothing about. Core keeps adding
 * capabilities; a client that writes a whole mask from scratch silently revokes
 * whatever shipped after it.
 */
export function capabilitiesFor(role: Role, current: number): number {
  const next =
    role === "admin"
      ? current | ADMIN_CAPABILITIES
      : current & ~ADMIN_CAPABILITIES;
  // Demotion must not cost somebody their reach into open subgroups: that bit
  // is a deny-list for admins, not a grant that Admin implies.
  return role === "member" ? next | (current & CAN_JOIN_OPEN_SUBGROUPS) : next;
}

/** Label for the UI. */
export function roleLabel(role: Role): string {
  return role === "admin" ? "Admin" : "Member";
}

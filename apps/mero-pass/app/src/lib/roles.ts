// ── Who may do what in a space ───────────────────────────────────────────────
//
// Two roles, Admin and Member, on the space's NAMESPACE. And the point of this
// module is the gap between them:
//
//   ⚠️ A ROLE LABEL GRANTS NOTHING. `updateMemberRole` writes a string. What
//   the node actually enforces is the member's CAPABILITY BITMASK, and the two
//   are set by different calls. Promoting someone by role alone produces a row
//   that reads "Admin" beside a person who still gets a 403 from every admin
//   action — which is the worst possible outcome, because the UI and the node
//   now disagree and the UI looks right.
//
// So a role here is defined as a bitmask, the bitmask is derived from the calls
// this app actually makes, and `setMemberRole` writes BOTH and then reads the
// mask back to check it landed.
//
// ── Why the bits are derived rather than chosen ──────────────────────────────
//
// Every bit below is here because some code path in this app calls the admin
// endpoint that needs it. Written out so the next person changing a flow can
// see immediately which capability they are about to depend on:
//
//   createVault()   →  createGroupInNamespace   CAN_CREATE_SUBGROUP
//                      setGroupMetadata         CAN_MANAGE_METADATA
//                      setSubgroupVisibility    CAN_MANAGE_VISIBILITY
//                      createContext            CAN_CREATE_CONTEXT
//   mint*Invite()   →  createNamespaceInvitation CAN_INVITE_MEMBERS
//   setMemberRole() →  updateMemberRole         MANAGE_MEMBERS
//   enterVault()    →  joinSubgroupInheritance  CAN_JOIN_OPEN_SUBGROUPS
//
// A Member gets the last one and nothing else: they can open every vault in
// the space and read and write its secrets, which is the whole reason they were
// invited. Governance — making vaults, inviting people, changing roles — is the
// Admin set.
//
// ⚠️ THIS IS A REDUCTION IN WHAT AN INVITED MEMBER GETS. The first cut of this
// app set `defaultCapabilities: 15`, ported from mero-stream, which is
// CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS | CAN_JOIN_OPEN_SUBGROUPS |
// MANAGE_MEMBERS. In a video app that is fine. In a password manager it meant
// every person you invited to a space could invite further people and change
// anyone's role, including demoting you — so there was no role system to speak
// of, only the appearance of one. The default is MEMBER_CAPABILITIES now.

import { CAPABILITIES, hasCap } from '@calimero-network/mero-js';

/** The two roles this app offers on a space. */
export type SpaceRole = 'admin' | 'member';

/**
 * What a Member may do: enter the space's vaults, and nothing else.
 *
 * Note what this does NOT restrict — reading and writing the SECRETS inside a
 * vault. Those are contract calls against the vault's context, and every member
 * of that context can make them. Capabilities govern the group hierarchy, not
 * the application's own state; see the note on demotion in `setMemberRole`.
 */
export const MEMBER_CAPABILITIES = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS;

/** What an Admin may do: everything a Member may, plus govern the space. */
export const ADMIN_CAPABILITIES =
  MEMBER_CAPABILITIES |
  CAPABILITIES.CAN_CREATE_CONTEXT |
  CAPABILITIES.CAN_INVITE_MEMBERS |
  CAPABILITIES.MANAGE_MEMBERS |
  CAPABILITIES.CAN_CREATE_SUBGROUP |
  CAPABILITIES.CAN_MANAGE_VISIBILITY |
  CAPABILITIES.CAN_MANAGE_METADATA;

/**
 * Deliberately NOT granted to either role: `CAN_AUTHOR_ON_BEHALF` (write as
 * somebody else, under a warrant they signed) and `MANAGE_APPLICATION` (change
 * which bundle the space runs). Neither has a call site in this app, and a
 * password manager should not hand out a capability nothing uses — least of all
 * one that lets a node publish writes attributed to another person.
 */
export const DELIBERATELY_UNGRANTED = [
  'CAN_AUTHOR_ON_BEHALF',
  'MANAGE_APPLICATION',
  'CAN_DELETE_SUBGROUP',
] as const;

/** The capability bitmask a role is defined as. */
export function capabilitiesForRole(role: SpaceRole): number {
  return role === 'admin' ? ADMIN_CAPABILITIES : MEMBER_CAPABILITIES;
}

/**
 * Read the node's role string as one of ours.
 *
 * Core accepts and echoes several spellings — `Admin`, `admin`, `Owner`,
 * `Member`, `ReadOnly` — and a roster row is rendered from whatever it sends.
 * Anything that is not recognisably an admin is treated as a member: the safe
 * direction, because the alternative is showing someone admin controls that
 * will 403.
 *
 * `owner` maps to admin. The namespace creator is its owner, holds full
 * capabilities independently of the default, and must never be rendered as a
 * plain member of the space they made.
 */
export function normaliseRole(raw: string | null | undefined): SpaceRole {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'admin' || value === 'owner' ? 'admin' : 'member';
}

/** How a role reads in the UI. */
export function roleLabel(role: SpaceRole): string {
  return role === 'admin' ? 'Admin' : 'Member';
}

// ── What a capability mask permits ───────────────────────────────────────────
//
// Asked of the MASK, never of the role string. The UI gates its buttons on
// these so it cannot offer an action the node will refuse — the failure the
// role label alone produces.

/** Can this member create a vault? Needs all four bits `createVault` uses. */
export function canCreateVault(capabilities: number | null): boolean {
  if (capabilities === null) return false;
  return (
    hasCap(capabilities, CAPABILITIES.CAN_CREATE_SUBGROUP) &&
    hasCap(capabilities, CAPABILITIES.CAN_MANAGE_VISIBILITY) &&
    hasCap(capabilities, CAPABILITIES.CAN_CREATE_CONTEXT)
  );
}

/** Can this member mint an invitation to the space? */
export function canInvite(capabilities: number | null): boolean {
  return (
    capabilities !== null &&
    hasCap(capabilities, CAPABILITIES.CAN_INVITE_MEMBERS)
  );
}

/** Can this member promote and demote other people? */
export function canManageMembers(capabilities: number | null): boolean {
  return (
    capabilities !== null && hasCap(capabilities, CAPABILITIES.MANAGE_MEMBERS)
  );
}

/** Can this member open the space's vaults at all? */
export function canEnterVaults(capabilities: number | null): boolean {
  return (
    capabilities !== null &&
    hasCap(capabilities, CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS)
  );
}

/**
 * Which capabilities a role wants that a mask does not have.
 *
 * Exists to turn "the promotion did not work" into a sentence naming the
 * missing bits. A grant is not instantaneous — it is published as an op and
 * projected by the receiving node a moment later — so a mask read immediately
 * after a promotion can legitimately be short, and the honest report is which
 * bits have not arrived rather than a flat "failed".
 */
export function missingForRole(
  capabilities: number | null,
  role: SpaceRole,
): string[] {
  const wanted = capabilitiesForRole(role);
  const have = capabilities ?? 0;
  return Object.entries(CAPABILITIES)
    .filter(([, bit]) => hasCap(wanted, bit) && !hasCap(have, bit))
    .map(([name]) => name);
}

/** True when a mask already satisfies everything the role is defined as. */
export function satisfiesRole(
  capabilities: number | null,
  role: SpaceRole,
): boolean {
  return missingForRole(capabilities, role).length === 0;
}

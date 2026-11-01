// ── Who may do what in a team ───────────────────────────────────────────────
//
// A team is an organization. Its roles are the node's: `owner`, `admin`,
// `member`, `guest`. This app offers two of them, Admin and Member; an owner
// reads as an Admin and a guest as a Member. What the node enforces is the
// role plus the org's capability bits (`ORG_CAPABILITIES`): an owner or admin
// may do everything, a member what the org's default mask (or their own) says.
// `createTeam` sets the default to what v1 gave a Member at creation: add
// vaults and invite people.
//
// The UI gates its buttons on these, asked of the mask, so it does not offer
// an action the node will refuse:
//
//   createVault()        →  createApp                   CREATE_APP
//   invite-only vault    →  createTeam                  CREATE_TEAM (or admin)
//   mint*Invite()        →  invite                      INVITE_MEMBERS
//   setMemberRole() etc. →  setMember / removeMember    admin

import { ORG_CAPABILITIES } from '@calimero-network/mero-js';

/** The two roles this app offers on a team. */
export type TeamRole = 'admin' | 'member';

const has = (mask: number, bit: number) => (mask & bit) === bit;

export function normaliseRole(raw: string | null | undefined): TeamRole {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'admin' || value === 'owner' ? 'admin' : 'member';
}

export function roleLabel(role: TeamRole): string {
  return role === 'admin' ? 'Admin' : 'Member';
}

export function canCreateVault(capabilities: number | null): boolean {
  return (
    capabilities !== null && has(capabilities, ORG_CAPABILITIES.CREATE_APP)
  );
}

/** An invite-only vault also needs its own team. */
export function canCreateInviteOnlyVault(capabilities: number | null): boolean {
  return (
    canCreateVault(capabilities) &&
    has(capabilities ?? 0, ORG_CAPABILITIES.CREATE_TEAM)
  );
}

export function canInvite(capabilities: number | null): boolean {
  return (
    capabilities !== null && has(capabilities, ORG_CAPABILITIES.INVITE_MEMBERS)
  );
}

export function canManageMembers(capabilities: number | null): boolean {
  return (
    capabilities !== null && has(capabilities, ORG_CAPABILITIES.MANAGE_MEMBERS)
  );
}

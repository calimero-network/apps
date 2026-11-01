/**
 * Workspace roles and capabilities: who may do what in a workspace (an org).
 *
 * Core 1.0 keeps v1's three separate things, at the same bit values:
 *
 *   1. **the role**: `owner`, `admin`, `member` or `guest` on the org's member
 *      row, written by `setMember` (a passkey step-up). `owner` and `admin`
 *      hold every capability; `member` and `guest` do not.
 *   2. **a per-member capability override**: `capabilities[account]`, written
 *      by `setCapabilities(org, mask, passkey, { account })`.
 *   3. **the org's `defaultCapabilities`**: what a member with no override gets,
 *      written by `setCapabilities(org, mask, passkey)`.
 *
 * The screens show two roles, Admin and Member: `owner` reads as Admin (it
 * cannot be changed from here), `guest` as Member.
 *
 * Everything here is keyed by ACCOUNT id.
 */

import { ORG_CAPABILITIES } from '@calimero-network/mero-js';

/** The org capability bits the screens use, under the names they were written with. */
export const CAP = {
  CAN_CREATE_CONTEXT: ORG_CAPABILITIES.CREATE_APP,
  CAN_INVITE_MEMBERS: ORG_CAPABILITIES.INVITE_MEMBERS,
  ...ORG_CAPABILITIES,
} as const;

const hasCap = (mask: number, bit: number): boolean => (mask & bit) === bit;
const withCap = (mask: number, bit: number): number => mask | bit;
const withoutCap = (mask: number, bit: number): number => mask & ~bit;
const CAPABILITIES = ORG_CAPABILITIES;

/**
 * Every bit core currently assigns — what an `Admin` effectively holds, because
 * the role bypasses the mask.
 *
 * Derived rather than written out, so a bit added to the SDK is included here
 * without an edit. (It already caught one: core assigns `CAN_AUTHOR_ON_BEHALF`
 * at bit 9, which the drive probe's comment predates.)
 */
export const ALL_CAPABILITIES = Object.values(CAPABILITIES).reduce(
  (mask, bit) => mask | bit,
  0,
);

/**
 * What an ordinary member of THIS app needs to be useful: add a repo (a context)
 * and invite a teammate. Anything less and an invited member can see the
 * workspace and do nothing in it, which is the failure this app kept shipping.
 *
 * Deliberately not `MANAGE_MEMBERS` — promoting people is the admin's job — and
 * deliberately not the subgroup bits, because this app has no subgroups.
 */
export const MEMBER_CAPABILITIES = CAP.CAN_CREATE_CONTEXT | CAP.CAN_INVITE_MEMBERS;

export const ROLE_ADMIN = 'Admin';
export const ROLE_MEMBER = 'Member';
export type WorkspaceRole = typeof ROLE_ADMIN | typeof ROLE_MEMBER;

/**
 * Is this role the group admin?
 *
 * Case-insensitive on purpose. The probe sends `Admin`, but role is an untyped
 * `string` on the wire and this app has to READ whatever a node or another app
 * already wrote — comparing `=== 'Admin'` would silently classify an existing
 * `admin` as an ordinary member and hide the Role control from the one person
 * allowed to use it.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  const r = (role ?? '').trim().toLowerCase();
  return r === 'admin' || r === 'owner';
}

/** Normalise any spelling to the two roles this app offers. */
export function normaliseRole(role: string | null | undefined): WorkspaceRole {
  return isAdminRole(role) ? ROLE_ADMIN : ROLE_MEMBER;
}

/** The role a promote/demote should write, given the current one. */
export function toggledRole(role: string | null | undefined): WorkspaceRole {
  return isAdminRole(role) ? ROLE_MEMBER : ROLE_ADMIN;
}

export interface EffectiveInput {
  /** The member's `GroupMember.role`. */
  role: string | null | undefined;
  /** The per-member override from `getMemberCapabilities`; 0 = none set. */
  override?: number | null;
  /** The group's `defaultCapabilities`. */
  groupDefault?: number | null;
}

/**
 * What this member can actually DO right now.
 *
 * The whole point of this function is that none of the three inputs answers it
 * alone. An admin's `0` override does not mean "nothing"; a member's `0`
 * override means "use the group default".
 */
export function effectiveCapabilities({
  role,
  override,
  groupDefault,
}: EffectiveInput): number {
  if (isAdminRole(role)) return ALL_CAPABILITIES;
  const pinned = override ?? 0;
  if (pinned > 0) return pinned;
  return groupDefault ?? 0;
}

/** Re-exported so call sites need one import, and so the u32 coercion the SDK
 *  does (a high bit makes `&` yield a signed result) is not re-implemented. */
export const hasCapability = hasCap;

/** May this member promote/demote others? Admins always may. */
export function canManageMembers(input: EffectiveInput): boolean {
  return hasCapability(effectiveCapabilities(input), CAP.MANAGE_MEMBERS);
}

/** May this member add a repo (create a context)? */
export function canCreateRepo(input: EffectiveInput): boolean {
  return hasCapability(effectiveCapabilities(input), CAP.CAN_CREATE_CONTEXT);
}

/** May this member invite someone? */
export function canInvite(input: EffectiveInput): boolean {
  return hasCapability(effectiveCapabilities(input), CAP.CAN_INVITE_MEMBERS);
}

/**
 * The short, human list of what a capability mask permits — the bits this app
 * actually exercises, in the order a person cares about them.
 *
 * Shown in the members table instead of a bare number, because "3" tells a
 * person nothing and a role label alone is exactly the thing that lies.
 */
export function describeCapabilities(capabilities: number): string[] {
  const out: string[] = [];
  if (hasCapability(capabilities, CAP.CAN_CREATE_CONTEXT)) out.push('Add repos');
  if (hasCapability(capabilities, CAP.CAN_INVITE_MEMBERS)) out.push('Invite people');
  if (hasCapability(capabilities, CAP.MANAGE_MEMBERS)) out.push('Manage members');
  return out;
}

/**
 * Apply one permission toggle to an EXPLICIT override mask.
 *
 * Takes the member's effective mask as the base rather than their stored
 * override, because the override is usually `0` ("inherit the default") and
 * toggling one bit off that base would silently strip every inherited
 * permission the person already had.
 */
export function withCapability(base: number, bit: number, enabled: boolean): number {
  return enabled ? withCap(base, bit) : withoutCap(base, bit);
}

/**
 * Does the group's default leave an ordinary member unable to work?
 *
 * `setDefaultCapabilities` is called once, at namespace creation, and swallowed
 * on failure — so a namespace can exist whose every invited member can neither
 * add a repo nor invite anyone, with nothing anywhere saying so. This is what
 * the members page uses to offer the repair.
 */
export function defaultIsUsable(groupDefault: number | null | undefined): boolean {
  return hasCapability(groupDefault ?? 0, MEMBER_CAPABILITIES);
}

/** The default to write when repairing, preserving any extra bits already set. */
export function repairedDefault(groupDefault: number | null | undefined): number {
  return (groupDefault ?? 0) | MEMBER_CAPABILITIES;
}

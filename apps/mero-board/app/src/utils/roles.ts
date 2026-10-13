/**
 * Workspace roles and capabilities — who may do what in a namespace.
 *
 * ── The model, which is NOT "a role is a bag of permissions" ─────────────────
 *
 * Core keeps THREE separate things, and conflating any two of them is how a
 * promotion ends up granting nothing:
 *
 *   1. **`role`** — a string on the group member row (`GroupMember.role`),
 *      written by `updateMemberRole`. `Admin` **bypasses the capability bitmask
 *      entirely**; `Member` does not.
 *   2. **The per-member capability OVERRIDE** — a bitmask written by
 *      `setMemberCapabilities`, read by `getMemberCapabilities`. It is a
 *      SEPARATE field: `updateMemberRole` does not touch it, and reading it back
 *      after a promote returns exactly what it was before. **`0` means "no
 *      override"**, not "no permissions" — a member with 0 falls back to the
 *      group default.
 *   3. **The group's `defaultCapabilities`** — what a member with no override
 *      gets, set by `setDefaultCapabilities`.
 *
 * All three are pinned by a live-node probe in this monorepo:
 * `apps/mero-docs/logic/workflows/workflow-mero-docs-members.yml`,
 * which asserts the role round-trip leaves the override bitmask unchanged and
 * that non-preset bitmasks are stored verbatim. The role spellings below are the
 * ones it actually sends to a real node.
 *
 * The BITS are not redeclared here: `@calimero-network/mero-js` exports
 * `CAPABILITIES`, `hasCap`, `withCap` and `withoutCap`, mirroring core's
 * `MemberCapabilities`. Copying the numbers into the app would be one more place
 * to be wrong the next time core assigns a bit — core has bits 0..=9 today and
 * explicitly reserves the rest.
 *
 * ── Why promoting does NOT write capabilities ────────────────────────────────
 *
 * Because `Admin` bypasses the mask, writing `capabilities: 511` alongside the
 * role would grant nothing extra — and it would be actively harmful, because the
 * override PERSISTS through a later demote. Demote that person back to `Member`
 * and they would silently keep every bit an admin had. So promote/demote move
 * the ROLE and nothing else, and the override stays a deliberate, separate act.
 *
 * ── The two-systems trap ─────────────────────────────────────────────────────
 *
 * Namespace roles (here) and any in-contract role are different systems with
 * different principals. Everything in this file is keyed by a member's ACCOUNT —
 * `GroupMember.identity`, which is what `useNodeIdentity().identity.accountId`
 * returns for yourself. A context EXECUTOR key is also 64 hex and passing one
 * here type-checks and then authorises nobody.
 */

import { CAPABILITIES, hasCap, withCap, withoutCap } from '@calimero-network/mero-js';

/** Core's `MemberCapabilities` bits, straight from the SDK. */
export const CAP = CAPABILITIES;

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
  return (role ?? '').trim().toLowerCase() === 'admin';
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

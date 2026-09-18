// Promotion and demotion, and the two separate systems it has to drive.
//
// ⚠️ mero-drive has TWO role systems and they authorise different things.
// Naming them precisely is the whole point of this file, because an id from
// one looks exactly like an id from the other.
//
//   1. CORE GROUP ROLE + CAPABILITIES — per member of a core group (a
//      namespace root, or a folder's subgroup). Two orthogonal fields:
//        `role`         : Admin | Member | ReadOnly
//        `capabilities` : u32 bitmask
//      The server's `is_group_admin_or_has_capability` short-circuits on
//      `role === 'Admin'`, so an Admin bypasses the bitmask entirely and a
//      Member is exactly what their bitmask says. Keyed by ACCOUNT.
//      This governs: creating contexts and folders, inviting, managing
//      members, visibility, metadata.
//
//   2. THE REGISTRY CONTRACT'S OWNER / MANAGERS — state inside this app's
//      own WASM, gating `set_folder_role`, `add_manager` and friends. Also
//      keyed by ACCOUNT (as of the contract change that ships with this
//      file; it used to be keyed by DEVICE id, which is why no grant it ever
//      made authorised anybody).
//      This governs: per-folder Viewer/Editor/Manager roles, and who may
//      appoint further registry managers.
//
// Core admin does NOT imply registry admin. Promoting someone to Admin in
// system 1 and stopping there produces the exact failure this file exists to
// prevent: a person whose badge says Admin, who can create and invite, and who
// is refused by the contract the moment they try to set a folder role. So a
// promotion has to drive BOTH, and the UI has to say so when it can only drive
// one (only the registry OWNER may appoint managers).

import { CAPABILITIES, DEFAULT_NEW_MEMBER_CAPS, hasCap } from '@/constants/config';

/** Core group role. The server's vocabulary, spelled as the server spells it. */
export type GroupRole = 'Admin' | 'Member' | 'ReadOnly';

export const GROUP_ROLES: readonly GroupRole[] = ['Admin', 'Member', 'ReadOnly'];

/**
 * Normalise a server-reported role string.
 *
 * `listGroupMembers` rows carry `role?: string`, so the value is untyped and
 * may be absent on an inherited membership. 'Member' is the safe default: it
 * is what core gives a plain joiner, and defaulting to 'Admin' on an
 * unrecognised value would paint an admin badge on somebody who is not one.
 */
export function parseGroupRole(raw: string | undefined | null): GroupRole {
  if (raw === 'Admin' || raw === 'ReadOnly' || raw === 'Member') return raw;
  return 'Member';
}

export const ROLE_DESCRIPTIONS: Record<GroupRole, string> = {
  Admin:
    'Full control of this workspace — bypasses the permission list entirely.',
  Member: 'Permissions come from the list beside the role.',
  ReadOnly: 'Can see the workspace but cannot change anything.',
};

/**
 * The capability bitmask to write ALONGSIDE a role change, or `null` to leave
 * the member's existing bitmask untouched.
 *
 * ⚠️ This is the difference between a role change that works and one that only
 * relabels somebody.
 *
 * `role` and `capabilities` are separate server fields and changing one does
 * not touch the other. An Admin's bitmask is usually `0`, because while they
 * were an Admin nothing ever needed to set it — the admin short-circuit made
 * it irrelevant. Demote that Admin to Member and the short-circuit stops
 * applying, their `0` starts counting, and they land as a member who cannot
 * create a document, open a folder or invite anyone. Nothing errors: the
 * demotion succeeded, and the person simply cannot do anything. So a demotion
 * out of Admin seeds the Editor default rather than leaving the field alone.
 *
 * Promoting TO Admin returns `null` deliberately: the bitmask is not consulted
 * for an Admin, and widening it would leave a permanently over-granted mask
 * behind after a later demotion.
 *
 * ReadOnly returns `0`, because a ReadOnly member with capability bits is a
 * contradiction the server would honour — the bits, not the label, are what it
 * checks for a non-Admin.
 */
export function capabilitiesForRole(
  nextRole: GroupRole,
  currentCaps: number | null,
): number | null {
  switch (nextRole) {
    case 'Admin':
      return null;
    case 'ReadOnly':
      return 0;
    case 'Member':
      // Only seed when they have nothing. A member who already carries a
      // deliberate bitmask (Viewer, Manager, or a hand-picked set) keeps it —
      // re-selecting 'Member' on someone who is already a Member must not
      // silently reset their permissions to the default.
      return currentCaps === null || currentCaps === 0
        ? DEFAULT_NEW_MEMBER_CAPS
        : null;
  }
}

/** Mirrors the server's `is_group_admin_or_has_capability`. */
export function effectiveHasCap(
  role: GroupRole,
  caps: number | null,
  bit: number,
): boolean {
  if (role === 'Admin') return true;
  return caps !== null && hasCap(caps, bit);
}

export interface RoleChangeContext {
  /** The role being assigned. */
  nextRole: GroupRole;
  /** The target member's current role. */
  currentRole: GroupRole;
  /** True when the target row is the acting user. */
  isSelf: boolean;
  /** The acting user's own role on this group. */
  actorRole: GroupRole;
  /** The acting user's capability bitmask on this group. */
  actorCaps: number | null;
  /** How many members of this group currently hold the Admin role. */
  adminCount: number;
}

export interface RoleChangeVerdict {
  allowed: boolean;
  /** Present when `allowed` is false — shown to the user verbatim. */
  reason?: string;
}

/**
 * Whether a role change may be attempted, and why not when it may not.
 *
 * The server enforces its own rules and this does not replace them; it exists
 * so the UI refuses the two changes that are recoverable only by someone else,
 * rather than offering them and reporting a failure afterwards.
 */
export function canChangeRole(ctx: RoleChangeContext): RoleChangeVerdict {
  if (ctx.nextRole === ctx.currentRole) {
    return { allowed: false, reason: 'Already has that role.' };
  }
  if (
    !effectiveHasCap(ctx.actorRole, ctx.actorCaps, CAPABILITIES.MANAGE_MEMBERS)
  ) {
    return {
      allowed: false,
      reason: 'You need the "Manage members" permission to change roles.',
    };
  }
  // Self-demotion is a one-way door: drop your own Admin and the controls that
  // would let you undo it disappear with it, so the only way back is another
  // admin — and on a workspace of one there is no other admin.
  if (ctx.isSelf) {
    return {
      allowed: false,
      reason:
        'You cannot change your own role. Ask another admin to do it.',
    };
  }
  // The group would be left with nobody who can appoint an admin again.
  if (
    ctx.currentRole === 'Admin' &&
    ctx.nextRole !== 'Admin' &&
    ctx.adminCount <= 1
  ) {
    return {
      allowed: false,
      reason:
        'This is the only admin. Promote someone else first, or the workspace would be left with no one who can manage it.',
    };
  }
  return { allowed: true };
}

/**
 * What the role change implies for the REGISTRY contract's manager list.
 *
 * Core admin and registry manager are different grants in different systems
 * (see the file header), and a core-only promotion produces an "Admin" who is
 * refused by this app's own contract. Keeping the two in step is what makes
 * the badge mean what it says.
 *
 * Only the registry OWNER may appoint managers, so the caller has to be able
 * to tell "nothing to do" from "something to do that I cannot do" — hence
 * `'add'`/`'remove'` describe the INTENT, and whether it can be carried out is
 * the caller's question.
 */
export type RegistryManagerIntent = 'add' | 'remove' | 'none';

export function registryManagerIntent(
  currentRole: GroupRole,
  nextRole: GroupRole,
): RegistryManagerIntent {
  if (nextRole === 'Admin' && currentRole !== 'Admin') return 'add';
  if (currentRole === 'Admin' && nextRole !== 'Admin') return 'remove';
  return 'none';
}

/** Count the Admins in a member list. */
export function countAdmins(
  members: ReadonlyArray<{ role?: string }>,
): number {
  return members.filter((m) => parseGroupRole(m.role) === 'Admin').length;
}


/**
 * Who an "apply these defaults to existing members" sweep should actually
 * touch, and who it must leave alone.
 *
 * ⚠️ `setDefaultCapabilities` names what a FUTURE joiner inherits. It does not
 * reach a single existing member, which is the trap: an admin widens the
 * defaults, sees the save succeed, and every person already in the workspace
 * still cannot do the thing that was just granted. A sweep is the only way to
 * move them — and a naive sweep over the whole roster is worse than none:
 *
 *   * An Admin's bitmask is not consulted, so writing one is noise at best;
 *     if the defaults are narrow it also leaves a trap primed for the day they
 *     are demoted (see `capabilitiesForRole`).
 *   * A ReadOnly member's bitmask IS consulted — the label is not a separate
 *     gate — so handing them the default mask makes a "read-only" member who
 *     can write. Silently.
 *
 * So the sweep covers plain Members only, and the caller reports the skips
 * rather than hiding them.
 */
export interface DefaultsSweepPlan<T> {
  /** Members whose bitmask should be overwritten with the new default. */
  apply: T[];
  /** Admins — bitmask not consulted while they hold the role. */
  skippedAdmins: T[];
  /** ReadOnly members — a default mask here would grant them write access. */
  skippedReadOnly: T[];
}

export function planDefaultsSweep<T extends { role?: string }>(
  members: readonly T[],
): DefaultsSweepPlan<T> {
  const plan: DefaultsSweepPlan<T> = {
    apply: [],
    skippedAdmins: [],
    skippedReadOnly: [],
  };
  for (const m of members) {
    switch (parseGroupRole(m.role)) {
      case 'Admin':
        plan.skippedAdmins.push(m);
        break;
      case 'ReadOnly':
        plan.skippedReadOnly.push(m);
        break;
      case 'Member':
        plan.apply.push(m);
        break;
    }
  }
  return plan;
}

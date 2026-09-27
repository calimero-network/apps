// Promotion and demotion, and the two separate systems it has to drive.
//
// ⚠️ mero-docs has TWO role systems and they authorise different things.
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
import type { Role } from '@/generated/registry/RegistryClient';

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

/** The one role vocabulary people see, on workspace and folder rows alike. */
export type AccessRole = 'Admin' | 'Manager' | 'Editor' | 'ReadOnly';
/** A row's role, or 'Custom' when no role describes the underlying state. */
export type ShownRole = AccessRole | 'Custom';

export const ROLE_DESCRIPTIONS: Record<ShownRole, string> = {
  Admin: 'Full control, including who else is an admin.',
  Manager: 'Can manage people and settings, and edit.',
  Editor: 'Can create and edit documents.',
  ReadOnly: 'Can look but cannot change anything.',
  Custom: 'Permissions that match none of the roles. Pick a role to replace them.',
};

/** Display label for a role, sentence-cased. Option values keep the code spelling. */
export function roleDisplayLabel(role: string): string {
  return role === 'ReadOnly' ? 'Read only' : role;
}

const WORKSPACE_MANAGER_CAPS =
  DEFAULT_NEW_MEMBER_CAPS |
  CAPABILITIES.CAN_INVITE_MEMBERS |
  CAPABILITIES.MANAGE_MEMBERS |
  CAPABILITIES.CAN_MANAGE_VISIBILITY |
  CAPABILITIES.CAN_DELETE_SUBGROUP |
  CAPABILITIES.CAN_MANAGE_METADATA;

/** Folder-scope Manager bits: the workspace Manager's, minus creating. */
export const MANAGER_FOLDER_CAPS =
  CAPABILITIES.CAN_INVITE_MEMBERS |
  CAPABILITIES.MANAGE_MEMBERS |
  CAPABILITIES.CAN_MANAGE_VISIBILITY |
  CAPABILITIES.CAN_DELETE_SUBGROUP |
  CAPABILITIES.CAN_MANAGE_METADATA;

export const WORKSPACE_ROLES: readonly AccessRole[] = ['Admin', 'Manager', 'Editor', 'ReadOnly'];
export const FOLDER_ROLES = ['Manager', 'Editor', 'ReadOnly'] as const;
export type FolderAccessRole = (typeof FOLDER_ROLES)[number];

/**
 * What each workspace role writes. `caps: null` leaves the bitmask alone: the
 * server skips it for an Admin, and widening it would outlive a demotion.
 */
export const WORKSPACE_ROLE_GRANTS: Record<AccessRole, { role: GroupRole; caps: number | null }> = {
  Admin: { role: 'Admin', caps: null },
  Manager: { role: 'Member', caps: WORKSPACE_MANAGER_CAPS },
  Editor: { role: 'Member', caps: DEFAULT_NEW_MEMBER_CAPS },
  ReadOnly: { role: 'ReadOnly', caps: 0 },
};

/** What each folder role writes: the registry folder Role plus folder caps. */
export const FOLDER_ROLE_GRANTS: Record<FolderAccessRole, { role: Role; folderCaps: number }> = {
  Manager: { role: 'Manager', folderCaps: MANAGER_FOLDER_CAPS },
  Editor: { role: 'Editor', folderCaps: 0 },
  ReadOnly: { role: 'Viewer', folderCaps: 0 },
};

/** A workspace member's role; `null` while a non-admin's mask is loading. */
export function workspaceRoleOf(role: GroupRole, caps: number | null): ShownRole | null {
  if (role === 'Admin') return 'Admin';
  if (caps === null) return null;
  const match = WORKSPACE_ROLES.find(
    (r) => WORKSPACE_ROLE_GRANTS[r].role === role && WORKSPACE_ROLE_GRANTS[r].caps === caps,
  );
  return match ?? 'Custom';
}

/** A folder member's role. A core Admin or ReadOnly role on the folder
 *  overrides both fields: core bypasses them, or discards the writes. */
export function folderRoleOf(
  coreRole: GroupRole,
  registryRole: Role | null,
  folderCaps: number | null,
): ShownRole | null {
  if (coreRole !== 'Member') return coreRole;
  if (registryRole === null || folderCaps === null) return null;
  const match = FOLDER_ROLES.find(
    (r) =>
      FOLDER_ROLE_GRANTS[r].role === registryRole &&
      FOLDER_ROLE_GRANTS[r].folderCaps === folderCaps,
  );
  return match ?? 'Custom';
}

/** A folder member's role when only the registry Role is known, not the caps. */
export function folderRoleOfRegistryRole(coreRole: GroupRole, registryRole: Role): ShownRole {
  if (coreRole !== 'Member') return coreRole;
  return FOLDER_ROLES.find((r) => FOLDER_ROLE_GRANTS[r].role === registryRole) ?? 'Custom';
}

const ROLE_RANK: readonly AccessRole[] = ['ReadOnly', 'Editor', 'Manager', 'Admin'];
const ROLE_ABILITIES: Record<AccessRole, string> = {
  ReadOnly: '',
  Editor: 'create and edit documents',
  Manager: 'manage people and settings',
  Admin: 'make other people admins',
};

function joinAbilities(roles: readonly AccessRole[], conjunction: string): string {
  const parts = roles.map((r) => ROLE_ABILITIES[r]);
  return parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts[parts.length - 1]}`;
}

/** The confirmation body for a role change: what the member gains or loses. */
export function describeRoleChange(
  from: ShownRole,
  to: AccessRole,
  place: 'workspace' | 'folder',
): string {
  const at = ROLE_RANK.indexOf(to);
  if (from === 'Custom') {
    const gained = ROLE_RANK.slice(1, at + 1);
    return `Their custom permissions are replaced. ${
      gained.length
        ? `They will be able to ${joinAbilities(gained, 'and')}`
        : 'They will not be able to change anything'
    } in this ${place}.`;
  }
  const was = ROLE_RANK.indexOf(from);
  return at > was
    ? `They will be able to ${joinAbilities(ROLE_RANK.slice(was + 1, at + 1), 'and')} in this ${place}.`
    : `They will no longer be able to ${joinAbilities(ROLE_RANK.slice(at + 1, was + 1), 'or')} in this ${place}.`;
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
  nextRole: AccessRole;
  /** The target member's current role. */
  currentRole: ShownRole;
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
 *     are demoted (see `WORKSPACE_ROLE_GRANTS`).
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

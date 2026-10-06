// Promotion and demotion, and the two separate systems it has to drive.
//
// ⚠️ mero-docs has TWO role systems and they authorise different things.
// Naming them precisely is the whole point of this file, because an id from
// one looks exactly like an id from the other.
//
//   1. CORE GROUP ROLE + CAPABILITIES - per member of a core group (a
//      namespace root, or a folder's subgroup). Two orthogonal fields:
//        `role`         : Admin | Member | ReadOnly
//        `capabilities` : u32 bitmask
//      The server's `is_group_admin_or_has_capability` short-circuits on
//      `role === 'Admin'`, so an Admin bypasses the bitmask entirely and a
//      Member is exactly what their bitmask says. Keyed by ACCOUNT.
//      This governs: creating contexts and folders, inviting, managing
//      members, visibility, metadata.
//
//   2. THE REGISTRY CONTRACT'S OWNER / MANAGERS - state inside this app's
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
/** What a member may do with a folder's documents, as the app shows it. Core
 *  decides it: ReadOnly is a Viewer, Manager is the folder Manager caps. */
export type Role = 'Viewer' | 'Editor' | 'Manager';

/** Core group role. The server's vocabulary, spelled as the server spells it. */
export type GroupRole = 'Admin' | 'Member' | 'ReadOnly' | 'ReadOnlyTee' | 'RelayTee';

const JOIN = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS;

export const GROUP_ROLES: readonly GroupRole[] = [
  'Admin',
  'Member',
  'ReadOnly',
  'ReadOnlyTee',
  'RelayTee',
];

/** Both TEE roles come from attestation only, so no role control may change them. */
export function isTeeRole(role: GroupRole): boolean {
  return role === 'ReadOnlyTee' || role === 'RelayTee';
}

/**
 * Normalise a server-reported role string.
 *
 * `listGroupMembers` rows carry `role?: string`, so the value is untyped and
 * may be absent on an inherited membership. 'Member' is the safe default: it
 * is what core gives a plain joiner, and defaulting to 'Admin' on an
 * unrecognised value would paint an admin badge on somebody who is not one.
 */
export function parseGroupRole(raw: string | undefined | null): GroupRole {
  return GROUP_ROLES.find((role) => role === raw) ?? 'Member';
}

/** The one role vocabulary people see. Guest is workspace-only, Read only is folder-only. */
export type WorkspaceAccessRole = 'Admin' | 'Manager' | 'Editor' | 'Guest';
export type FolderAccessRole = 'Manager' | 'Editor' | 'ReadOnly';
export type AccessRole = WorkspaceAccessRole | FolderAccessRole;
/** A row's role, or 'Custom' when no role describes the underlying state.
 *  'Owner' is a folder's core admin and 'Tee' a TEE node, shown but never offered. */
export type ShownRole = AccessRole | 'Admin' | 'Owner' | 'Tee' | 'Custom';

export const ROLE_DESCRIPTIONS: Record<ShownRole, string> = {
  Admin: 'Full control, including who else is an admin.',
  Owner: 'Full control of this folder.',
  Manager: 'Can invite and remove people, and edit.',
  Editor: 'Can create and edit documents.',
  Guest: 'Sees only folders shared with them directly.',
  ReadOnly: 'Can open documents but not edit or comment.',
  Tee: 'A TEE node, admitted by attestation.',
  Custom: 'Permissions that match none of the roles. Pick a role to replace them.',
};

/** Display label for a role, sentence-cased. Option values keep the code spelling. */
export function roleDisplayLabel(role: string): string {
  if (role === 'ReadOnly') return 'Read only';
  return role === 'Tee' ? 'TEE node' : role;
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

export const WORKSPACE_ROLES: readonly WorkspaceAccessRole[] = ['Admin', 'Manager', 'Editor', 'Guest'];
export const FOLDER_ROLES: readonly FolderAccessRole[] = ['Manager', 'Editor', 'ReadOnly'];

/**
 * What each workspace role writes. `caps: null` leaves the bitmask alone: the
 * server skips it for an Admin, and widening it would outlive a demotion.
 */
export const WORKSPACE_ROLE_GRANTS: Record<
  WorkspaceAccessRole,
  { role: GroupRole; caps: number | null }
> = {
  Admin: { role: 'Admin', caps: null },
  Manager: { role: 'Member', caps: WORKSPACE_MANAGER_CAPS },
  Editor: { role: 'Member', caps: DEFAULT_NEW_MEMBER_CAPS },
  Guest: { role: 'ReadOnly', caps: 0 },
};

/** What each folder role writes: the core role in the folder's group and its
 *  folder caps - all of it in core, so a Restricted folder's roles live only
 *  where its members can read them. Core ReadOnly is what refuses writes;
 *  every role keeps CAN_JOIN_OPEN_SUBGROUPS, which reaches the Open sub-folders. */
export const FOLDER_ROLE_GRANTS: Record<
  FolderAccessRole,
  { coreRole: GroupRole; folderCaps: number }
> = {
  Manager: { coreRole: 'Member', folderCaps: MANAGER_FOLDER_CAPS | JOIN },
  Editor: { coreRole: 'Member', folderCaps: JOIN },
  ReadOnly: { coreRole: 'ReadOnly', folderCaps: JOIN },
};

/** A workspace member's role; `null` while a non-admin's mask is loading. */
export function workspaceRoleOf(role: GroupRole, caps: number | null): ShownRole | null {
  if (role === 'Admin') return 'Admin';
  if (isTeeRole(role)) return 'Tee';
  if (caps === null) return null;
  const match = WORKSPACE_ROLES.find(
    (r) => WORKSPACE_ROLE_GRANTS[r].role === role && WORKSPACE_ROLE_GRANTS[r].caps === caps,
  );
  return match ?? 'Custom';
}

// Roles that core decides whatever the caps say.
function coreOnlyRole(coreRole: GroupRole): 'Owner' | 'Tee' | null {
  if (coreRole === 'Admin') return 'Owner';
  return isTeeRole(coreRole) ? 'Tee' : null;
}

/** A folder member's role, from core alone; null while the caps load. A core
 *  Admin is the folder's Owner, whatever the caps say, because core bypasses them. */
export function folderRoleOf(
  coreRole: GroupRole,
  folderCaps: number | null,
): ShownRole | null {
  const fixed = coreOnlyRole(coreRole);
  if (fixed) return fixed;
  if (folderCaps === null) return null;
  const match = FOLDER_ROLES.find(
    (r) =>
      FOLDER_ROLE_GRANTS[r].coreRole === coreRole &&
      FOLDER_ROLE_GRANTS[r].folderCaps === (folderCaps | JOIN),
  );
  return match ?? 'Custom';
}

/** The documents role core grants: ReadOnly views, the Manager caps manage,
 *  anyone else edits. Null while the caps load. */
export function documentRoleOf(
  isAdmin: boolean,
  isReadOnly: boolean,
  folderCaps: number | null,
): Role | null {
  if (isAdmin) return 'Manager';
  if (folderCaps === null) return null;
  if (isReadOnly) return 'Viewer';
  return (folderCaps & MANAGER_FOLDER_CAPS) === MANAGER_FOLDER_CAPS ? 'Manager' : 'Editor';
}

// Lowest role first; each level lists what it adds over the one below.
const ROLE_LADDERS: Record<'workspace' | 'folder', [AccessRole, string[]][]> = {
  workspace: [
    ['Guest', []],
    ['Editor', ['open folders shared with the whole workspace', 'create folders and documents']],
    ['Manager', ['invite, rename and remove people']],
    ['Admin', ['make other people admins']],
  ],
  folder: [
    ['ReadOnly', []],
    ['Editor', ['edit and comment on its documents']],
    ['Manager', ['invite and remove its members', 'rename, restrict or delete it']],
  ],
};
const LOWEST_ROLE_CLAUSE: Record<'workspace' | 'folder', string> = {
  workspace: 'they will see only folders shared with them directly',
  folder: 'they can open its documents but not edit or comment on them',
};

function listOf(parts: string[], conjunction: string): string {
  return parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts[parts.length - 1]}`;
}

/** The confirmation body for a role change: what the node will let them do, gained or lost. */
export function describeRoleChange(
  from: ShownRole,
  to: AccessRole,
  place: 'workspace' | 'folder',
): string {
  const ladder = ROLE_LADDERS[place];
  const at = ladder.findIndex(([r]) => r === to);
  const was = ladder.findIndex(([r]) => r === from);
  const abilities = (lo: number, hi: number) =>
    ladder.slice(lo, hi).flatMap(([, a]) => a);
  const clauses: string[] = [];
  if (was < 0) {
    if (at > 0) clauses.push(`they will be able to ${listOf(abilities(1, at + 1), 'and')}`);
  } else if (at > was) {
    clauses.push(`they will be able to ${listOf(abilities(was + 1, at + 1), 'and')}`);
  } else {
    clauses.push(`they will no longer be able to ${listOf(abilities(at + 1, was + 1), 'or')}`);
  }
  if (at === 0) clauses.push(LOWEST_ROLE_CLAUSE[place]);
  const [first, ...rest] = clauses;
  const sentences = [
    `In this ${place}, ${first}.`,
    ...rest.map((c) => `${c[0].toUpperCase()}${c.slice(1)}.`),
  ];
  if (from === 'Custom') sentences.unshift('Their custom permissions are replaced.');
  return sentences.join(' ');
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
  /** Present when `allowed` is false - shown to the user verbatim. */
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
  // admin - and on a workspace of one there is no other admin.
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
 * to tell "nothing to do" from "something to do that I cannot do" - hence
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
 * move them - and a naive sweep over the whole roster is worse than none:
 *
 *   * An Admin's bitmask is not consulted, so writing one is noise at best;
 *     if the defaults are narrow it also leaves a trap primed for the day they
 *     are demoted (see `WORKSPACE_ROLE_GRANTS`).
 *   * A ReadOnly member's bitmask IS consulted - the label is not a separate
 *     gate - so handing them the default mask makes a "read-only" member who
 *     can write. Silently.
 *
 * So the sweep covers plain Members only, and the caller reports the skips
 * rather than hiding them.
 */
export interface DefaultsSweepPlan<T> {
  /** Members whose bitmask should be overwritten with the new default. */
  apply: T[];
  /** Admins - bitmask not consulted while they hold the role. */
  skippedAdmins: T[];
  /** ReadOnly members - a default mask here would grant them write access. */
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
      case 'ReadOnlyTee':
      case 'RelayTee':
        plan.skippedReadOnly.push(m);
        break;
      case 'Member':
        plan.apply.push(m);
        break;
    }
  }
  return plan;
}

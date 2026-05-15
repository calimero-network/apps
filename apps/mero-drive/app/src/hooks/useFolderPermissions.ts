// Folder-scope permissions — derived from TWO orthogonal sources:
//
//  1. The caller's core capability bitmask on the folder's subgroup
//     (`useMemberCaps`) — the same `MemberCapabilities` layout the
//     backend enforces via `is_group_admin_or_has_capability`
//     (core/context/group_store/membership.rs). Drives the
//     folder-admin affordances: rename / visibility / delete / invite /
//     manage-members. `isAdmin` (core group-admin role) bypasses it.
//
//  2. The Registry per-(folder, member) `Role` (`useFolderRole`) — the
//     "Viewer vs Editor vs Manager on documents" concept that does NOT
//     exist in the core bitmask (design spec §5.3 / §5.5). Drives
//     `canEditDocs`. An absent role row resolves to `Editor` (the WASM
//     default), so a brand-new member can edit by default; an explicit
//     `Viewer` downgrades them to read-only.
//
//  3. Registry ownership/managers — gates `canManagePermissions` (who
//     may change folder roles / see the sharing-panel admin section).
//     Fail-closed: until someone `claim_owner`s the registry, nobody is
//     an owner/manager. Read from `useDriveWorkspace().registryAdmin`
//     (fetched ONCE for the whole tree) — NOT via a per-row hook call.
//
// As of core PR #2261, Open subgroups inherit membership from the
// parent namespace via the server's parent-walk, so a namespace member
// with `CAN_JOIN_OPEN_SUBGROUPS` (default-on) gets real caps from the
// admin API directly — no app-layer fallback needed.
//
// `isMember` (folder subgroup membership) implies read access. Editing
// docs is `canEditDocs` — and it's deliberately CONSERVATIVE: a member
// can edit only once their registry Role has *definitively* resolved to
// non-Viewer (or the workspace has no Registry context at all, in which
// case there's no Role to wait on and we fall back to membership). A
// still-loading role, a role-fetch error, or a definitively-`Viewer`
// role all keep `canEditDocs` false — autosave must never persist a
// would-be Viewer's edits during the resolve window (core gates doc
// writes on folder membership only, so the app is the only guard).
//
// TODO(perf): split a lightweight `useFolderCaps(folderId)` that skips
// `useFolderRole` (and the registry Role read it does), for
// FolderContextMenu / NewFolderButton / FolderVisibilityToggle which
// only consume the cap-derived booleans, never `role`/`canEditDocs`/
// `canManagePermissions`. Today every folder row that renders a context
// menu fires an extra N×getFolderRole. (Out of scope for this round.)

import { CAPABILITIES, hasCap } from '../constants/config';
import type { Role } from '../api/registry/RegistryClient';
import { useMemberCaps } from './useMemberCaps';
import { useFolderRole } from './useFolderRole';
import { useDriveWorkspace } from './useDriveWorkspace';

export interface FolderPermissions {
  /** Member of the folder subgroup at all — true only when the caps
   *  fetch *succeeded* (`caps !== null && error === null`). A genuine
   *  member with the empty bitmask still has `caps === 0, error === null`
   *  so they count; a failed fetch (`caps === 0, error !== null`) does
   *  NOT, so consumers don't render write affordances on error. */
  isMember: boolean;
  /** Create a *sub*folder — note core only allows subgroups directly
   *  under the namespace root, so this is effectively a namespace-scope
   *  grant; kept here for the folder context menu's "new subfolder". */
  canCreateSubfolder: boolean;
  canRename: boolean; // isAdmin || CAN_MANAGE_METADATA
  canManageVisibility: boolean; // CAN_MANAGE_VISIBILITY
  /** Delete THIS folder. Per spec §5.5: a core group-admin always, or
   *  a member who both holds `CAN_DELETE_SUBGROUP` *and* has the
   *  registry `Manager` role on the folder. */
  canDelete: boolean;
  canInviteMembers: boolean; // CAN_INVITE_MEMBERS
  canManageMembers: boolean; // MANAGE_MEMBERS
  /** Edit documents in this folder. CONSERVATIVE: `isAdmin`, or a
   *  folder member whose registry `Role` has *definitively resolved* to
   *  non-Viewer — OR a folder member when the workspace has no Registry
   *  context at all (nothing to resolve, fall back to membership).
   *  While the role is still loading, on a role-fetch error, or on a
   *  definitive `Viewer`, this is `false` (the editor stays read-only
   *  so autosave can't persist a would-be Viewer's edits). Pair with
   *  `roleLoading` for a "checking permissions" hint. */
  canEditDocs: boolean;
  /** Change per-folder roles / see the sharing-panel admin section:
   *  `isAdmin`, or the registry owner/manager. */
  canManagePermissions: boolean;
  /** The caller's registry `Role` on this folder; `null` while loading
   *  OR when there's no Registry context. `'Editor'` once loaded if no
   *  explicit row exists (WASM default). */
  role: Role | null;
  /** True while the registry Role read is in flight (false if there's
   *  no Registry context to read from). */
  roleLoading: boolean;
  /** Non-null when the registry Role read failed. While set, editing is
   *  disabled (we can't confirm the caller isn't a Viewer). */
  roleError: Error | null;
  /** Aggregate: any folder-admin-ish power. Used to show the sharing
   *  panel / context-menu admin section. */
  canManageGroup: boolean;
  loading: boolean;
  /** Non-null when the underlying caps fetch failed. UI should show
   *  a retry affordance rather than treating loading:false + all-
   *  booleans-false as legitimate "no permissions." */
  error: Error | null;
  /** Re-run the membership probe. Use after an action that may have
   *  changed the caller's membership server-side (e.g. the join-via-
   *  inheritance call on the Open-folder card) — useMemberCaps's deps
   *  don't change on those flows, so the cached "not a member" stays
   *  unless something forces a re-fetch. */
  refetch: () => void;
}

export function useFolderPermissions(
  namespaceId: string,
  folderId: string,
): FolderPermissions {
  const { caps, isAdmin, error, refetch: refetchCaps } = useMemberCaps(
    namespaceId,
    folderId,
  );
  const {
    role,
    loading: roleLoading,
    error: roleError,
    registryAvailable,
  } = useFolderRole(folderId || null);
  const { isOwnerOrManager } = useDriveWorkspace().registryAdmin;

  const has = (bit: number) => isAdmin || (caps !== null && hasCap(caps, bit));
  const canRename = has(CAPABILITIES.CAN_MANAGE_METADATA);
  const canManageVisibility = has(CAPABILITIES.CAN_MANAGE_VISIBILITY);
  const hasDeleteCap = has(CAPABILITIES.CAN_DELETE_SUBGROUP);
  const canInviteMembers = has(CAPABILITIES.CAN_INVITE_MEMBERS);
  const canManageMembers = has(CAPABILITIES.MANAGE_MEMBERS);
  const canCreateSubfolder = has(CAPABILITIES.CAN_CREATE_SUBGROUP);

  const isMember = caps !== null && error === null;

  // Per spec §5.5: a core admin can always delete; otherwise the
  // member needs BOTH the delete cap and the registry Manager role.
  //
  // No-Registry-context fallback: when there's no registry to read
  // roles from (`!registryAvailable`), the Manager gate has nothing to
  // resolve and `role` would be `null` forever. In that case fall back
  // to the cap-only check — same approach as `canEditDocs` below for
  // its registry-unavailable branch. Without this, a non-admin holding
  // `CAN_DELETE_SUBGROUP` could never delete folders in a workspace
  // without a Registry context.
  const canDelete =
    isAdmin ||
    (hasDeleteCap && (registryAvailable ? role === 'Manager' : true));

  // Doc editing — CONSERVATIVE. Core only gates doc-context writes on
  // folder membership, so this app-layer check is the ONLY thing
  // stopping a registry-`Viewer` from autosaving edits during the role
  // resolve window. Therefore:
  //   - `isAdmin`                       → always.
  //   - a folder member, registry exists → only once `useFolderRole`
  //     has *definitively* resolved to a non-Viewer role (not while
  //     `roleLoading`, not on `roleError`).
  //   - a folder member, NO registry ctx → fall back to membership
  //     (there's no Role to wait on; `registryAvailable` is false and
  //     `role` would be `null` forever).
  const roleAllowsEdit = registryAvailable
    ? !roleLoading && roleError === null && role !== null && role !== 'Viewer'
    : true;
  const canEditDocs = isAdmin || (isMember && roleAllowsEdit);

  const canManagePermissions = isAdmin || isOwnerOrManager;

  return {
    isMember,
    canCreateSubfolder,
    canRename,
    canManageVisibility,
    canDelete,
    canInviteMembers,
    canManageMembers,
    canEditDocs,
    canManagePermissions,
    role,
    roleLoading,
    roleError,
    // Aggregate "folder-admin-ish" power — the union of the per-cap
    // grants. Used to reveal the sharing-panel admin section / context-
    // menu admin items. (Mirrors `canManageGroup` in namespace perms;
    // deliberately excludes `canCreateSubfolder`, which is a namespace-
    // scope grant, not a folder-admin signal.) Pure capability-bit
    // aggregate — `canManagePermissions` (registry owner/manager) is
    // an orthogonal concept gated separately by the sharing panel, so
    // it is NOT folded in here: a registry-only manager with zero
    // folder caps would otherwise see an admin context-menu trigger
    // (the ⋯ button) with an empty body underneath.
    canManageGroup:
      canRename ||
      canManageVisibility ||
      hasDeleteCap ||
      canInviteMembers ||
      canManageMembers,
    loading: caps === null,
    error,
    refetch: refetchCaps,
  };
}

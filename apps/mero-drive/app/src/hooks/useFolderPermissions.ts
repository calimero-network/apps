// Folder-scope permissions — 8-cap matrix derived from the caller's
// capabilities on the folder's subgroup. Used by FolderContextMenu,
// NewFolderButton, FolderVisibilityToggle, and the sharing panel to
// gate per-folder affordances.
//
// Keep the bit checks in sync with `utils/policyTable.ts::REQUIRED` —
// policyTable.can() is the action-oriented API, this hook is the
// permissions-oriented API. Same underlying bits.

import { CAP } from '../constants/config';
import { useMemberCaps } from './useMemberCaps';

export interface FolderPermissions {
  canRead: boolean;
  canWrite: boolean;
  canCreateSubfolder: boolean;
  canRename: boolean;
  canDelete: boolean;
  canManageGroup: boolean;
  canInviteMembers: boolean;
  canManageMembers: boolean;
  loading: boolean;
}

export function useFolderPermissions(
  namespaceId: string,
  folderId: string,
): FolderPermissions {
  const caps = useMemberCaps(namespaceId, folderId);
  const has = (bit: number) => caps !== null && (caps & bit) === bit;
  return {
    canRead: has(CAP.READ),
    canWrite: has(CAP.WRITE),
    canCreateSubfolder: has(CAP.CREATE_GROUP),
    canRename: has(CAP.MANAGE_GROUP),
    canDelete: has(CAP.MANAGE_GROUP),
    canManageGroup: has(CAP.MANAGE_GROUP),
    canInviteMembers: has(CAP.INVITE_MEMBERS),
    canManageMembers: has(CAP.MANAGE_MEMBERS),
    loading: caps === null,
  };
}

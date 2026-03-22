import type { FolderContextWithVisibility } from '@/api/FolderContextManager';

export type FolderAccessLevel =
  | 'open_joinable'
  | 'open_blocked'
  | 'restricted_allowed'
  | 'restricted_blocked';

export interface FolderAccessInfo extends FolderContextWithVisibility {
  accessLevel: FolderAccessLevel;
  isCreator: boolean;
  isAllowlisted: boolean;
  canJoin: boolean;
}

export interface FolderAccessContext {
  isAdmin: boolean;
  canJoinOpenContexts: boolean;
  currentMemberIdentity: string | null;
  allowlistsByContextId: Map<string, string[]>;
}

function identitiesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function computeFolderAccess(
  folder: FolderContextWithVisibility,
  ctx: FolderAccessContext,
): FolderAccessInfo {
  const { isAdmin, canJoinOpenContexts, currentMemberIdentity, allowlistsByContextId } = ctx;

  const allowlist = allowlistsByContextId.get(folder.context_id) ?? [];
  const isAllowlisted = currentMemberIdentity
    ? allowlist.some((id) => identitiesMatch(id, currentMemberIdentity))
    : false;

  const isCreator = false;

  let accessLevel: FolderAccessLevel;
  let canJoin: boolean;

  if (folder.visibility === 'open') {
    canJoin = isAdmin || canJoinOpenContexts;
    accessLevel = canJoin ? 'open_joinable' : 'open_blocked';
  } else {
    canJoin = isAdmin || isCreator || isAllowlisted;
    accessLevel = canJoin ? 'restricted_allowed' : 'restricted_blocked';
  }

  return {
    ...folder,
    accessLevel,
    isCreator,
    isAllowlisted,
    canJoin,
  };
}

export function computeAllFolderAccess(
  folders: FolderContextWithVisibility[],
  ctx: FolderAccessContext,
): FolderAccessInfo[] {
  return folders.map((f) => computeFolderAccess(f, ctx));
}

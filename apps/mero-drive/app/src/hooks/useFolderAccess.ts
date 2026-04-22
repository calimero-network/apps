// Orphan detection — a folder is "orphaned" when the caller is a
// direct member of the subgroup but NOT of its parent (e.g. they got
// added to a deep folder via INVITE_MEMBERS but the parent's
// restricted-visibility wall hides the chain above). The UI renders
// orphans under a synthetic "Shared with me" root so they're
// discoverable rather than floating invisibly.
//
// deriveOrphanState is exported separately so it can be tested
// without rendering the hook.

import { useMemo } from 'react';
import { ancestorsOf, FolderLite } from '../utils/ancestry';

export interface OrphanState {
  isOrphan: boolean;
  ancestorChain: string[];
}

export function deriveOrphanState(
  registryFolders: FolderLite[],
  adminSubgroupIds: Set<string>,
  folderId: string,
): OrphanState {
  if (!adminSubgroupIds.has(folderId)) {
    return { isOrphan: false, ancestorChain: [] };
  }
  const chain = ancestorsOf(registryFolders, folderId);
  const parent = chain[0];
  if (parent && !adminSubgroupIds.has(parent)) {
    return { isOrphan: true, ancestorChain: chain };
  }
  return { isOrphan: false, ancestorChain: [] };
}

export interface FolderAccessState {
  isMember: boolean;
  isOrphan: boolean;
  ancestorChain: string[];
}

// `useMemo` wrapper earns this function its `use*` name — consumers
// inside render paths get a stable reference across renders where
// inputs are unchanged. Pure callers (e.g. tests, one-shot checks)
// should call `deriveOrphanState` directly.
export function useFolderAccess(
  registryFolders: FolderLite[],
  adminSubgroupIds: Set<string>,
  folderId: string,
): FolderAccessState {
  return useMemo(() => {
    const { isOrphan, ancestorChain } = deriveOrphanState(
      registryFolders,
      adminSubgroupIds,
      folderId,
    );
    return {
      isMember: adminSubgroupIds.has(folderId),
      isOrphan,
      ancestorChain,
    };
  }, [registryFolders, adminSubgroupIds, folderId]);
}

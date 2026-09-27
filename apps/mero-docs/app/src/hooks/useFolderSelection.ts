import { useEffect } from 'react';
import type { RegistryFolderShape } from './useWorkspaceTree';

// The selected folder lives in the URL. A deleted or access-revoked folder
// leaves the tree for good, so drop it rather than leave "Loading folder…" up.
export function useFolderSelection(
  selectedFolderId: string | null,
  registry: RegistryFolderShape[] | null, // null until this workspace's list has loaded
  hiddenIds: Set<string>,
  onGone: () => void,
): void {
  useEffect(() => {
    if (!selectedFolderId || !registry) return;
    if (
      hiddenIds.has(selectedFolderId) ||
      !registry.some((f) => f.id === selectedFolderId)
    ) {
      onGone();
    }
  }, [selectedFolderId, registry, hiddenIds, onGone]);
}

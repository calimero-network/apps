import { useEffect, useState } from 'react';
import type { RegistryFolderShape } from './useWorkspaceTree';

// UI-only selected folder, not persisted.
export function useFolderSelection(
  namespaceId: string | null,
  registry: RegistryFolderShape[],
  hiddenIds: Set<string>,
): [string | null, (id: string | null) => void] {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  // Clear selected folder when the active namespace changes - stale
  // IDs across namespaces leak the wrong folder into the right pane.
  useEffect(() => {
    setSelectedFolderId(null);
  }, [namespaceId]);

  // A deleted or access-revoked folder leaves the tree for good, so drop it
  // rather than leave the pane waiting for it on "Loading folder…".
  useEffect(() => {
    if (!selectedFolderId) return;
    if (
      hiddenIds.has(selectedFolderId) ||
      !registry.some((f) => f.id === selectedFolderId)
    ) {
      setSelectedFolderId(null);
    }
  }, [selectedFolderId, registry, hiddenIds]);

  return [selectedFolderId, setSelectedFolderId];
}

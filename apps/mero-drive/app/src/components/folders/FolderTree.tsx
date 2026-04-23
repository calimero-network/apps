// Left-rail folder tree. Consumes the merged folder list from
// RegistryContext (assembled by useWorkspaceTree from admin
// subgroups + registry metadata) and renders it as a nested list
// via FolderTreeItem. Selection is owned by WorkspaceContext so
// the right-pane DocumentList (Phase 8-D) reads the same value.

import React, { useMemo } from 'react';
import { buildTree } from '@/utils/ancestry';
import { useRegistry } from '@/context/RegistryContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { FolderTreeItem } from './FolderTreeItem';

export function FolderTree() {
  const { folders, loading, error } = useRegistry();
  const { selectedFolderId, setSelectedFolder, namespaceId } = useWorkspace();

  const tree = useMemo(
    () => buildTree(folders.map((f) => ({ id: f.id, parent_id: f.parent_id }))),
    [folders],
  );
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  if (!namespaceId) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Pick a workspace to see your folders.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-3 text-xs text-muted-foreground">Loading folders…</div>
    );
  }

  if (error) {
    return (
      <div
        className="p-3 text-xs text-destructive"
        title={error.message}
      >
        Failed to load folders
      </div>
    );
  }

  if (tree.roots.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No folders yet. Create one to get started.
      </div>
    );
  }

  return (
    <ul className="space-y-0.5 p-2">
      {tree.roots.map((n) => (
        <FolderTreeItem
          key={n.id}
          node={n}
          byId={byId}
          depth={0}
          selectedId={selectedFolderId}
          onSelect={setSelectedFolder}
        />
      ))}
    </ul>
  );
}

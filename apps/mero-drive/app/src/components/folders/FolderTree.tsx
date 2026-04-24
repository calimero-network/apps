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
import { NewFolderButton } from './NewFolderButton';

// Stage → user-readable label. Anything past 'idle' is a spinner-state
// message. Keeps the UI honest about WHICH step is slow instead of a
// generic "Loading…" that hides identity/bootstrap errors.
const STAGE_LABELS: Record<string, string> = {
  'resolving-identity': 'Resolving identity…',
  'bootstrapping-registry': 'Bootstrapping workspace…',
  'loading-subgroups': 'Loading subgroups…',
  'loading-folders': 'Loading folders…',
};

export function FolderTree() {
  const { folders, loading, stage, error } = useRegistry();
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
      <div className="p-3 text-xs text-muted-foreground">
        {STAGE_LABELS[stage] ?? 'Loading…'}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="p-3 text-xs text-destructive break-words"
        title={error.message}
      >
        <div className="font-medium mb-1">Failed to load folders</div>
        <div className="font-mono opacity-80">{error.message}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Folders
        </span>
        {/* Top-level new-folder CTA. Self-gates: NewFolderButton
            returns null when the caller lacks canCreateSubgroup on
            the namespace root. */}
        <NewFolderButton parentFolderId={null} label="New" />
      </div>

      {tree.roots.length === 0 ? (
        <div className="p-3 text-xs text-muted-foreground">
          No folders yet. Create one to get started.
        </div>
      ) : (
        <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
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
      )}
    </div>
  );
}

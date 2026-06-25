// Left-rail folder tree. Consumes the merged folder list from
// useDriveWorkspace (assembled internally from admin subgroups +
// registry metadata) and renders it as a nested list via
// FolderTreeItem. Selection is also owned by useDriveWorkspace so
// the right-pane DocumentList reads the same value.

import React, { useCallback, useMemo, useState } from 'react';
import { buildTree } from '@/utils/ancestry';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { FolderTreeItem } from './FolderTreeItem';
import { NewFolderButton } from './NewFolderButton';

// Map useDriveWorkspace's DriveLoadingStage values to user-facing
// labels. Keys that don't appear here fall through to a generic
// "Loading…" — the stage enum is defined in hooks/useDriveWorkspace.ts.
const STAGE_LABELS: Record<string, string> = {
  'awaiting-auth': 'Waiting for sign-in…',
  'resolving-namespaces': 'Loading workspaces…',
  'resolving-registry-context': 'Bootstrapping workspace…',
  'loading-subgroups': 'Loading subgroups…',
  'loading-folders': 'Loading folders…',
  'syncing-from-peers': 'Syncing workspace from peers…',
};

interface FolderTreeProps {
  selectedDocId: string | null;
  onOpenDoc: (folderId: string, docId: string) => void;
}

export function FolderTree({ selectedDocId, onOpenDoc }: FolderTreeProps) {
  const {
    folders,
    loading,
    stage,
    error,
    selectedFolderId,
    setSelectedFolder,
    namespaceId,
  } = useDriveWorkspace();

  // Expansion is owned here (was per-row state) so it survives the
  // frequent useMemo recompute of `folders` on SSE refetch and so a
  // future "expand all" can live in one place. Default: nothing
  // forced open — the user expands what they want.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
            returns null when the caller lacks canCreateFolder on
            the namespace root. */}
        <NewFolderButton parentFolderId={null} label="New" />
      </div>

      {tree.roots.length === 0 ? (
        <div className="p-3 text-xs text-muted-foreground">
          No folders yet. Create one to get started.
        </div>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto p-2">
          {tree.roots.map((n) => (
            <FolderTreeItem
              key={n.id}
              node={n}
              byId={byId}
              selectedId={selectedFolderId}
              onSelect={setSelectedFolder}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
              selectedDocId={selectedDocId}
              onOpenDoc={onOpenDoc}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

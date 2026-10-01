// Left-rail folder tree. Consumes the merged folder list from
// useDriveWorkspace (assembled internally from admin subgroups +
// registry metadata) and renders it as a nested list via
// FolderTreeItem. Selection is also owned by useDriveWorkspace so
// the right-pane DocumentList reads the same value.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ancestorsOf, buildTree } from '@/utils/ancestry';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { folderLoadErrorMessage } from '@/lib/folderLoadError';
import { Button } from '@/components/ui/button';
import { FolderTreeItem } from './FolderTreeItem';
import { NewFolderButton } from './NewFolderButton';
import { NewFolderDialog } from './NewFolderDialog';
import { NoFoldersState } from './NoFolderStates';
import { SidebarSectionHeader } from '@/components/workspace/SidebarNav';

// Map useDriveWorkspace's DriveLoadingStage values to user-facing
// labels. Keys that don't appear here fall through to a generic
// "Loading…" - the stage enum is defined in hooks/useDriveWorkspace.ts.
const STAGE_LABELS: Record<string, string> = {
  'awaiting-auth': 'Waiting for sign-in…',
  'resolving-namespaces': 'Loading workspaces…',
  'resolving-registry-context': 'Setting up your workspace…',
  'loading-subgroups': 'Preparing folders…',
  'loading-folders': 'Loading folders…',
  'syncing-from-peers': 'Syncing workspace from peers…',
};

interface FolderTreeProps {
  selectedDocId: string | null;
  onSelectFolder: (folderId: string) => void;
  onOpenDoc: (folderId: string, docId: string) => void;
  // Controlled when the caller persists section state; otherwise the tree keeps its own.
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function FolderTree({
  selectedDocId,
  onSelectFolder,
  onOpenDoc,
  collapsed: collapsedProp,
  onToggleCollapsed,
}: FolderTreeProps) {
  const [collapsedLocal, setCollapsedLocal] = useState(false);
  const collapsed = collapsedProp ?? collapsedLocal;
  const toggleCollapsed =
    onToggleCollapsed ?? (() => setCollapsedLocal((c) => !c));
  const {
    folders,
    loading,
    stage,
    error,
    selectedFolderId,
    namespaceId,
    refetch,
  } = useDriveWorkspace();

  // Expansion is owned here (was per-row state) so it survives the
  // frequent useMemo recompute of `folders` on SSE refetch and so a
  // future "expand all" can live in one place. Default: nothing
  // forced open - the user expands what they want.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Idempotent, so callers never read a possibly stale `expanded` to decide.
  const expand = useCallback((id: string) => {
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const tree = useMemo(
    () => buildTree(folders.map((f) => ({ id: f.id, parent_id: f.parent_id }))),
    [folders],
  );
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  // Reveal the routed folder (and an open doc's row) once per route, as soon as
  // it has loaded; a later refetch must not reopen a folder the user closed.
  const revealKey = selectedFolderId && `${selectedFolderId}:${selectedDocId ?? ''}`;
  const revealedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedFolderId || !byId.has(selectedFolderId)) return;
    if (revealedKey.current === revealKey) return;
    revealedKey.current = revealKey;
    const ids = ancestorsOf(folders, selectedFolderId);
    if (selectedDocId) ids.push(selectedFolderId);
    setExpanded((prev) =>
      ids.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids]),
    );
  }, [revealKey, selectedFolderId, selectedDocId, byId, folders]);

  // Loading flags pulse on every refetch. Once this workspace's tree has shown,
  // a later pulse or failed re-read keeps it, and any dialog opened from it, mounted.
  const [shownFor, setShownFor] = useState<string | null>(null);
  const settled = !loading && !error;
  useEffect(() => {
    if (settled && namespaceId) setShownFor(namespaceId);
  }, [settled, namespaceId]);
  const shown = !!namespaceId && shownFor === namespaceId;

  // The top-level create dialog lives here, not in either button: a fresh
  // window's first read can come back empty, so the tree swaps the empty state's
  // button for the header's when the folders land - and a dialog owned by the
  // unmounted button would vanish under the user's typing.
  const [creatingFolder, setCreatingFolder] = useState(false);
  const openCreateFolder = useCallback(() => setCreatingFolder(true), []);

  // The raw error is implementation detail; keep it in the console and show plain copy.
  useEffect(() => {
    if (error) console.error('Failed to load folders', error);
  }, [error]);

  if (!namespaceId) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Pick a workspace to see your folders.
      </div>
    );
  }

  if (loading && !shown) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 p-3 text-xs text-muted-foreground"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        <span>{STAGE_LABELS[stage] ?? 'Loading…'}</span>
      </div>
    );
  }

  if (error && !shown) {
    return (
      <div className="p-3 text-xs text-destructive break-words">
        <div className="font-medium mb-1">Failed to load folders</div>
        <div className="opacity-80">{folderLoadErrorMessage(error)}</div>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    // The sidebar scrolls as one, so the tree takes its natural height.
    <div className="flex flex-col">
      <SidebarSectionHeader
        title="Folders"
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        action={
          // Self-gates on canCreateFolder. Hidden while empty because
          // NoFoldersState carries the create action then.
          tree.roots.length > 0 && (
            <NewFolderButton
              parentFolderId={null}
              label="New"
              variant="ghost"
              className="h-6 gap-1 rounded-md px-1.5 text-xs [&_svg]:size-[13px]"
              onOpen={openCreateFolder}
            />
          )
        }
      />

      {collapsed ? null : tree.roots.length === 0 ? (
        <NoFoldersState onCreateFolder={openCreateFolder} />
      ) : (
        <ul className="space-y-px px-2 pb-2">
          {tree.roots.map((n) => (
            <FolderTreeItem
              key={n.id}
              node={n}
              byId={byId}
              selectedId={selectedFolderId}
              onSelect={onSelectFolder}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
              onExpand={expand}
              selectedDocId={selectedDocId}
              onOpenDoc={onOpenDoc}
            />
          ))}
        </ul>
      )}
      {creatingFolder && (
        <NewFolderDialog parentFolderId={null} onClose={() => setCreatingFolder(false)} />
      )}
    </div>
  );
}

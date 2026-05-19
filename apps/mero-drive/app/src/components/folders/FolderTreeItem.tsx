// Single recursive row in the FolderTree. Renders the folder's
// alias with an optional color chip and restricted-visibility lock
// icon, and recurses into its children. Selection is a controlled
// prop — parent owns the selectedId state.
//
// Also hosts the per-row action trigger (FolderContextMenu, shown
// on hover) and the inline-rename state — the rename action fires
// from the context menu but the editing surface lives here because
// the alias text is owned by this row's render.

import React, { useCallback, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, Lock, Folder } from 'lucide-react';
import type { TreeNode } from '@/utils/ancestry';
import { safeColor } from '@/utils/validation';
import { MAX_ALIAS_LENGTH } from '@/constants/config';
import type { MergedFolder } from '@/hooks/useWorkspaceTree';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderOperations } from '@/hooks/useFolderOperations';
import { FolderContextMenu } from './FolderContextMenu';

interface Props {
  node: TreeNode;
  byId: Map<string, MergedFolder>;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FolderTreeItem({
  node,
  byId,
  depth,
  selectedId,
  onSelect,
}: Props) {
  const folder = byId.get(node.id);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // Re-entry guard for submitRename. Without this, pressing Enter
  // starts the async rename, and if the input loses focus before
  // the await resolves (which it does when setRenaming(false) fires
  // and unmounts the input), the native blur event fires a second
  // submitRename with the same state — `folder.alias` hasn't yet
  // refreshed from the registry, so the same-name guard doesn't
  // catch it and the rename runs twice.
  const submitRenameInFlightRef = useRef(false);

  const { rootGroupId, folders, registryClient, applicationId, refetch } =
    useDriveWorkspace();
  const ops = useFolderOperations(
    registryClient,
    rootGroupId,
    folders.map((f) => ({
      id: f.id,
      parent_id: f.parent_id,
    })),
    applicationId,
    refetch,
  );

  const startRename = useCallback(() => {
    setRenameValue(folder?.alias ?? '');
    setRenaming(true);
  }, [folder?.alias]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
    setRenameValue('');
  }, []);

  const submitRename = useCallback(async () => {
    if (submitRenameInFlightRef.current) return;
    const next = renameValue.trim();
    if (!next || next.length > MAX_ALIAS_LENGTH || next === folder?.alias) {
      cancelRename();
      return;
    }
    submitRenameInFlightRef.current = true;
    try {
      await ops.rename(node.id, next);
    } catch (e) {
      console.error('rename failed', e);
    } finally {
      submitRenameInFlightRef.current = false;
      setRenaming(false);
    }
  }, [renameValue, folder?.alias, ops, node.id, cancelRename]);

  return (
    <li>
      <div
        className={`group flex items-center gap-1.5 rounded px-2 py-1 text-sm cursor-pointer ${
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'text-foreground hover:bg-muted'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => !renaming && onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              // Only stop propagation when the button actually has
              // a toggle to perform; swallowing clicks on the leaf-
              // node spacer version of this button would make the
              // left-edge of a leaf row unclickable for selection.
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          // Inert spacer for leaf rows. A <span> doesn't intercept
          // the row-level onClick, so the full row stays clickable
          // for selection.
          <span className="inline-block h-4 w-4" aria-hidden />
        )}
        {(() => {
          const color = safeColor(folder?.color);
          return color ? (
            <span
              className="h-2.5 w-2.5 rounded-sm border border-border/50"
              style={{ backgroundColor: color }}
              aria-hidden
            />
          ) : (
            <Folder className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          );
        })()}
        {renaming ? (
          <input
            className="flex-1 h-6 min-w-0 rounded border border-input bg-background px-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={renameValue}
            maxLength={MAX_ALIAS_LENGTH}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={submitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
          />
        ) : (
          <span className="flex-1 truncate">
            {folder?.alias ?? node.id.slice(0, 8)}
          </span>
        )}
        {folder?.visibility === 'Restricted' && !renaming && (
          <Lock
            className="h-3 w-3 text-muted-foreground"
            aria-label="Restricted"
          />
        )}
        {folder && !renaming && (
          <FolderContextMenu
            folderId={node.id}
            currentVisibility={folder.visibility}
            onRename={startRename}
          />
        )}
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => (
            <FolderTreeItem
              key={c.id}
              node={c}
              byId={byId}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

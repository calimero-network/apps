// Per-folder actions dropdown, triggered by a "⋯" icon button on
// each FolderTreeItem row. Each menu item is gated by the relevant
// permission hook — the dropdown only renders items the caller
// actually has rights to use.
//
// Delete uses a confirm() prompt as a minimal guard for this phase;
// a dedicated confirm dialog component is deferred to Phase 8-C
// along with the sharing panel.
//
// Rename flows through a parent-supplied callback because the
// inline-edit UI lives on FolderTreeItem (switches the row from
// text to input in place). This component owns the "open rename"
// intent, not the editing surface.

import React, { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderOperations } from '@/hooks/useFolderOperations';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { FolderVisibilityToggle } from './FolderVisibilityToggle';
import { NewFolderDialog } from './NewFolderDialog';

interface Props {
  folderId: string;
  currentVisibility: 'Inherit' | 'Restricted';
  onRename: () => void;
}

export function FolderContextMenu({
  folderId,
  currentVisibility,
  onRename,
}: Props) {
  const { namespaceId, rootGroupId } = useDriveWorkspace();
  const { folders, registryClient } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const ops = useFolderOperations(
    registryClient,
    rootGroupId,
    folders.map((f) => ({
      id: f.id,
      parent_id: f.parent_id,
      visibility: f.visibility,
    })),
  );

  const [showNewSub, setShowNewSub] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const confirm = useConfirm();

  // Don't render the trigger at all if the caller can't do
  // anything. Keeps the tree visually clean for read-only viewers.
  const anyAction =
    perms.canRename ||
    perms.canCreateSubfolder ||
    perms.canManageGroup ||
    perms.canDelete;
  if (!anyAction) return null;

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete folder?',
      body: (
        <>
          This deletes the folder and every folder inside it, along with
          their documents. This action can't be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await ops.remove(folderId);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setActionError(err.message);
      console.error('folder delete failed', err);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label="Folder actions"
            onClick={(e) => {
              // Don't bubble to the row's selection handler.
              e.stopPropagation();
            }}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {perms.canRename && (
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
          )}
          {perms.canCreateSubfolder && (
            <DropdownMenuItem onClick={() => setShowNewSub(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New subfolder
            </DropdownMenuItem>
          )}
          <FolderVisibilityToggle
            folderId={folderId}
            current={currentVisibility}
            onError={(err) => setActionError(err.message)}
          />
          {perms.canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {showNewSub && (
        <NewFolderDialog
          parentFolderId={folderId}
          onClose={() => setShowNewSub(false)}
        />
      )}

      {actionError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive shadow"
        >
          {actionError}
          <button
            className="ml-2 underline"
            onClick={() => setActionError(null)}
            type="button"
          >
            dismiss
          </button>
        </div>
      )}
    </>
  );
}

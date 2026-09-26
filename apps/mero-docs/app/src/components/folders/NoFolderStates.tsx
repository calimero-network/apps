// Empty states that lead to folder creation: the main pane with no folder
// selected, and the sidebar of a workspace that has no folders yet.

import React from 'react';
import { Folder } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { NewFolderButton } from './NewFolderButton';

function describeNoSelection(hasFolders: boolean, canCreate: boolean) {
  if (hasFolders) {
    return {
      title: 'Select a folder',
      body: canCreate
        ? 'Documents live in folders. Pick one from the sidebar, or create a new one.'
        : "Documents live in folders. Pick one from the sidebar to see what's inside.",
    };
  }
  return {
    title: 'No folders yet',
    body: canCreate
      ? 'Documents live in folders. Create the first one to get started.'
      : 'Documents live in folders. A workspace owner needs to create one or share one with you.',
  };
}

export function SelectFolderState() {
  const { namespaceId, rootGroupId, folders } = useDriveWorkspace();
  const perms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const { title, body } = describeNoSelection(
    folders.length > 0,
    perms.canCreateFolder,
  );
  return (
    // Body waits for permissions so admins never see the read-only copy flash.
    <EmptyState icon={Folder} title={title} body={perms.loading ? undefined : body}>
      <NewFolderButton parentFolderId={null} variant="default" />
    </EmptyState>
  );
}

// The main pane carries the primary New folder action; this one stays secondary.
export function NoFoldersState() {
  return (
    <div className="flex flex-col items-start gap-2 p-3 text-xs text-muted-foreground">
      No folders yet.
      <NewFolderButton parentFolderId={null} />
    </div>
  );
}

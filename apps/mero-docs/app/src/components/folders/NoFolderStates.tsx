// Empty states that lead to folder creation: the main pane with no folder
// selected, and the sidebar of a workspace that has no folders yet.

import React from 'react';
import { Folder } from 'lucide-react';
import { EmptyState } from '@/components/workspace/EmptyState';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { NewFolderButton } from './NewFolderButton';

function useCanCreateFolder(): boolean {
  const { namespaceId, rootGroupId } = useDriveWorkspace();
  return useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '')
    .canCreateFolder;
}

export function SelectFolderState() {
  const canCreate = useCanCreateFolder();
  return (
    <EmptyState
      icon={Folder}
      title="Select a folder"
      body={
        canCreate
          ? 'Documents live in folders. Pick one from the sidebar, or create a new one.'
          : "Documents live in folders. Pick one from the sidebar to see what's inside."
      }
    >
      <NewFolderButton parentFolderId={null} variant="default" />
    </EmptyState>
  );
}

export function NoFoldersState() {
  const canCreate = useCanCreateFolder();
  return (
    <EmptyState
      icon={Folder}
      className="h-auto px-4 py-8"
      title="No folders yet"
      body={
        canCreate
          ? 'Folders hold your documents. Create one to get started.'
          : 'Folders shared with you will show up here.'
      }
    >
      <NewFolderButton parentFolderId={null} variant="default" />
    </EmptyState>
  );
}

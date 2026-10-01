import React from 'react';
import { NewFolderButton } from './NewFolderButton';

// The sidebar of a workspace with no folders; Home carries the primary New folder action.
export function NoFoldersState({ onCreateFolder }: { onCreateFolder?: () => void } = {}) {
  return (
    <div className="flex flex-col items-start gap-2 p-3 text-xs text-muted-foreground">
      No folders yet.
      <NewFolderButton parentFolderId={null} onOpen={onCreateFolder} />
    </div>
  );
}

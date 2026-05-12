// Permission-gated button that opens the NewFolderDialog.
//
// Two modes:
//   - parentFolderId=null → top-level folder; gated by
//     useNamespacePermissions.canCreateFolder on the namespace
//     root group (core's CAN_CREATE_SUBGROUP — root-only).
//   - parentFolderId=<id> → nested under a specific parent; gated
//     by useFolderPermissions.canCreateSubfolder on that folder.
//
// Renders nothing (not a disabled stub) when the caller lacks the
// cap — keeps the UI uncluttered. Callers wanting a persistent
// "Create" affordance even without permission should render a
// tooltip-explained disabled button themselves.

import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { NewFolderDialog } from './NewFolderDialog';

interface Props {
  parentFolderId: string | null;
  label?: string;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'ghost' | 'default';
}

export function NewFolderButton({
  parentFolderId,
  label = 'New folder',
  size = 'sm',
  variant = 'outline',
}: Props) {
  const { namespaceId, rootGroupId } = useDriveWorkspace();
  const nsPerms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const folderPerms = useFolderPermissions(
    namespaceId ?? '',
    parentFolderId ?? '',
  );
  const [open, setOpen] = useState(false);

  // Root-level create → namespace caps; nested → per-folder caps.
  const allowed = parentFolderId
    ? folderPerms.canCreateSubfolder
    : nsPerms.canCreateFolder;

  if (!namespaceId || !rootGroupId) return null;
  if (!allowed) return null;

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className="gap-1"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        {label}
      </Button>
      {open && (
        <NewFolderDialog
          parentFolderId={parentFolderId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Main pane for an open folder with no document selected: offers New document
// to editors, and says "No documents yet" once the folder is known to be empty.

import React from 'react';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useDocs } from '@/hooks/useDocs';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useCreateDocument } from '@/hooks/useCreateDocument';
import { EmptyState } from '@/components/ui/empty-state';

interface Props {
  folderId: string;
  onOpenDoc: (folderId: string, docId: string) => void;
}

function describeFolder(isEmpty: boolean, canEdit: boolean) {
  if (isEmpty) {
    return {
      title: 'No documents yet',
      body: canEdit
        ? 'Create the first document in this folder.'
        : 'When someone adds a document to this folder, it will show up in the sidebar.',
    };
  }
  return {
    title: 'No document open',
    body: canEdit
      ? 'Pick a document from the sidebar, or create a new one.'
      : 'Pick a document from the sidebar to start reading.',
  };
}

export function FolderEmptyState({ folderId, onOpenDoc }: Props) {
  const { namespaceId } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const docs = useDocs(folderId);
  const { create: onCreate, creating, error } = useCreateDocument(
    docs,
    folderId,
    onOpenDoc,
  );
  const isEmpty = !!docs.contextId && !docs.loading && docs.list.length === 0;
  const { title, body } = describeFolder(isEmpty, perms.canEditDocs);

  return (
    <EmptyState icon={FileText} title={title} body={body}>
      {perms.canEditDocs && docs.contextId && (
        <Button className="gap-1" size="sm" disabled={creating} onClick={onCreate}>
          <Plus className="h-4 w-4" />
          {creating ? 'Creating…' : 'New document'}
        </Button>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          Create failed: {error}
        </p>
      )}
    </EmptyState>
  );
}

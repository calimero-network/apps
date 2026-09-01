// Main-pane content for "a folder is open but no document is selected".
// A quiet invitation to act: a New-document CTA (for editors) that
// creates an Untitled doc and opens it inline. Read-only members get
// guidance to pick a doc from the sidebar instead.

import React, { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useDocs } from '@/hooks/useDocs';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';

interface Props {
  folderId: string;
  onOpenDoc: (folderId: string, docId: string) => void;
}

export function FolderEmptyState({ folderId, onOpenDoc }: Props) {
  const { namespaceId } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const docs = useDocs(folderId);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const id = await docs.create({ title: 'Untitled' });
      onOpenDoc(folderId, id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <FileText
          className="mx-auto h-8 w-8 text-muted-foreground/60"
          aria-hidden
        />
        <h2 className="mt-3 text-lg font-semibold text-foreground">
          No document open
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {perms.canEditDocs
            ? 'Pick a document from the sidebar, or create a new one.'
            : 'Pick a document from the sidebar to start reading.'}
        </p>
        {perms.canEditDocs && docs.contextId && (
          <Button
            className="mt-4 gap-1.5"
            size="sm"
            disabled={creating}
            onClick={onCreate}
          >
            <Plus className="h-4 w-4" />
            {creating ? 'Creating…' : 'New document'}
          </Button>
        )}
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            Create failed: {error}
          </p>
        )}
      </div>
    </div>
  );
}

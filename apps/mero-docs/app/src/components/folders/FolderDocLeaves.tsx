// Document leaves for ONE expanded folder. Mounted by FolderTreeItem
// only while its folder is expanded, so useDocs(folderId) — which
// resolves a per-folder Calimero context — fires lazily rather than
// for every folder in the tree on load. Collapsing the folder
// unmounts this and releases the subscription.

import React, { useEffect } from 'react';
import { FileText } from 'lucide-react';
import { useDocs } from '@/hooks/useDocs';
import { useCreateDocument } from '@/hooks/useCreateDocument';

interface Props {
  folderId: string;
  selectedDocId: string | null;
  onOpenDoc: (folderId: string, docId: string) => void;
  /** A "New document" request is waiting; cleared through onCreateStarted. */
  createPending: boolean;
  onCreateStarted: () => void;
}

export function FolderDocLeaves({
  folderId,
  selectedDocId,
  onOpenDoc,
  createPending,
  onCreateStarted,
}: Props) {
  const docs = useDocs(folderId);
  const newDoc = useCreateDocument(docs, folderId, onOpenDoc);
  const { contextId } = docs;
  const { create } = newDoc;

  // Waits for the context: a request can arrive before a just-expanded folder resolves it.
  useEffect(() => {
    if (!contextId || !createPending) return;
    onCreateStarted();
    void create();
  }, [contextId, createPending, onCreateStarted, create]);

  // Context not yet bound: a brief muted hint, never a red error —
  // folders sync from peers and the context lands a moment later.
  if (!docs.contextId) {
    if (docs.error) return null; // access-denied / no membership: silent
    if (docs.contextResolving) {
      return (
        <li className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
          {/* Chevron-width spacer so the hint lines up with doc rows. */}
          <span className="h-4 w-4 shrink-0" aria-hidden />
          Syncing…
        </li>
      );
    }
    return null;
  }

  if (docs.error) return null;
  if (docs.loading && docs.list.length === 0) return null;

  return (
    <>
      {newDoc.error && (
        <li className="px-2 py-1 text-xs text-destructive" role="alert">
          Couldn't create a document: {newDoc.error}
        </li>
      )}
      {docs.list.map((d) => {
        const isSelected = d.id === selectedDocId;
        return (
          <li key={d.id}>
            <button
              type="button"
              data-testid="doc-row"
              data-doc-id={d.id}
              aria-current={isSelected ? 'page' : undefined}
              onClick={() => onOpenDoc(folderId, d.id)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                isSelected
                  ? 'bg-selected text-selected-foreground font-medium'
                  : 'text-foreground hover:bg-muted/60'
              }`}
            >
              {/* Spacer matching the folder row's chevron column so doc
                  icons align under sibling subfolder icons. */}
              <span className="h-4 w-4 shrink-0" aria-hidden />
              <FileText
                className={`h-3.5 w-3.5 shrink-0 ${
                  isSelected ? 'text-primary-ink' : 'text-muted-foreground'
                }`}
                aria-hidden
              />
              <span className="truncate">{d.title || 'Untitled'}</span>
            </button>
          </li>
        );
      })}
    </>
  );
}

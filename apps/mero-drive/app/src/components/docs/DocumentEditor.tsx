// Data-layer bridge between EditorShell and the document CRDT. There is no
// autosave, no snapshot and no save sequence: the title and the body are each
// bound to their own CRDT hook, which turns an edit into a delta and a peer's
// event into a re-read. EditorShell owns every piece of visual chrome.

import React, { useCallback, useEffect, useState } from 'react';
import { EditorShell } from '@/components/editor/EditorShell';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { MAX_ALIAS_LENGTH } from '@/constants/config';
import type { DocDto } from '@/generated/docs/DocsClient';
import { useDocs } from '@/hooks/useDocs';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useFugueBody } from '@/hooks/useFugueBody';
import { useFugueTitle } from '@/hooks/useFugueTitle';

interface Props {
  folderId: string;
  docId: string;
  onClose: () => void;
}

export function DocumentEditor({ folderId, docId, onClose }: Props) {
  const { namespaceId } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  // Doc-edit ability is the registry Role, gated through useFolderPermissions.
  // A caps-fetch failure leaves this false, so the editor opens read-only
  // rather than writable on error.
  const canEditDocs = perms.canEditDocs;
  const docs = useDocs(folderId);
  const {
    remove: docsRemove,
    get: docsGet,
    contextId: docsContextId,
    refetch: docsRefetch,
    client,
  } = docs;
  const confirm = useConfirm();

  // Metadata only; the title and the body are read through their own hooks.
  const [doc, setDoc] = useState<DocDto | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const title = useFugueTitle({
    client,
    docId: docsContextId ? docId : null,
    contextId: docsContextId,
  });
  const body = useFugueBody({
    client,
    docId: docsContextId ? docId : null,
    contextId: docsContextId,
  });

  useEffect(() => {
    if (!docsContextId) return;
    let alive = true;
    setLoadError(null);
    setDoc(null);
    docsGet(docId)
      .then((loaded) => alive && setDoc(loaded))
      .catch((cause: unknown) => {
        if (!alive) return;
        setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => {
      alive = false;
    };
  }, [docId, docsContextId, docsGet]);

  const onDocumentNameChange = useCallback(
    (next: string) => {
      const trimmed = next.trim().slice(0, MAX_ALIAS_LENGTH) || 'Untitled';
      title.setTitle(trimmed);
      // The sidebar renders the title, so let the list know it moved.
      void docsRefetch();
    },
    [title, docsRefetch],
  );

  const onDelete = useCallback(async () => {
    if (!doc) return;
    const ok = await confirm({
      title: 'Delete document?',
      body: (
        <>
          Delete <code className="text-xs">{title.title || 'Untitled'}</code>?
          This can't be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await docsRemove(doc.id);
      onClose();
    } catch (cause) {
      console.error('delete failed', cause);
    }
  }, [confirm, doc, docsRemove, onClose, title.title]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-destructive">
            Couldn't load document
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loadError.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <EditorShell
      documentName={title.title || 'Untitled'}
      // Every mutation handler gates on canEditDocs so a read-only viewer
      // cannot rename, edit or delete; EditorShell's readOnly flag is the
      // second layer, not the authoritative one.
      onDocumentNameChange={canEditDocs ? onDocumentNameChange : undefined}
      onBack={onClose}
      onDelete={canEditDocs ? onDelete : undefined}
      onContentChange={canEditDocs ? body.onContentChange : undefined}
      readOnly={!canEditDocs}
      initialContent={body.content}
      saveStatus={body.status}
      lastSavedAt={doc ? new Date(doc.updated_at / 1_000_000) : null}
      isAppReady={!!namespaceId && !!docsContextId}
      isLoading={body.loading}
    />
  );
}

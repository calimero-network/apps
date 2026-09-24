// Data-layer bridge between EditorShell and the document CRDT. There is no
// autosave, no snapshot and no save sequence: the title and the body are each
// bound to their own CRDT hook, which turns an edit into a delta and a peer's
// event into a re-read. EditorShell owns every piece of visual chrome.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EditorShell } from '@/components/editor/EditorShell';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { DocDto } from '@/generated/docs/DocsClient';
import { useDocs } from '@/hooks/useDocs';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useFugueBody, type BodyEditor } from '@/hooks/useFugueBody';
import { useFugueTitle } from '@/hooks/useFugueTitle';
import { useBodyCursors, type CursorEditor } from '@/hooks/useBodyCursors';
import { useDocPresence } from '@/hooks/useDocPresence';
import { useTitleCursors } from '@/hooks/useTitleCursors';
import type { DriveEditor } from '@/components/editor/blocknote/schema';
import { DocumentInspector } from './DocumentInspector';

const TITLE_REFETCH_MS = 800; // one list refetch per rename, not per keystroke

interface Props {
  folderId: string;
  docId: string;
  onClose: () => void;
}

export function DocumentEditor({ folderId, docId, onClose }: Props) {
  const { namespaceId, selfIdentity, namespaceMemberNames } =
    useDriveWorkspace();
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

  const identity = useMemo(
    () =>
      selfIdentity
        ? {
            id: selfIdentity,
            name: namespaceMemberNames[selfIdentity] || 'Anonymous',
          }
        : null,
    [selfIdentity, namespaceMemberNames],
  );
  const openDocId = docsContextId ? docId : null;

  const { peers, publish } = useDocPresence(docsContextId, openDocId, identity);
  const title = useFugueTitle({
    client,
    docId: openDocId,
    contextId: docsContextId,
    publish,
  });
  const [editor, setEditor] = useState<DriveEditor | null>(null);
  const body = useFugueBody({
    client,
    docId: openDocId,
    contextId: docsContextId,
    editor: editor as unknown as BodyEditor | null,
  });
  const onEditorReady = useCallback(
    (ready: DriveEditor) => setEditor(ready),
    [],
  );
  const titleCarets = useTitleCursors(client, openDocId, peers, title.title);
  useBodyCursors({
    client,
    docId: openDocId,
    editor: editor as CursorEditor | null,
    peers,
    publish,
    revision: body.revision,
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

  // The sidebar renders the title, so let the list catch up once typing stops.
  useEffect(() => {
    if (!title.title) return;
    const timer = setTimeout(() => void docsRefetch(), TITLE_REFETCH_MS);
    return () => clearTimeout(timer);
  }, [title.title, docsRefetch]);

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
    <>
      <EditorShell
        documentName={title.title || 'Untitled'}
        // Every mutation handler gates on canEditDocs so a read-only viewer
        // cannot rename, edit or delete; EditorShell's readOnly flag is the
        // second layer, not the authoritative one.
        title={
          canEditDocs
            ? {
                value: title.title,
                onChange: title.onChange,
                onSelect: title.onSelect,
                inputRef: title.inputRef,
                carets: titleCarets,
              }
            : undefined
        }
        onBack={onClose}
        onDelete={canEditDocs ? onDelete : undefined}
        onUndo={canEditDocs ? body.undo : undefined}
        onRedo={canEditDocs ? body.redo : undefined}
        onContentChange={canEditDocs ? body.onContentChange : undefined}
        readOnly={!canEditDocs}
        initialContent={body.content}
        saveStatus={body.status}
        lastSavedAt={doc ? new Date(doc.updated_at / 1_000_000) : null}
        isAppReady={!!namespaceId && !!docsContextId}
        isLoading={body.loading}
        onEditorReady={onEditorReady}
      />
      <DocumentInspector client={client} docId={docId} />
    </>
  );
}

// Collaborative document editor — data-layer bridge for the Yjs path, mounted
// by DocumentEditor when `COLLAB_YJS_ENABLED` is on.
//
//   - BODY: owned by the collaborative Y.Doc (`useCollabDoc` →
//     CollabEditorShell). No content autosave / seq-guard / body reconcile here
//     — the provider streams updates and folds in peers'.
//   - TITLE: still LWW (loaded via get_doc, renamed via edit_doc; concurrent
//     renames settle by HLC), live-refreshed on SSE so a peer's rename shows up.
//   - DELETE + PERMISSIONS: identical gating to the LWW path.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CollabEditorShell } from '@/components/editor/collab/CollabEditorShell';
import { useCollabDoc } from '@/components/editor/collab/useCollabDoc';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { MAX_ALIAS_LENGTH } from '@/constants/config';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useContextEvents } from '@/hooks/useContextEvents';
import { useDocs } from '@/hooks/useDocs';

interface Props {
  folderId: string;
  docId: string;
  onClose: () => void;
}

// Deterministic per-identity cursor color (stable across sessions): hash the
// identity to a hue, fixed saturation/lightness for legibility on both themes.
function colorForIdentity(identity: string): string {
  let h = 0;
  for (let i = 0; i < identity.length; i++) {
    h = (h * 31 + identity.charCodeAt(i)) % 360;
  }
  return `hsl(${h}, 70%, 50%)`;
}

export function CollabDocumentEditor({ folderId, docId, onClose }: Props) {
  const { namespaceId, selfIdentity } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const canEditDocs = perms.canEditDocs;
  const docs = useDocs(folderId);
  const { edit: docsEdit, remove: docsRemove, get: docsGet, contextId } = docs;
  const confirm = useConfirm();

  const { ydoc, provider, ready, loadError, retry } = useCollabDoc(
    folderId,
    docId,
  );

  const [documentName, setDocumentName] = useState('Untitled');
  const titleSavingRef = useRef(false);

  // Load the title once the context resolves, and refresh on SSE so a peer's
  // rename propagates. The body is not touched here (the Y.Doc owns it).
  const refreshTitle = useCallback(() => {
    if (!contextId) return;
    if (titleSavingRef.current) return;
    void docsGet(docId)
      .then((d) => {
        setDocumentName(d.title || 'Untitled');
      })
      .catch((e: unknown) => {
        // A transient title fetch failure must not rip the editor away — keep
        // the last known title; the next SSE event retries.
        console.warn('[CollabDocumentEditor] title refresh failed', e);
      });
  }, [contextId, docId, docsGet]);

  useEffect(() => {
    refreshTitle();
  }, [refreshTitle]);
  useContextEvents(contextId, refreshTitle);

  const onDocumentNameChange = useCallback(
    async (next: string) => {
      const title = next.trim().slice(0, MAX_ALIAS_LENGTH) || 'Untitled';
      setDocumentName(title);
      titleSavingRef.current = true;
      try {
        await docsEdit(docId, { title });
      } catch (e) {
        console.error('rename failed', e);
      } finally {
        titleSavingRef.current = false;
      }
    },
    [docsEdit, docId],
  );

  const onDelete = useCallback(async () => {
    const ok = await confirm({
      title: 'Delete document?',
      body: (
        <>
          Delete <code className="text-xs">{documentName || 'Untitled'}</code>?
          This can&apos;t be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await docsRemove(docId);
      onClose();
    } catch (e) {
      console.error('delete failed', e);
    }
  }, [confirm, docsRemove, docId, documentName, onClose]);

  // Initial pull failed: no hydrated doc to show (an empty editable doc would
  // risk overwriting remote content). Surface the error with a retry.
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-destructive">
            Couldn&apos;t load document
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loadError.message}
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const user = {
    name: selfIdentity ? `${selfIdentity.slice(0, 6)}…` : 'Anonymous',
    color: colorForIdentity(selfIdentity ?? 'anon'),
  };

  const appReady = !!namespaceId && !!contextId;

  // Until the Y.Doc + provider exist (context resolving / initial pull), show
  // loading chrome rather than a flash of empty doc.
  if (!ydoc || !provider) {
    return <CollabLoading />;
  }

  return (
    <CollabEditorShell
      documentName={documentName}
      onDocumentNameChange={canEditDocs ? onDocumentNameChange : undefined}
      onBack={onClose}
      onDelete={canEditDocs ? onDelete : undefined}
      readOnly={!canEditDocs}
      isAppReady={appReady}
      isLoading={!ready}
      ydoc={ydoc}
      provider={provider}
      user={user}
    />
  );
}

function CollabLoading() {
  return (
    <div className="flex items-center justify-center h-full bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Loading document...</p>
      </div>
    </div>
  );
}

// Save-orchestrating wrapper around EditorShell. Loads the doc via
// useDocs.get, binds EditorShell's controlled props to local state
// + the save state machine, and persists:
//   - content: debounced autosave (900ms idle) + flush on unmount
//   - title:   explicit onDocumentNameChange; flushes pending
//     content autosave first so a rename in the autosave window
//     can't drop the last keystrokes
//   - delete:  uses useConfirm before calling useDocs.remove
//
// EditorShell owns every piece of visual chrome (header with back/
// delete, toolbar, status bar with save state dot). This file is
// purely the data-layer bridge — all UI changes should live in
// EditorShell so the shell stays a single shared source of truth.
//
// Save-state transitions:
//   saved         (initial after load, no unsaved edits)
//   unsaved       (content changed, debounce pending)
//   saving        (editDoc in flight)
//   saved         (editDoc resolved)
//   error         (editDoc threw — next edit resets to unsaved)
//
// Refs vs state — what goes where:
//   `lastSavedContentRef`   — the most recent server-acked HTML.
//     Used for equality checks in onContentChange + the unmount
//     flush. NOT kept in React state because updating it after
//     every save would force EditorShell's initialContent effect
//     to overwrite the editor's current HTML with the just-saved
//     (stale-relative-to-user-typing) content — silently reverting
//     any keystrokes between the save firing and resolving.
//   `workingContentRef`     — mirrors what Tiptap has RIGHT NOW,
//     updated on every onContentChange. Used so the unmount flush
//     and beforeunload handler can read the latest HTML without
//     being captured by a stale closure.
//   `docRef`                — mirrors `doc` for the same closure-
//     capture reason (the unmount-flush effect closes over the
//     render that set up the effect, which is always the
//     pre-load null render).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorShell } from '@/components/editor/EditorShell';
import type { SaveStatus } from '@/components/editor/types';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { MAX_ALIAS_LENGTH } from '@/constants/config';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useDocs } from '@/hooks/useDocs';
import type { DocDto } from '@/api/docs/DocsClient';

interface Props {
  folderId: string;
  docId: string;
  onClose: () => void;
}

// Idle window before an autosave fires. Kept intentionally short:
// users typing in short bursts get their saves through between
// paragraphs without explicit Save. If the window is longer, the
// "unsaved" state lingers and the crash-recovery surface widens.
const AUTOSAVE_DEBOUNCE_MS = 900;

export function DocumentEditor({ folderId, docId, onClose }: Props) {
  const { namespaceId } = useWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const docs = useDocs(folderId);
  const confirm = useConfirm();

  // The loaded doc. `null` while fetching; `null + not loading`
  // when the doc has been deleted remotely.
  const [doc, setDoc] = useState<DocDto | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  // Working copies of name/content owned by the editor. EditorShell
  // renders from `doc` on first mount (via initialContent), then the
  // user's typing feeds `workingContentRef` so autosave + beforeunload
  // flush know what to persist.
  const [documentName, setDocumentName] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // See the file header's "Refs vs state" note for why these live
  // in refs instead of state.
  const workingContentRef = useRef<string>('');
  const lastSavedContentRef = useRef<string>('');
  const docRef = useRef<DocDto | null>(null);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    [],
  );

  const cancelPendingAutosave = useCallback(() => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  }, []);

  // Load the doc once the docs context resolves. Depending on
  // `docs.contextId` in addition to `docId` is load-bearing:
  // useDocs resolves the context asynchronously, so `docs.get` on
  // first render would throw "docs context not ready" and the
  // effect would never re-run (since docId wouldn't change).
  useEffect(() => {
    if (!docs.contextId) {
      // Stay in loading until the context is resolved. Error from
      // useDocs (resolveError) is surfaced via the `docs.error`
      // path, separate from this load's loadError.
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setDoc(null);
    docs
      .get(docId)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        setDocumentName(d.title || 'Untitled');
        workingContentRef.current = d.content;
        lastSavedContentRef.current = d.content;
        setSaveStatus('saved');
        setLastSavedAt(new Date(d.updated_at * 1000));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const err = e instanceof Error ? e : new Error(String(e));
        setLoadError(err);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // `docs.get` is a stable useCallback; we intentionally depend
    // only on docId + contextId so the effect doesn't re-run on
    // every docs-list refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, docs.contextId]);

  const persistContent = useCallback(
    async (content: string) => {
      const currentDoc = docRef.current;
      if (!currentDoc) return;
      if (content === lastSavedContentRef.current) {
        // Nothing changed since the last server ack — skip the
        // round-trip. Tiptap re-emits the same HTML on unrelated
        // events (selection / focus), this guard prevents spamming.
        return;
      }
      setSaveStatus('saving');
      try {
        await docs.edit(currentDoc.id, { content });
        if (unmountedRef.current) return;
        // Record the server-acked content WITHOUT triggering
        // EditorShell's initialContent effect. Updating doc.content
        // here would make EditorShell call setContent(savedHTML),
        // which if the user typed more during the in-flight save
        // would silently revert those keystrokes.
        lastSavedContentRef.current = content;
        setSaveStatus('saved');
        setLastSavedAt(new Date());
      } catch (e: unknown) {
        if (unmountedRef.current) return;
        setSaveStatus('error');
        console.error('autosave failed', e);
      }
    },
    [docs],
  );

  const onContentChange = useCallback(
    (html: string) => {
      workingContentRef.current = html;
      if (html === lastSavedContentRef.current) {
        setSaveStatus('saved');
        return;
      }
      setSaveStatus('unsaved');
      cancelPendingAutosave();
      autosaveTimeoutRef.current = setTimeout(() => {
        autosaveTimeoutRef.current = null;
        void persistContent(html);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [cancelPendingAutosave, persistContent],
  );

  // Flush any pending autosave on unmount so closing the editor
  // mid-typing doesn't lose the last keystrokes. Reading via refs
  // — the cleanup closure is set up on first render when `doc`
  // was null, so a stale-null capture would bail without flushing.
  useEffect(() => {
    return () => {
      cancelPendingAutosave();
      const currentDoc = docRef.current;
      if (!currentDoc) return;
      const content = workingContentRef.current;
      if (content === lastSavedContentRef.current) return;
      // Fire-and-forget: component is already unmounting, can't
      // report status.
      docs
        .edit(currentDoc.id, { content })
        .catch((e) => console.warn('unmount flush failed', e));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // beforeunload warning: if the user refreshes / closes the tab
  // with unsaved edits, surface the browser's built-in confirm
  // before letting the navigation through.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (workingContentRef.current !== lastSavedContentRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const onDocumentNameChange = useCallback(
    async (next: string) => {
      const title = next.trim().slice(0, MAX_ALIAS_LENGTH) || 'Untitled';
      setDocumentName(title);
      const currentDoc = docRef.current;
      if (!currentDoc || title === currentDoc.title) return;

      // Flush any pending content autosave BEFORE we issue the
      // rename — cancelling the debounce would otherwise discard
      // content edits between the last keystroke and this rename,
      // since nothing re-triggers the content save afterwards.
      if (autosaveTimeoutRef.current) {
        cancelPendingAutosave();
        await persistContent(workingContentRef.current);
      }

      setSaveStatus('saving');
      try {
        await docs.edit(currentDoc.id, { title });
        if (unmountedRef.current) return;
        setDoc((prev) => (prev ? { ...prev, title } : prev));
        setSaveStatus('saved');
        setLastSavedAt(new Date());
      } catch (e) {
        if (unmountedRef.current) return;
        setSaveStatus('error');
        console.error('rename failed', e);
      }
    },
    [cancelPendingAutosave, persistContent, docs],
  );

  const onDelete = useCallback(async () => {
    const currentDoc = docRef.current;
    if (!currentDoc) return;
    const ok = await confirm({
      title: 'Delete document?',
      body: (
        <>
          Delete{' '}
          <code className="text-xs">{currentDoc.title || 'Untitled'}</code>?
          This can't be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    // Cancel pending autosave so we don't race the delete with an
    // edit to a just-removed doc.
    cancelPendingAutosave();
    try {
      await docs.remove(currentDoc.id);
      onClose();
    } catch (e) {
      console.error('delete failed', e);
      setSaveStatus('error');
    }
  }, [confirm, docs, cancelPendingAutosave, onClose]);

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
      documentName={documentName}
      // Every mutation handler gates on perms.canWrite so read-only
      // viewers can't accidentally (or intentionally) rename, edit,
      // or delete. EditorShell's readOnly flag additionally puts
      // Tiptap and the header into a display-only mode so the UI
      // reflects the capability.
      onDocumentNameChange={onDocumentNameChange}
      onBack={onClose}
      onDelete={perms.canWrite ? onDelete : undefined}
      onContentChange={perms.canWrite ? onContentChange : undefined}
      readOnly={!perms.canWrite}
      initialContent={doc?.content}
      saveStatus={saveStatus}
      lastSavedAt={lastSavedAt}
      isAppReady={!!namespaceId && !!docs.contextId}
      isLoading={loading}
    />
  );
}

// Save-orchestrating wrapper around EditorShell. Loads the doc via
// useDocs.get, binds EditorShell's controlled props to local state
// + the save state machine, and persists:
//   - content: debounced autosave (900ms idle) + flush on unmount
//   - title:   explicit onDocumentNameChange
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
  const workingContentRef = useRef<string>('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

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

  // Load the doc on mount / docId change.
  useEffect(() => {
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
    // only on docId so the effect doesn't re-run on every docs-
    // list refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const persistContent = useCallback(
    async (content: string) => {
      if (!doc) return;
      if (content === doc.content) {
        // String-equality skip avoids spamming editDoc when Tiptap
        // re-emits the same HTML on unrelated events (selection
        // change, focus, etc.).
        return;
      }
      setSaveStatus('saving');
      try {
        await docs.edit(doc.id, { content });
        if (unmountedRef.current) return;
        // Optimistically bump the local doc's content so equality
        // checks on subsequent autosaves can short-circuit.
        setDoc((prev) => (prev ? { ...prev, content } : prev));
        setSaveStatus('saved');
        setLastSavedAt(new Date());
      } catch (e: unknown) {
        if (unmountedRef.current) return;
        setSaveStatus('error');
        console.error('autosave failed', e);
      }
    },
    [doc, docs],
  );

  const onContentChange = useCallback(
    (html: string) => {
      workingContentRef.current = html;
      if (!doc || html === doc.content) {
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
    [doc, cancelPendingAutosave, persistContent],
  );

  // Flush any pending autosave on unmount so closing the editor
  // mid-typing doesn't lose the last keystrokes.
  useEffect(() => {
    return () => {
      cancelPendingAutosave();
      if (!doc) return;
      const content = workingContentRef.current;
      if (content !== doc.content) {
        // Fire-and-forget: component is already unmounting, can't
        // report status.
        docs
          .edit(doc.id, { content })
          .catch((e) => console.warn('unmount flush failed', e));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // beforeunload warning: if the user refreshes / closes the tab
  // with unsaved edits, surface the browser's built-in confirm
  // before letting the navigation through.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!doc) return;
      if (workingContentRef.current !== doc.content) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [doc]);

  const onDocumentNameChange = useCallback(
    async (next: string) => {
      const title = next.trim().slice(0, MAX_ALIAS_LENGTH) || 'Untitled';
      setDocumentName(title);
      if (!doc || title === doc.title) return;
      cancelPendingAutosave();
      setSaveStatus('saving');
      try {
        await docs.edit(doc.id, { title });
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
    [doc, cancelPendingAutosave, docs],
  );

  const onDelete = useCallback(async () => {
    if (!doc) return;
    const ok = await confirm({
      title: 'Delete document?',
      body: (
        <>
          Delete <code className="text-xs">{doc.title || 'Untitled'}</code>?
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
      await docs.remove(doc.id);
      onClose();
    } catch (e) {
      console.error('delete failed', e);
      setSaveStatus('error');
    }
  }, [doc, confirm, docs, cancelPendingAutosave, onClose]);

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
      onDocumentNameChange={onDocumentNameChange}
      onBack={onClose}
      onDelete={perms.canWrite ? onDelete : undefined}
      onContentChange={perms.canWrite ? onContentChange : undefined}
      initialContent={doc?.content}
      saveStatus={saveStatus}
      lastSavedAt={lastSavedAt}
      isAppReady={!!namespaceId && !!docs.contextId}
      isLoading={loading}
    />
  );
}

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
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
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
  const { namespaceId } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  // Doc-edit ability is the registry `Role` (Editor/Manager — not
  // Viewer), gated through useFolderPermissions.canEditDocs. A core
  // group-admin always qualifies; a caps-fetch failure leaves
  // `isMember` (and hence this) false, so the editor opens read-only
  // rather than writable on error.
  const canEditDocs = perms.canEditDocs;
  const docs = useDocs(folderId);
  // Destructure the stable useCallback methods into local consts so
  // the react-hooks/exhaustive-deps rule sees a plain identifier
  // rather than a member access (which it can't track). Depending on
  // these individually avoids cascading re-memoization every render
  // caused by useDocs returning a fresh object literal.
  const { edit: docsEdit, remove: docsRemove, contextId: docsContextId } = docs;
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

  // Mirror docs.edit into a ref so the unmount-flush cleanup
  // always calls the current implementation without the effect
  // having to list docs.edit as a dep (which would re-fire the
  // effect on every identity change, firing cleanup flushes
  // opportunistically when we only want them on real unmount /
  // docId change).
  const docsEditRef = useRef(docsEdit);
  useEffect(() => {
    docsEditRef.current = docsEdit;
  }, [docsEdit]);

  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  // Monotonic save sequence. persistContent stamps each attempt with
  // a ++saveSeqRef value and only applies its ack if no newer attempt
  // has already applied (lastAppliedSeqRef). Without this, two
  // overlapping saves (debounce A fires at 900ms; user types; debounce
  // B fires at 1800ms; both in-flight) can resolve out of order — if
  // B's RPC acks first and A's acks second, the older A content would
  // overwrite lastSavedContentRef, causing false 'unsaved' indicators
  // and a wasted next-debounce save. Sequence numbers are mutation-
  // count proxies rather than wall-clock, so clock skew / request
  // reordering at the transport layer doesn't confuse the guard.
  const saveSeqRef = useRef(0);
  const lastAppliedSeqRef = useRef(0);
  // True while persistContent is awaiting the RPC. Used by
  // onContentChange to avoid regressing 'saving' → 'unsaved' on
  // Tiptap's spurious update events (cursor moves, internal
  // normalisation): transitioning out of 'saving' is the save's own
  // job, not an update event's.
  const savingInFlightRef = useRef(false);
  // Flipped to true by onContentChange while a save is in-flight.
  // persistContent checks this after ack to decide whether to
  // schedule a follow-up save. Using a flag avoids comparing HTML
  // strings — Tiptap's getHTML() can return subtly different output
  // for the same document state (trailing <p></p>, attribute order),
  // which caused infinite save loops via string !== checks.
  const dirtyDuringSaveRef = useRef(false);

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
  const docsGet = docs.get;
  useEffect(() => {
    if (!docsContextId) {
      // Stay in loading until the context is resolved. Error from
      // useDocs (resolveError) is surfaced via the `docs.error`
      // path, separate from this load's loadError.
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setDoc(null);
    docsGet(docId)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        setDocumentName(d.title || 'Untitled');
        workingContentRef.current = d.content;
        lastSavedContentRef.current = d.content;
        setSaveStatus('saved');
        // The docs WASM stores timestamps as nanoseconds-since-epoch
        // (see `list_docs` response: updated_at ≈ 1.77e18). JS Date
        // expects milliseconds, so divide by 1e6. Multiplying by 1000
        // was the original bug — it pushed the value past the safe
        // Date range and rendered as "Invalid Date".
        setLastSavedAt(new Date(d.updated_at / 1_000_000));
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
  }, [docId, docsContextId, docsGet]);

  // Depend on `docs.edit` (the stable useCallback from useDocs),
  // not the whole `docs` object literal. The object is freshly
  // constructed every useDocs render, which would cascade through
  // every callback that depends on it — ultimately forcing
  // EditorShell's Tiptap `update` handler to teardown + re-bind
  // on every render of DocumentEditor.
  //
  // Returns true if the content was successfully persisted (or was
  // already at the last-saved value and required no round-trip),
  // false if the save failed. Callers that chain another mutation
  // off a successful flush (e.g. onDocumentNameChange flushing
  // content before a rename) must check the return — silently
  // proceeding after a failed flush would set a stale 'saved'
  // status and mislead the user into thinking their content edits
  // made it through.
  const persistContent = useCallback(
    async (content: string): Promise<boolean> => {
      const currentDoc = docRef.current;
      if (!currentDoc) return true;
      if (content === lastSavedContentRef.current) {
        // Nothing changed since the last server ack — skip the
        // round-trip. Tiptap re-emits the same HTML on unrelated
        // events (selection / focus), this guard prevents spamming.
        return true;
      }
      setSaveStatus('saving');
      savingInFlightRef.current = true;
      dirtyDuringSaveRef.current = false;
      const mySeq = ++saveSeqRef.current;
      try {
        await docsEdit(currentDoc.id, { content });
        if (unmountedRef.current) return true;
        // Out-of-order-resolution guard: a newer save has already
        // acked while this one was in flight, so its content is the
        // authoritative lastSaved — don't clobber it with our older
        // content. Returning true is correct: the caller's content
        // was persisted server-side (edit_doc is idempotent-enough
        // that the newer save already encompasses ours).
        if (mySeq <= lastAppliedSeqRef.current) return true;
        lastAppliedSeqRef.current = mySeq;
        // Record the server-acked content WITHOUT triggering
        // EditorShell's initialContent effect. Updating doc.content
        // here would make EditorShell call setContent(savedHTML),
        // which if the user typed more during the in-flight save
        // would silently revert those keystrokes.
        lastSavedContentRef.current = content;
        setLastSavedAt(new Date());
        // Check if the user typed more while the RPC was in flight.
        // onContentChange doesn't schedule autosaves during in-flight
        // saves (to prevent cascading overlaps), so we handle the
        // "dirty after ack" case here. Using the flag instead of
        // comparing HTML strings avoids infinite save loops caused
        // by Tiptap emitting slightly different HTML for the same
        // document state (trailing empty paragraphs, normalisation).
        if (dirtyDuringSaveRef.current) {
          dirtyDuringSaveRef.current = false;
          setSaveStatus('unsaved');
          cancelPendingAutosave();
          const latest = workingContentRef.current;
          autosaveTimeoutRef.current = setTimeout(() => {
            autosaveTimeoutRef.current = null;
            void persistContent(latest);
          }, AUTOSAVE_DEBOUNCE_MS);
        } else {
          // Also sync lastSavedContentRef with whatever Tiptap
          // currently has. Tiptap may have normalised the HTML
          // (trailing <p></p>, attribute reordering) so its
          // getHTML() won't match the exact string we saved. Without
          // this sync, the next onContentChange sees a "difference"
          // and starts a redundant save cycle.
          lastSavedContentRef.current = workingContentRef.current;
          setSaveStatus('saved');
        }
        return true;
      } catch (e: unknown) {
        if (unmountedRef.current) return false;
        // Same ordering guard on the error path: a newer in-flight
        // save will resolve the status itself. Surfacing 'error' here
        // would incorrectly overwrite a healthy in-flight save with
        // an error state the user can't act on.
        if (mySeq <= lastAppliedSeqRef.current) return false;
        setSaveStatus('error');
        console.error('autosave failed', e);
        return false;
      } finally {
        // Only drop the in-flight flag if THIS save was the latest
        // attempt — if a newer save is still pending, leave the flag
        // set so onContentChange keeps deferring to it.
        if (mySeq === saveSeqRef.current) {
          savingInFlightRef.current = false;
        }
      }
    },
    [docsEdit, cancelPendingAutosave],
  );

  const onContentChange = useCallback(
    (html: string) => {
      workingContentRef.current = html;
      if (html === lastSavedContentRef.current) {
        // Only drop to 'saved' if we're not mid-save — the save's own
        // resolver is the authoritative transition out of 'saving'.
        if (!savingInFlightRef.current) setSaveStatus('saved');
        return;
      }
      // While a save is in-flight, just record the new content and
      // flag it dirty — don't schedule another autosave. Scheduling
      // during in-flight saves caused cascading overlaps that kept
      // savingInFlightRef stuck on true. persistContent checks the
      // dirty flag after ack and schedules a follow-up if needed.
      if (savingInFlightRef.current) {
        dirtyDuringSaveRef.current = true;
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
  // mid-typing doesn't lose the last keystrokes. Reads everything
  // via refs:
  //   - docRef.current        → current loaded doc (cleanup closure
  //     is set up on first render when `doc` was null, so a stale-
  //     null capture would bail without flushing).
  //   - docsEditRef.current   → current docs.edit implementation.
  //     Listing docs.edit directly in the dep array would fire
  //     the cleanup on every identity change (e.g. context refresh),
  //     flushing opportunistically when we want the flush only on
  //     real unmount / docId change.
  useEffect(() => {
    return () => {
      cancelPendingAutosave();
      const currentDoc = docRef.current;
      if (!currentDoc) return;
      const content = workingContentRef.current;
      if (content === lastSavedContentRef.current) return;
      // Fire-and-forget: component is already unmounting, can't
      // report status.
      docsEditRef
        .current(currentDoc.id, { content })
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
      // If the flush fails, bail without issuing the rename:
      // proceeding would flip saveStatus to 'saved' after the
      // rename lands, misleading the user into thinking their
      // content edits were persisted when they weren't.
      if (autosaveTimeoutRef.current) {
        cancelPendingAutosave();
        const flushed = await persistContent(workingContentRef.current);
        if (!flushed) return;
      }

      setSaveStatus('saving');
      try {
        await docsEdit(currentDoc.id, { title });
        if (unmountedRef.current) return;
        setDoc((prev) => (prev ? { ...prev, title } : prev));
        setLastSavedAt(new Date());
        // The rename succeeded — surface 'saved'. If there are pending
        // content edits (user typed during the rename), Tiptap's next
        // update event will flip us to 'unsaved' and re-trigger the
        // content autosave. See persistContent for why we don't try
        // to infer dirtiness here via HTML equality.
        setSaveStatus('saved');
      } catch (e) {
        if (unmountedRef.current) return;
        setSaveStatus('error');
        console.error('rename failed', e);
      }
    },
    // docsEdit is stable (useCallback in useDocs); depending on
    // the individual method instead of the whole docs object keeps
    // this callback's identity stable across useDocs re-renders.
    [cancelPendingAutosave, persistContent, docsEdit],
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
      await docsRemove(currentDoc.id);
      onClose();
    } catch (e) {
      console.error('delete failed', e);
      setSaveStatus('error');
    }
    // Individual stable methods, not the whole docs object — see
    // persistContent for why.
  }, [confirm, docsRemove, cancelPendingAutosave, onClose]);

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
      // Every mutation handler gates on canEditDocs so read-only
      // viewers can't accidentally (or intentionally) rename, edit,
      // or delete. Defense-in-depth: EditorShell's readOnly flag
      // also puts Tiptap and the header into a display-only mode,
      // but the binding-level gate is the authoritative guard so
      // a future caller that forgets readOnly still can't fire
      // mutations on a read-only doc.
      onDocumentNameChange={canEditDocs ? onDocumentNameChange : undefined}
      onBack={onClose}
      onDelete={canEditDocs ? onDelete : undefined}
      onContentChange={canEditDocs ? onContentChange : undefined}
      readOnly={!canEditDocs}
      initialContent={doc?.content}
      saveStatus={saveStatus}
      lastSavedAt={lastSavedAt}
      isAppReady={!!namespaceId && !!docsContextId}
      isLoading={loading}
    />
  );
}

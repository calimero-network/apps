// Visual editor skeleton, now backed by BlockNote (replacing Tiptap).
//
// The prop contract is UNCHANGED from the Tiptap shell so the save
// orchestrator (DocumentEditor) and the e2e driver don't care which
// editor library is underneath:
//   - `initialContent` / `onContentChange` carry an OPAQUE string. With
//     BlockNote that string is `JSON.stringify(editor.document)` (a
//     serialized Block[]) instead of HTML — DocumentEditor only ever
//     compares the string, so its autosave / seq-guard / SSE-reconcile
//     logic transfers verbatim.
//   - `readOnly`, `saveStatus`, `lastSavedAt`, `isAppReady`, `isLoading`
//     behave exactly as before.
//
// The one delicate piece is remote-content application. Tiptap let us
// inject remote edits with `setContent(html, { emitUpdate: false })`.
// BlockNote's `replaceBlocks` ALWAYS fires `onChange` (no suppress flag
// exists — verified against source), so an SSE refresh would otherwise
// masquerade as a local keystroke and trigger a spurious autosave (and,
// worse, a feedback loop between two collaborators). We guard every
// programmatic replace with `applyingRemoteRef`: set it, replaceBlocks,
// the resulting synchronous onChange sees the flag and skips the save,
// then we clear it. ProseMirror dispatches transactions synchronously,
// so the flag is reliably down again before any real user edit.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { createExtension } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EditorStatusBar } from './EditorStatusBar';
import { EditorHeader, type TitleBinding } from './EditorHeader';
import { useTheme } from '@/components/theme/ThemeProvider';
import { schema, type DriveEditor } from './blocknote/schema';
import { presencePlugin } from './presence/presencePlugin';
import {
  serializeBlocks,
  parseStoredContent,
  blocksToPlainText,
  countWords,
  countCharacters,
} from './blocknote/content';
import type { SaveStatus } from './types';

export interface EditorShellProps {
  documentName: string;
  /** Optional - when undefined the title renders as static text in
   *  the header (read-only mode). */
  title?: TitleBinding;
  onBack?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  /** Called with the serialized document (JSON Block[] string) on every
   *  local edit. Caller debounces and persists. NOT called for remote
   *  content applied via the `initialContent` prop. */
  onContentChange?: (content: string) => void;
  /** Initial / remote content as a serialized Block[] JSON string. An
   *  empty / non-JSON value opens a fresh empty document. Changes after
   *  mount are applied as remote edits (guarded, no autosave echo). */
  initialContent?: string;
  saveStatus?: SaveStatus;
  lastSavedAt?: Date | null;
  isAppReady?: boolean;
  isLoading?: boolean;
  /** Handed the live editor once, so presence can read and decorate it. */
  onEditorReady?: (editor: DriveEditor) => void;
  /** View-only mode: BlockNote becomes non-editable and the header
   *  renders the title as plain text. Callers should ALSO gate the
   *  mutation callbacks at the binding level (defense in depth). */
  readOnly?: boolean;
}

// BlockNote renders its own block ids as `data-id`, which are the backend's
// block tokens here; the browser suites address blocks through a stable testid.
export function stampBlocks(root: HTMLElement | null): void {
  if (!root) return;
  for (const block of root.querySelectorAll<HTMLElement>('[data-id]')) {
    const id = block.getAttribute('data-id');
    if (!id || block.dataset.blockId === id) continue;
    block.dataset.testid = 'doc-block';
    block.dataset.blockId = id;
  }
}

export const EditorShell: React.FC<EditorShellProps> = ({
  documentName,
  title,
  onBack,
  onUndo,
  onRedo,
  onDelete,
  onContentChange,
  initialContent,
  saveStatus = 'saved',
  lastSavedAt = null,
  isAppReady = true,
  isLoading = false,
  readOnly = false,
  onEditorReady,
}) => {
  const { theme } = useTheme();

  // BlockNote reads `initialContent` ONCE at creation. DocumentEditor
  // mounts this shell before the doc has loaded (initialContent
  // undefined → empty doc); the real content arrives later and is
  // applied by the remote-apply effect below. Parsed once at mount.
  const initialBlocks = useMemo(
    () => parseStoredContent(initialContent),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once at creation; later changes go through the replace effect
    [],
  );

  const presence = useMemo(
    () =>
      createExtension({
        key: 'calimeroPresence',
        prosemirrorPlugins: [presencePlugin()],
      }),
    [],
  );

  const editor = useCreateBlockNote({
    schema,
    initialContent: initialBlocks,
    extensions: [presence],
  });

  useEffect(() => {
    if (editor) onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);

  // True only while we are programmatically applying remote content, so
  // the resulting onChange does NOT round-trip back out as a local save.
  const applyingRemoteRef = useRef(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  // The serialized content the editor is known to hold (last loaded /
  // applied / emitted). Two jobs:
  //   - onChange emits a save ONLY when the document genuinely differs
  //     from this, so spurious onChange events (and the initial document)
  //     never trigger a write.
  //   - the remote-apply effect skips a no-op replace when the incoming
  //     snapshot already matches (e.g. our own save echoing back via SSE),
  //     which would otherwise reset the cursor.
  const lastContentRef = useRef<string | undefined>(undefined);

  // Prime counts + the content baseline ONCE per editor instance. Kept
  // in its own effect (deps: [editor]) — NOT folded into the onChange
  // subscription below — so that a change in `onContentChange` identity
  // can't re-run the prime and reset `lastContentRef`, which would drop
  // the baseline for an in-progress edit. CRITICAL: priming must NOT
  // emit onContentChange — the shell is mounted with an empty editor
  // while the doc loads, and emitting here would schedule a save of
  // empty content that could land after the real content arrives and
  // wipe the document.
  useEffect(() => {
    if (!editor) return;
    stampBlocks(editorRootRef.current);
    const text = blocksToPlainText(editor.document);
    setWordCount(countWords(text));
    setCharCount(countCharacters(text));
    lastContentRef.current = serializeBlocks(editor.document);
  }, [editor]);

  // Subscribe to content changes. Counts always refresh; the autosave
  // callback fires only for genuine local edits that move the document
  // off `lastContentRef` (so the initial prime and remote applies never
  // emit). Re-subscribes if `onContentChange` identity changes, but does
  // NOT touch `lastContentRef` (the prime effect owns the baseline).
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const doc = editor.document;
      stampBlocks(editorRootRef.current);
      const text = blocksToPlainText(doc);
      setWordCount(countWords(text));
      setCharCount(countCharacters(text));
      if (applyingRemoteRef.current) return;
      const serialized = serializeBlocks(doc);
      if (serialized === lastContentRef.current) return; // no real change
      lastContentRef.current = serialized;
      onContentChange?.(serialized);
    };
    return editor.onChange(handler);
  }, [editor, onContentChange]);

  // Apply remote / late-arriving content. The onChange that replaceBlocks
  // triggers must NOT round-trip back out as a local save. TWO independent
  // guards make this robust regardless of whether BlockNote dispatches the
  // transaction synchronously or (in some future version) asynchronously:
  //   1. `applyingRemoteRef` short-circuits onChange for the duration of
  //      the apply — covers the synchronous case and the intermediate
  //      transaction states. Cleared in `finally`, so a throw can't strand
  //      it true.
  //   2. `lastContentRef` is set to the applied content, so once the doc
  //      settles its serialization equals `lastContentRef` and onChange's
  //      equality check drops it — covers any onChange that fires AFTER
  //      the flag is cleared (i.e. an async dispatch). Belt and suspenders.
  useEffect(() => {
    if (!editor || initialContent === undefined) return;
    if (initialContent === lastContentRef.current) return;
    const blocks = parseStoredContent(initialContent);
    if (!blocks) {
      // Empty / legacy / non-JSON content. The freshly created editor is
      // already an empty document, so don't replace (which would emit a
      // spurious normalize-save); just baseline the ref so genuine edits
      // still emit.
      lastContentRef.current = serializeBlocks(editor.document);
      return;
    }
    if (serializeBlocks(editor.document) === initialContent) {
      lastContentRef.current = initialContent;
      return;
    }
    // Best-effort caret preservation across the whole-doc replace: capture
    // the cursor's block (by id + index) so a remote edit landing while you
    // are idle doesn't drop the caret to the top. replaceBlocks regenerates
    // ids from serialized JSON, so we restore by id if it survived, else by
    // the same index clamped to the new doc. (The real fix is the Yjs path,
    // which applies incremental steps and never needs this.)
    let priorBlockId: string | undefined;
    let priorIndex = -1;
    try {
      priorBlockId = editor.getTextCursorPosition()?.block?.id;
      if (priorBlockId) {
        priorIndex = editor.document.findIndex((b) => b.id === priorBlockId);
      }
    } catch {
      /* no active selection to preserve */
    }
    applyingRemoteRef.current = true;
    try {
      // Loaded content is not an edit the user made, so it is not undoable.
      editor.transact((tr) => {
        tr.setMeta('addToHistory', false);
        editor.replaceBlocks(editor.document, blocks);
      });
      lastContentRef.current = initialContent; // guard (2): equality drop
      const doc = editor.document;
      if (doc.length > 0) {
        const target =
          (priorBlockId &&
            doc.some((b) => b.id === priorBlockId) &&
            priorBlockId) ||
          (priorIndex >= 0
            ? doc[Math.min(priorIndex, doc.length - 1)]?.id
            : undefined);
        if (target) {
          try {
            editor.setTextCursorPosition(target, 'end');
          } catch {
            /* block no longer focusable — leave default caret */
          }
        }
      }
    } finally {
      applyingRemoteRef.current = false; // guard (1): cleared even on throw
    }
  }, [editor, initialContent]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-ink mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading document...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full bg-background">
        <EditorHeader
          documentName={documentName}
          title={readOnly ? undefined : title}
          onDelete={onDelete}
          onBack={onBack}
          onUndo={readOnly ? undefined : onUndo}
          onRedo={readOnly ? undefined : onRedo}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto bg-card">
            <div
              ref={editorRootRef}
              data-testid="doc-editor"
              className="max-w-4xl mx-auto px-8 py-6 md:px-16 lg:px-24"
            >
              <BlockNoteView
                editor={editor}
                editable={!readOnly}
                theme={theme}
              />
            </div>
          </div>

          <EditorStatusBar
            documentName={documentName}
            wordCount={wordCount}
            charCount={charCount}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
            isAppReady={isAppReady}
          />
        </div>
      </div>
    </TooltipProvider>
  );
};

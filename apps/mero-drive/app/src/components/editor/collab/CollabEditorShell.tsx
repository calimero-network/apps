// Collaborative variant of EditorShell, backed by BlockNote's native Yjs
// collaboration. Mounted only when `COLLAB_YJS_ENABLED` is on.
//
// Differences from the LWW EditorShell:
//   - the body is owned by the collaborative `Y.Doc` (via `useCollabDoc`), not
//     `initialContent` / `onContentChange`. BlockNote binds y-prosemirror to
//     the fragment, so concurrent edits MERGE at the CRDT layer.
//   - no debounced autosave: the provider streams local updates to the op-log
//     and folds in peers' updates via the SSE-driven `pullRemote`.
//
// Header / toolbar / status-bar chrome matches EditorShell; only the data
// binding differs.

import React, { useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EditorStatusBar } from '../EditorStatusBar';
import { EditorHeader } from '../EditorHeader';
import { useTheme } from '@/components/theme/ThemeProvider';
import { schema } from '../blocknote/schema';
import { DriveFormattingToolbar } from '../blocknote/FormattingToolbar';
import { blocksToPlainText, countWords, countCharacters } from '../blocknote/content';
import type { SaveStatus } from '../types';
import type { CalimeroYjsProvider } from './CalimeroYjsProvider';

export interface CollabEditorShellProps {
  documentName: string;
  onDocumentNameChange?: (name: string) => void;
  onBack?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
  isAppReady?: boolean;
  isLoading?: boolean;
  /** The collaborative Y.Doc + provider from `useCollabDoc`. */
  ydoc: Y.Doc;
  provider: CalimeroYjsProvider;
  /** Identity-derived label + color shown to other collaborators (cursors). */
  user: { name: string; color: string };
}

export const CollabEditorShell: React.FC<CollabEditorShellProps> = ({
  documentName,
  onDocumentNameChange,
  onBack,
  onDelete,
  readOnly = false,
  isAppReady = true,
  isLoading = false,
  ydoc,
  provider,
  user,
}) => {
  const { theme } = useTheme();

  // The fragment is the doc's single shared BlockNote tree. Memoised on the
  // ydoc identity so the editor isn't recreated on unrelated re-renders.
  const fragment = useMemo(() => ydoc.getXmlFragment('blocknote'), [ydoc]);

  const editor = useCreateBlockNote({
    schema,
    collaboration: {
      fragment,
      user,
      provider,
    },
  });

  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  // Persistence status from the provider: 'saving' while edits are buffered or
  // a flush is in flight, else 'saved'. No provider event to subscribe to, so
  // it's sampled on editor change and polled briefly while pending.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  useEffect(() => {
    if (!editor) return;
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPoll = () => {
      if (poll !== null) {
        clearInterval(poll);
        poll = null;
      }
    };
    const sampleStatus = () => {
      const pending = provider.hasPendingWork;
      setSaveStatus(pending ? 'saving' : 'saved');
      if (!pending) stopPoll();
    };
    const recompute = () => {
      const text = blocksToPlainText(editor.document);
      setWordCount(countWords(text));
      setCharCount(countCharacters(text));
      // A local edit makes work pending immediately; start polling so we flip
      // back to "saved" once the debounced flush drains.
      sampleStatus();
      if (provider.hasPendingWork && poll === null) {
        poll = setInterval(sampleStatus, 300);
      }
    };
    recompute();
    const off = editor.onChange(recompute);
    return () => {
      stopPoll();
      off?.();
    };
  }, [editor, provider]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
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
          onDocumentNameChange={readOnly ? undefined : onDocumentNameChange}
          onDelete={onDelete}
          onBack={onBack}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto bg-card">
            <div className="max-w-4xl mx-auto px-8 py-6 md:px-16 lg:px-24">
              <BlockNoteView
                editor={editor}
                editable={!readOnly}
                theme={theme}
                formattingToolbar={false}
              >
                <DriveFormattingToolbar />
              </BlockNoteView>
            </div>
          </div>

          {/* `saveStatus` reflects the provider's buffer/flush state. A
              streaming op-log has no single "last saved" instant, so
              `lastSavedAt` stays null. */}
          <EditorStatusBar
            documentName={documentName}
            wordCount={wordCount}
            charCount={charCount}
            saveStatus={saveStatus}
            lastSavedAt={null}
            isAppReady={isAppReady}
          />
        </div>
      </div>
    </TooltipProvider>
  );
};

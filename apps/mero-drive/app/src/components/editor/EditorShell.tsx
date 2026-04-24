// Visual-only editor skeleton — distilled from the pre-Phase-4
// DocumentEditor.tsx (b811ffe) with every v8 data-layer call removed.
// Phase 8 Task 41 will wrap this with the real save/load orchestration
// using the new DocsClient + mero-react hooks.
//
// What stayed:
//   - Tiptap extension config (StarterKit + Underline + Link +
//     Placeholder + TextAlign + Highlight)
//   - Welcome-content default
//   - Layout: Header / Toolbar / Editor area / StatusBar inside a
//     TooltipProvider
//   - prose-invert + editor-area spacing (`px-8 py-6 md:px-16 lg:px-24`)
//
// What left:
//   - AbiClient / WorkspaceManager / useWorkspace data-layer imports
//   - saveDocument / handleBack / handleDelete data-layer logic
//   - useParams / useNavigate (route-shape is a caller concern)
//   - isLoading / document state driven by fetches
//
// Callers that need state machine behaviour (autosave, error handling,
// name change persistence) should wrap this shell with their own
// orchestrator — the shell only surfaces an `onContentChange` callback
// and accepts `saveStatus` / `lastSavedAt` as controlled props.

import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EditorToolbar } from './EditorToolbar';
import { EditorStatusBar } from './EditorStatusBar';
import { EditorHeader } from './EditorHeader';
import type { SaveStatus } from './types';

export const WELCOME_CONTENT = `
<h1>Welcome to Mero Drive</h1>
<p>Start writing your document here. Your content is saved as HTML snapshots and encrypted end-to-end.</p>
<h2>Getting Started</h2>
<ul>
  <li><strong>Local-First:</strong> Documents live on your device first</li>
  <li><strong>End-to-End Encrypted:</strong> Only you and your collaborators can read your content</li>
  <li><strong>Auto-Save:</strong> Changes are saved automatically as you type</li>
</ul>
<p>Try formatting some text using the toolbar above, or use keyboard shortcuts:</p>
<ul>
  <li><code>Ctrl+B</code> for <strong>bold</strong></li>
  <li><code>Ctrl+I</code> for <em>italic</em></li>
  <li><code>Ctrl+U</code> for <u>underline</u></li>
</ul>
<blockquote>
  <p>"Privacy is not about having something to hide. It's about having something to protect."</p>
</blockquote>
<p>Start writing below...</p>
`;

export interface EditorShellProps {
  documentName: string;
  /** Optional — when undefined the title renders as static text in
   *  the header, matching the underlying EditorHeader's read-only
   *  mode. Callers gating rename on permissions should pass
   *  undefined rather than a no-op so the UI surface accurately
   *  reflects capability. */
  onDocumentNameChange?: (name: string) => void;
  onBack?: () => void;
  onDelete?: () => void;
  /** Called with the current HTML on every Tiptap update. Caller
   *  debounces and persists. */
  onContentChange?: (html: string) => void;
  /** Initial HTML for the editor — existing doc content or a
   *  per-caller placeholder. Falls back to WELCOME_CONTENT. */
  initialContent?: string;
  saveStatus?: SaveStatus;
  lastSavedAt?: Date | null;
  isAppReady?: boolean;
  isLoading?: boolean;
  /** When true, the editor + header title + toolbar operate in a
   *  view-only mode. Tiptap becomes non-editable, the header
   *  renders the title as plain text (no inline-edit affordance),
   *  and the toolbar buttons all sit disabled. Callers should
   *  ALSO gate onDelete / onContentChange / onDocumentNameChange
   *  at the binding level — this flag is for visual + Tiptap-
   *  level enforcement. */
  readOnly?: boolean;
}

export const EditorShell: React.FC<EditorShellProps> = ({
  documentName,
  onDocumentNameChange,
  onBack,
  onDelete,
  onContentChange,
  initialContent,
  saveStatus = 'saved',
  lastSavedAt = null,
  isAppReady = true,
  isLoading = false,
  readOnly = false,
}) => {
  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline cursor-pointer hover:text-primary/80',
        },
      }),
      Placeholder.configure({ placeholder: 'Start writing...' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({
        HTMLAttributes: { class: 'bg-primary/20 rounded px-1' },
      }),
    ],
    content: initialContent ?? WELCOME_CONTENT,
    editorProps: {
      attributes: {
        class:
          'prose prose-invert max-w-none focus:outline-none min-h-[calc(100vh-200px)] px-8 py-6 md:px-16 lg:px-24',
      },
    },
  });

  // Swap content in when caller hands us an updated `initialContent`
  // after the editor has already mounted (e.g. doc load resolves).
  // `emitUpdate: false` is load-bearing — Tiptap v3's setContent
  // emits the `update` event by default, which would fire
  // onContentChange as if the user had typed. Phase 8's save
  // orchestrator would then start an autosave cycle immediately
  // after loading a document, burning a round-trip and flashing a
  // false "unsaved changes" state.
  useEffect(() => {
    if (!editor || initialContent === undefined) return;
    if (editor.getHTML() === initialContent) return;
    editor.commands.setContent(initialContent, { emitUpdate: false });
  }, [editor, initialContent]);

  // Re-apply editability whenever `readOnly` flips. useEditor's
  // `editable` option is a one-shot snapshot captured at creation
  // time — it does NOT react to later prop changes. useFolderPermissions
  // resolves asynchronously, so `canWrite` (and therefore `readOnly`)
  // can flip after the editor is already mounted. Without this effect,
  // a writer whose permissions resolve after mount gets a permanently
  // read-only editor, and a reader who later loses access keeps a
  // writable one.
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable === !readOnly) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor || !onContentChange) return;
    const handler = () => onContentChange(editor.getHTML());
    editor.on('update', handler);
    return () => {
      editor.off('update', handler);
    };
  }, [editor, onContentChange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading document...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-background">
        <EditorHeader
          documentName={documentName}
          onDocumentNameChange={readOnly ? undefined : onDocumentNameChange}
          onDelete={onDelete}
          onBack={onBack}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <EditorToolbar editor={editor} />

          <div className="flex-1 overflow-y-auto bg-card">
            <div className="max-w-4xl mx-auto">
              <EditorContent editor={editor} />
            </div>
          </div>

          <EditorStatusBar
            editor={editor}
            documentName={documentName}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
            isAppReady={isAppReady}
          />
        </div>
      </div>
    </TooltipProvider>
  );
};

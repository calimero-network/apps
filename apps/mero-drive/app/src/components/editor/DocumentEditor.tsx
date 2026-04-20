import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { EditorToolbar } from './EditorToolbar';
import { EditorStatusBar } from './EditorStatusBar';
import { EditorHeader } from './EditorHeader';
import { useCalimero } from '@calimero-network/calimero-client';
import { AbiClient, Document as DocumentType } from '@/api/AbiClient';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

interface LocationState {
  folderId?: string | null;
}

const welcomeContent = `
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

interface DocumentEditorProps {
  documentId?: string;
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export const DocumentEditor: React.FC<DocumentEditorProps> = ({ documentId: propDocId }) => {
  const { documentId: paramDocId } = useParams<{ documentId: string }>();
  const documentId = propDocId || paramDocId;
  
  const { app } = useCalimero();
  const { activeContextId } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const initialFolderId = locationState?.folderId ?? null;
  
  const [documentName, setDocumentName] = useState('Untitled Document');
  const [document, setDocument] = useState<DocumentType | null>(null);
  const [isLoading, setIsLoading] = useState(!!documentId);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  
  const documentRef = useRef<DocumentType | null>(null);
  const documentNameRef = useRef('Untitled Document');
  const hasUnsavedChangesRef = useRef(false);
  // Tracks the last HTML string that was successfully persisted.  Used for
  // string-equality skip logic in saveDocument.  Note: TipTap may normalise
  // whitespace or attribute order between getHTML() calls, so two semantically
  // identical documents can produce different strings.  This is acceptable for
  // the snapshot flow — a redundant setContent is cheap compared to the risk of
  // losing edits.
  const lastSavedContentRef = useRef<string>(welcomeContent);
  const isCreatingDocumentRef = useRef(false);
  // Allows explicit save paths (handleBack, handleDocumentNameChange) to cancel
  // a pending debounced autosave so the two don't race.
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Keep refs in sync
  useEffect(() => {
    documentRef.current = document;
  }, [document]);
  
  useEffect(() => {
    documentNameRef.current = documentName;
  }, [documentName]);
  
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline cursor-pointer hover:text-primary/80',
        },
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({
        HTMLAttributes: {
          class: 'bg-primary/20 rounded px-1',
        },
      }),
    ],
    content: welcomeContent,
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[calc(100vh-200px)] px-8 py-6 md:px-16 lg:px-24',
      },
    },
  });

  // Load existing document via getDocument (returns HTML from the backend RGA).
  // The HTML is fed directly into TipTap via editor.commands.setContent.
  useEffect(() => {
    const loadDocument = async () => {
      if (!documentId || !app || !activeContextId) return;
      
      setIsLoading(true);
      try {
        const client = new AbiClient(app, activeContextId);
        const doc = await client.getDocument({ id: documentId });
        if (doc) {
          setDocument(doc);
          setDocumentName(doc.title);
          lastSavedContentRef.current = doc.content;
          if (editor) {
            editor.commands.setContent(doc.content);
          }
        }
      } catch (error) {
        console.error('Failed to load document:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadDocument();
  }, [documentId, app, activeContextId, editor]);

  const cancelPendingAutosave = useCallback(() => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  }, []);

  // Persist the current TipTap HTML snapshot via the active editor flow:
  //   - Existing doc → AbiClient.setContent (reseeds the backend RGA)
  //   - New doc      → AbiClient.createDocument (seeds a fresh RGA with HTML body)
  //
  // The low-level RGA methods (insertText, deleteText, replaceText) are NOT
  // called anywhere in this editor.  They require a DOM-to-HTML position
  // mapping that does not exist yet.  See AbiClient.ts for the full boundary
  // documentation and prerequisites for a future incremental-sync phase.
  const saveDocument = useCallback(async (forceCreate = false) => {
    if (!app || !activeContextId || !editor) return;
    
    const currentDoc = documentRef.current;
    const currentName = documentNameRef.current;
    const content = editor.getHTML();
    const lastContent = lastSavedContentRef.current;
    
    console.log('[saveDocument] Starting save, doc:', currentDoc?.id, 'forceCreate:', forceCreate, 'isCreating:', isCreatingDocumentRef.current);
    
    if (content === lastContent) {
      console.log('[saveDocument] Content unchanged, skipping');
      setHasUnsavedChanges(false);
      hasUnsavedChangesRef.current = false;
      if (currentDoc) setSaveStatus('saved');
      return;
    }
    
    setSaveStatus('saving');
    
    try {
      const client = new AbiClient(app, activeContextId);
      
      if (currentDoc) {
        console.log('[saveDocument] Using setContent for doc:', currentDoc.id);
        await client.setContent({
          id: currentDoc.id,
          content,
        });
        console.log('[saveDocument] Content saved successfully');
        lastSavedContentRef.current = content;
      } else if ((forceCreate || hasUnsavedChangesRef.current) && !isCreatingDocumentRef.current) {
        isCreatingDocumentRef.current = true;
        console.log('[saveDocument] Creating new document with title:', currentName);
        try {
          const newId = await client.createDocument({
            title: currentName,
            content,
            tags: [],
            folder_id: initialFolderId,
          });
          console.log('[saveDocument] Created document:', newId);
          const newDoc = await client.getDocument({ id: newId });
          if (newDoc) {
            setDocument(newDoc);
            documentRef.current = newDoc;
            lastSavedContentRef.current = content;
          }
          navigate(`/editor/${newId}`, { replace: true });
        } finally {
          isCreatingDocumentRef.current = false;
        }
      } else if (!currentDoc && isCreatingDocumentRef.current) {
        console.log('[saveDocument] Skipping - document creation already in progress');
      }
      setHasUnsavedChanges(false);
      hasUnsavedChangesRef.current = false;
      setSaveStatus('saved');
      setLastSavedAt(new Date());
    } catch (error) {
      console.error('[saveDocument] Failed to save:', error);
      setSaveStatus('error');
    }
  }, [app, activeContextId, editor, navigate, initialFolderId]);

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      setHasUnsavedChanges(true);
      hasUnsavedChangesRef.current = true;
      setSaveStatus('unsaved');

      cancelPendingAutosave();
      autosaveTimeoutRef.current = setTimeout(() => {
        autosaveTimeoutRef.current = null;
        saveDocument();
      }, 2000);
    };

    editor.on('update', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      cancelPendingAutosave();
    };
  }, [editor, saveDocument, cancelPendingAutosave]);

  // On unmount, flush unsaved HTML to the backend via setContent for existing
  // documents only.  New documents are NOT created on unmount to avoid race
  // conditions with handleBack and the debounced auto-save.
  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
      if (hasUnsavedChangesRef.current && app && activeContextId && editor && documentRef.current) {
        const client = new AbiClient(app, activeContextId);
        const content = editor.getHTML();
        const currentDoc = documentRef.current;
        console.log('[unmount] Saving to existing document:', currentDoc.id);
        client.setContent({ id: currentDoc.id, content }).catch(console.error);
      }
    };
  }, [app, activeContextId, editor]);

  // Warn before browser close/refresh with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChangesRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleDocumentNameChange = async (newName: string) => {
    setDocumentName(newName);
    documentNameRef.current = newName;
    if (!app || !activeContextId || !editor) return;

    cancelPendingAutosave();

    try {
      const client = new AbiClient(app, activeContextId);

      if (document) {
        await client.updateDocumentMetadata({
          id: document.id,
          title: newName,
        });
      } else if (!isCreatingDocumentRef.current) {
        isCreatingDocumentRef.current = true;
        setSaveStatus('saving');
        console.log('[handleDocumentNameChange] Creating new document with title:', newName);
        try {
          const content = editor.getHTML();
          const newId = await client.createDocument({
            title: newName,
            content,
            tags: [],
            folder_id: initialFolderId,
          });
          console.log('[handleDocumentNameChange] Created document:', newId);
          const newDoc = await client.getDocument({ id: newId });
          if (newDoc) {
            setDocument(newDoc);
            documentRef.current = newDoc;
            lastSavedContentRef.current = content;
          }
          setHasUnsavedChanges(false);
          hasUnsavedChangesRef.current = false;
          setSaveStatus('saved');
          setLastSavedAt(new Date());
          navigate(`/editor/${newId}`, { replace: true });
        } finally {
          isCreatingDocumentRef.current = false;
        }
      } else {
        console.log('[handleDocumentNameChange] Skipping - document creation already in progress');
      }
    } catch (error) {
      console.error('[handleDocumentNameChange] Failed:', error);
      setSaveStatus('error');
    }
  };

  const handleDelete = async () => {
    if (!document || !app || !activeContextId) return;
    
    if (window.confirm('Are you sure you want to delete this document?')) {
      try {
        const client = new AbiClient(app, activeContextId);
        await client.deleteDocument({ id: document.id });
        navigate('/home');
      } catch (error) {
        console.error('Failed to delete document:', error);
      }
    }
  };

  const handleBack = async () => {
    cancelPendingAutosave();

    console.log('[handleBack] hasUnsavedChanges:', hasUnsavedChanges, 'document:', document?.id, 'isCreating:', isCreatingDocumentRef.current);

    if (hasUnsavedChanges && app && activeContextId && editor) {
      setSaveStatus('saving');
      try {
        const client = new AbiClient(app, activeContextId);
        const content = editor.getHTML();
        console.log('[handleBack] Saving content, length:', content.length);

        if (document) {
          console.log('[handleBack] Using setContent for doc:', document.id);
          await client.setContent({ id: document.id, content });
          console.log('[handleBack] Content saved successfully');
        } else if (!isCreatingDocumentRef.current) {
          isCreatingDocumentRef.current = true;
          console.log('[handleBack] Creating new document');
          try {
            const newId = await client.createDocument({ title: documentName, content, tags: [], folder_id: initialFolderId });
            console.log('[handleBack] Created document:', newId);
          } finally {
            isCreatingDocumentRef.current = false;
          }
        } else {
          console.log('[handleBack] Skipping create - already in progress');
        }
        setHasUnsavedChanges(false);
        hasUnsavedChangesRef.current = false;
      } catch (error) {
        console.error('[handleBack] Failed to save:', error);
        setSaveStatus('error');
      }
    } else {
      console.log('[handleBack] No unsaved changes, navigating directly');
    }
    navigate('/home');
  };

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
          onDocumentNameChange={handleDocumentNameChange}
          onDelete={document ? handleDelete : undefined}
          onBack={handleBack}
        />
        
        <div className="flex-1 flex flex-col overflow-hidden">
          <EditorToolbar editor={editor} />
          
          <div className="flex-1 overflow-y-auto bg-card">
            <div className="max-w-4xl mx-auto">
              <EditorContent editor={editor} />
            </div>
          </div>

          <EditorStatusBar editor={editor} documentName={documentName} saveStatus={saveStatus} lastSavedAt={lastSavedAt} isAppReady={!!app} />
        </div>
      </div>
    </TooltipProvider>
  );
};

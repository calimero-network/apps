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
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

interface LocationState {
  folderId?: string | null;
}

const welcomeContent = `
<h1>Welcome to MeroDocs</h1>
<p>Start writing your document here. Everything you type is automatically encrypted and stored locally on your device.</p>
<h2>Key Features</h2>
<ul>
  <li><strong>Local-First:</strong> All your documents live on your device first</li>
  <li><strong>End-to-End Encrypted:</strong> Only you and your collaborators can read your content</li>
  <li><strong>Peer-to-Peer Sync:</strong> No central server required for synchronization</li>
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
<p>Start writing your ideas below...</p>
`;

interface DocumentEditorProps {
  documentId?: string;
}

export const DocumentEditor: React.FC<DocumentEditorProps> = ({ documentId: propDocId }) => {
  const { documentId: paramDocId } = useParams<{ documentId: string }>();
  const documentId = propDocId || paramDocId;
  
  const { app } = useCalimero();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const initialFolderId = locationState?.folderId ?? null;
  
  const [documentName, setDocumentName] = useState('Untitled Document');
  const [document, setDocument] = useState<DocumentType | null>(null);
  const [isLoading, setIsLoading] = useState(!!documentId);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // Refs to access latest state in callbacks
  const documentRef = useRef<DocumentType | null>(null);
  const documentNameRef = useRef('Untitled Document');
  const hasUnsavedChangesRef = useRef(false);
  // Initialize with welcome content so first edits are computed as diffs from it
  const lastSavedContentRef = useRef<string>(welcomeContent);
  // Guard to prevent duplicate document creation
  const isCreatingDocumentRef = useRef(false);
  
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

  // Load document if documentId is provided
  useEffect(() => {
    const loadDocument = async () => {
      if (!documentId || !app) return;
      
      setIsLoading(true);
      try {
        const client = new AbiClient(app);
        const doc = await client.getDocument({ id: documentId });
        if (doc) {
          setDocument(doc);
          setDocumentName(doc.title);
          // Initialize lastSavedContent to track changes from loaded content
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
  }, [documentId, app, editor]);

  // Auto-save document on content change using set_content (full replacement)
  // NOTE: Incremental RGA operations (insert_text, delete_text) were causing documents
  // to disappear due to CRDT merge issues with the remove()+insert() pattern.
  // Using set_content as a workaround until the backend pattern is fixed.
  const saveDocument = useCallback(async (forceCreate = false) => {
    if (!app || !editor) return;
    
    const currentDoc = documentRef.current;
    const currentName = documentNameRef.current;
    const content = editor.getHTML();
    const lastContent = lastSavedContentRef.current;
    
    console.log('[saveDocument] Starting save, doc:', currentDoc?.id, 'forceCreate:', forceCreate, 'isCreating:', isCreatingDocumentRef.current);
    
    // Skip save if content hasn't changed (for existing docs)
    if (currentDoc && content === lastContent) {
      console.log('[saveDocument] Content unchanged, skipping');
      setHasUnsavedChanges(false);
      hasUnsavedChangesRef.current = false;
      return;
    }
    
    try {
      const client = new AbiClient(app);
      
      if (currentDoc) {
        // Use setContent for now - incremental operations were causing issues
        console.log('[saveDocument] Using setContent for doc:', currentDoc.id);
        await client.setContent({
          id: currentDoc.id,
          content,
        });
        console.log('[saveDocument] Content saved successfully');
        // Update last saved content after successful save
        lastSavedContentRef.current = content;
      } else if ((forceCreate || hasUnsavedChangesRef.current) && !isCreatingDocumentRef.current) {
        // Create new document with initial content - only if not already creating
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
          // Load the created document
          const newDoc = await client.getDocument({ id: newId });
          if (newDoc) {
            setDocument(newDoc);
            documentRef.current = newDoc;
            lastSavedContentRef.current = content;
          }
          // Navigate to the new document URL
          navigate(`/editor/${newId}`, { replace: true });
        } finally {
          isCreatingDocumentRef.current = false;
        }
      } else if (!currentDoc && isCreatingDocumentRef.current) {
        console.log('[saveDocument] Skipping - document creation already in progress');
      }
      setHasUnsavedChanges(false);
      hasUnsavedChangesRef.current = false;
    } catch (error) {
      console.error('[saveDocument] Failed to save:', error);
    }
  }, [app, editor, navigate, initialFolderId]);

  // Debounced auto-save
  useEffect(() => {
    if (!editor) return;

    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleUpdate = () => {
      setHasUnsavedChanges(true);
      hasUnsavedChangesRef.current = true;
      
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        saveDocument();
      }, 2000); // Save after 2 seconds of inactivity
    };

    editor.on('update', handleUpdate);
    
    return () => {
      editor.off('update', handleUpdate);
      if (timeout) clearTimeout(timeout);
    };
  }, [editor, saveDocument]);

  // Save on unmount (when navigating away) - only update existing documents
  // NOTE: We do NOT create new documents on unmount as this causes race conditions
  // with handleBack and auto-save. Only update existing documents.
  useEffect(() => {
    return () => {
      // Only save to existing documents on unmount
      if (hasUnsavedChangesRef.current && app && editor && documentRef.current) {
        const client = new AbiClient(app);
        const content = editor.getHTML();
        const currentDoc = documentRef.current;
        
        // Fire and forget - update existing document only
        console.log('[unmount] Saving to existing document:', currentDoc.id);
        client.setContent({ id: currentDoc.id, content }).catch(console.error);
      }
    };
  }, [app, editor]);

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
    if (!app || !editor) return;
    
    try {
      const client = new AbiClient(app);
      
      if (document) {
        // Update existing document title
        await client.updateDocumentMetadata({
          id: document.id,
          title: newName,
        });
      } else if (!isCreatingDocumentRef.current) {
        // Create new document when title is changed - only if not already creating
        isCreatingDocumentRef.current = true;
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
          // Load the created document and navigate
          const newDoc = await client.getDocument({ id: newId });
          if (newDoc) {
            setDocument(newDoc);
            documentRef.current = newDoc;
            lastSavedContentRef.current = content;
          }
          setHasUnsavedChanges(false);
          hasUnsavedChangesRef.current = false;
          navigate(`/editor/${newId}`, { replace: true });
        } finally {
          isCreatingDocumentRef.current = false;
        }
      } else {
        console.log('[handleDocumentNameChange] Skipping - document creation already in progress');
      }
    } catch (error) {
      console.error('Failed to save document:', error);
    }
  };

  const handleDelete = async () => {
    if (!document || !app) return;
    
    if (window.confirm('Are you sure you want to delete this document?')) {
      try {
        const client = new AbiClient(app);
        await client.deleteDocument({ id: document.id });
        navigate('/home');
      } catch (error) {
        console.error('Failed to delete document:', error);
      }
    }
  };

  // Handle back navigation - save first, then navigate
  const handleBack = async () => {
    console.log('[handleBack] hasUnsavedChanges:', hasUnsavedChanges, 'document:', document?.id, 'isCreating:', isCreatingDocumentRef.current);
    
    if (hasUnsavedChanges && app && editor) {
      try {
        const client = new AbiClient(app);
        const content = editor.getHTML();
        console.log('[handleBack] Saving content, length:', content.length);
        
        if (document) {
          // Use setContent for full replacement
          console.log('[handleBack] Using setContent for doc:', document.id);
          await client.setContent({ id: document.id, content });
          console.log('[handleBack] Content saved successfully');
        } else if (!isCreatingDocumentRef.current) {
          // Create new document only if not already creating
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

          <EditorStatusBar editor={editor} documentName={documentName} />
        </div>
      </div>
    </TooltipProvider>
  );
};

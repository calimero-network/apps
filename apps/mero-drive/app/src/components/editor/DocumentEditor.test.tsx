import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DocumentEditor } from './DocumentEditor';

const mockNavigate = vi.fn();
const mockGetDocument = vi.fn();
const mockSetContent = vi.fn();
const mockCreateDocument = vi.fn();
const mockUpdateDocumentMetadata = vi.fn();
const mockDeleteDocument = vi.fn();
const mockInsertText = vi.fn();
const mockDeleteText = vi.fn();
const mockReplaceText = vi.fn();

vi.mock('@calimero-network/calimero-client', () => ({
  useCalimero: () => ({ app: { id: 'test-app' } }),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ documentId: undefined }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/editor/new' }),
}));

vi.mock('@/api/AbiClient', () => ({
  AbiClient: vi.fn().mockImplementation(() => ({
    getDocument: mockGetDocument,
    setContent: mockSetContent,
    createDocument: mockCreateDocument,
    updateDocumentMetadata: mockUpdateDocumentMetadata,
    deleteDocument: mockDeleteDocument,
    insertText: mockInsertText,
    deleteText: mockDeleteText,
    replaceText: mockReplaceText,
  })),
  Document: {},
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('./EditorHeader', () => ({
  EditorHeader: ({ documentName, onDocumentNameChange, onDelete, onBack }: any) => (
    <div data-testid="editor-header">
      <span data-testid="doc-name">{documentName}</span>
      <button data-testid="back-btn" onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('./EditorToolbar', () => ({
  EditorToolbar: () => <div data-testid="editor-toolbar">Toolbar</div>,
}));

vi.mock('./EditorStatusBar', () => ({
  EditorStatusBar: ({ saveStatus, isAppReady, documentName }: any) => (
    <div data-testid="editor-status-bar">
      <span data-testid="save-status">{isAppReady === false ? 'Offline' : saveStatus}</span>
      <span data-testid="status-doc-name">{documentName}</span>
    </div>
  ),
}));

let mockEditorContent = '';
const mockGetHTML = vi.fn(() => mockEditorContent);
const mockSetContentCmd = vi.fn((content: string) => {
  mockEditorContent = content;
  return true;
});
const mockEditorOn = vi.fn();
const mockEditorOff = vi.fn();

vi.mock('@tiptap/react', () => ({
  useEditor: (config: any) => {
    mockEditorContent = config?.content ?? '';
    return {
      getHTML: mockGetHTML,
      commands: { setContent: mockSetContentCmd },
      state: { doc: { textContent: '' } },
      on: mockEditorOn,
      off: mockEditorOff,
      isActive: () => false,
      can: () => ({ undo: () => true, redo: () => true }),
      chain: () => ({ focus: () => ({ undo: () => ({ run: vi.fn() }) }) }),
      getAttributes: () => ({}),
    };
  },
  EditorContent: ({ editor }: any) => (
    <div data-testid="editor-content">{editor ? 'Editor loaded' : 'No editor'}</div>
  ),
}));

vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: () => ({}) },
}));
vi.mock('@tiptap/extension-underline', () => ({ default: {} }));
vi.mock('@tiptap/extension-link', () => ({
  default: { configure: () => ({}) },
}));
vi.mock('@tiptap/extension-placeholder', () => ({
  default: { configure: () => ({}) },
}));
vi.mock('@tiptap/extension-text-align', () => ({
  default: { configure: () => ({}) },
}));
vi.mock('@tiptap/extension-highlight', () => ({
  default: { configure: () => ({}) },
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockEditorContent = '';
  mockNavigate.mockReset();
  mockGetDocument.mockReset();
  mockSetContent.mockReset();
  mockCreateDocument.mockReset();
  mockUpdateDocumentMetadata.mockReset();
  mockDeleteDocument.mockReset();
  mockInsertText.mockReset();
  mockDeleteText.mockReset();
  mockReplaceText.mockReset();
  mockGetHTML.mockImplementation(() => mockEditorContent);
  mockEditorOn.mockReset();
  mockEditorOff.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DocumentEditor', () => {
  describe('HTML content flow', () => {
    it('renders the TipTap editor content area', () => {
      render(<DocumentEditor />);
      expect(screen.getByTestId('editor-content')).toBeTruthy();
      expect(screen.getByText('Editor loaded')).toBeTruthy();
    });

    it('initialises with welcome HTML content (not markdown)', () => {
      render(<DocumentEditor />);
      expect(mockEditorContent).toContain('<h1>');
      expect(mockEditorContent).not.toContain('# ');
    });
  });

  describe('autosave debouncing', () => {
    it('registers an update handler on the editor', () => {
      render(<DocumentEditor />);
      expect(mockEditorOn).toHaveBeenCalledWith('update', expect.any(Function));
    });

    it('schedules a setTimeout of 2000ms after editor update', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      render(<DocumentEditor />);

      const updateHandler = mockEditorOn.mock.calls.find(
        (c: any[]) => c[0] === 'update',
      )?.[1];
      expect(updateHandler).toBeDefined();

      const callsBefore = setTimeoutSpy.mock.calls.length;

      act(() => updateHandler());

      const newCalls = setTimeoutSpy.mock.calls.slice(callsBefore);
      const autosaveCall = newCalls.find((c) => c[1] === 2000);
      expect(autosaveCall).toBeDefined();

      setTimeoutSpy.mockRestore();
    });
  });

  describe('save path uses snapshot APIs only', () => {
    it('never calls insertText, deleteText, or replaceText on render or editor update', () => {
      render(<DocumentEditor />);

      const updateHandler = mockEditorOn.mock.calls.find(
        (c: any[]) => c[0] === 'update',
      )?.[1];

      mockEditorContent = '<p>new content</p>';
      mockGetHTML.mockReturnValue('<p>new content</p>');

      act(() => updateHandler());

      expect(mockInsertText).not.toHaveBeenCalled();
      expect(mockDeleteText).not.toHaveBeenCalled();
      expect(mockReplaceText).not.toHaveBeenCalled();
    });
  });

  describe('save status lifecycle', () => {
    it('starts with "saved" status for a new document', () => {
      render(<DocumentEditor />);
      expect(screen.getByTestId('save-status').textContent).toBe('saved');
    });

    it('transitions to "unsaved" after an editor update', () => {
      render(<DocumentEditor />);

      const updateHandler = mockEditorOn.mock.calls.find(
        (c: any[]) => c[0] === 'update',
      )?.[1];

      mockEditorContent = '<p>edited</p>';
      mockGetHTML.mockReturnValue('<p>edited</p>');

      act(() => updateHandler());

      expect(screen.getByTestId('save-status').textContent).toBe('unsaved');
    });
  });

  describe('title display', () => {
    it('shows "Untitled Document" by default', () => {
      render(<DocumentEditor />);
      expect(screen.getByTestId('doc-name').textContent).toBe('Untitled Document');
    });
  });

  describe('app readiness', () => {
    it('passes isAppReady to the status bar', () => {
      render(<DocumentEditor />);
      const statusBar = screen.getByTestId('editor-status-bar');
      expect(statusBar).toBeTruthy();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AbiClient } from './AbiClient';

const mockExecute = vi.fn();
const mockFetchContexts = vi.fn();

vi.mock('@calimero-network/calimero-client', () => ({
  CalimeroApp: vi.fn(),
}));

vi.mock('./AdminApi', () => ({
  adminRequest: vi.fn(),
}));

vi.mock('@/constants/config', () => ({
  getApplicationId: () => 'test-app-id',
}));

vi.mock('./contextIdJoin', () => ({
  buildContextIdCandidates: (id: string) => [id],
}));

function makeApp() {
  return {
    execute: mockExecute,
    fetchContexts: mockFetchContexts,
    createContext: vi.fn(),
  } as any;
}

function makeClient() {
  const app = makeApp();
  mockFetchContexts.mockResolvedValue([
    { contextId: 'ctx-1', executorId: 'exec-1', applicationId: 'test-app-id' },
  ]);
  return new AbiClient(app);
}

beforeEach(() => {
  mockExecute.mockReset();
  mockFetchContexts.mockReset();
});

describe('AbiClient — active editor flow', () => {
  describe('createDocument', () => {
    it('calls create_document with title, content, tags, and folder_id', async () => {
      const client = makeClient();
      mockExecute.mockResolvedValue({ success: true, result: 'doc-123' });

      const result = await client.createDocument({
        title: 'My Doc',
        content: '<h1>Hello</h1>',
        tags: ['draft'],
        folder_id: 'folder-1',
      });

      expect(result).toBe('doc-123');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.anything(),
        'create_document',
        {
          title: 'My Doc',
          content: '<h1>Hello</h1>',
          tags: ['draft'],
          folder_id: 'folder-1',
        },
      );
    });

    it('defaults folder_id to null when omitted', async () => {
      const client = makeClient();
      mockExecute.mockResolvedValue({ success: true, result: 'doc-456' });

      await client.createDocument({
        title: 'Root Doc',
        content: '<p>text</p>',
        tags: [],
      });

      const params = mockExecute.mock.calls[0][2];
      expect(params.folder_id).toBeNull();
    });

    it('throws on backend failure', async () => {
      const client = makeClient();
      mockExecute.mockResolvedValue({ success: false, error: 'boom' });

      await expect(
        client.createDocument({ title: 'x', content: '', tags: [] }),
      ).rejects.toThrow('boom');
    });
  });

  describe('setContent', () => {
    it('calls set_content with doc_id and HTML content', async () => {
      const client = makeClient();
      mockExecute.mockResolvedValue({ success: true, result: undefined });

      await client.setContent({ id: 'doc-1', content: '<p>updated</p>' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.anything(),
        'set_content',
        { doc_id: 'doc-1', content: '<p>updated</p>' },
      );
    });

    it('throws on backend failure', async () => {
      const client = makeClient();
      mockExecute.mockResolvedValue({ success: false, error: 'write error' });

      await expect(
        client.setContent({ id: 'doc-1', content: '' }),
      ).rejects.toThrow('write error');
    });
  });

  describe('getDocument', () => {
    it('calls get_document and returns the document', async () => {
      const client = makeClient();
      const doc = {
        id: 'doc-1',
        title: 'Test',
        content: '<p>hello</p>',
        author: 'alice',
        created_at: 1000,
        updated_at: 2000,
        tags: [],
        archived: false,
        folder_id: null,
      };
      mockExecute.mockResolvedValue({ success: true, result: doc });

      const result = await client.getDocument({ id: 'doc-1' });

      expect(result).toEqual(doc);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.anything(),
        'get_document',
        { doc_id: 'doc-1' },
      );
    });

    it('returns null when document not found', async () => {
      const client = makeClient();
      mockExecute.mockResolvedValue({ success: true, result: null });

      const result = await client.getDocument({ id: 'missing' });
      expect(result).toBeNull();
    });
  });

  describe('getContent', () => {
    it('calls get_content and returns HTML string', async () => {
      const client = makeClient();
      mockExecute.mockResolvedValue({
        success: true,
        result: '<h1>Title</h1>',
      });

      const result = await client.getContent({ id: 'doc-1' });
      expect(result).toBe('<h1>Title</h1>');
    });
  });

  describe('updateDocumentMetadata', () => {
    it('calls update_document_metadata with doc_id and title', async () => {
      const client = makeClient();
      mockExecute.mockResolvedValue({ success: true, result: undefined });

      await client.updateDocumentMetadata({ id: 'doc-1', title: 'New Title' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.anything(),
        'update_document_metadata',
        { doc_id: 'doc-1', title: 'New Title', archived: undefined },
      );
    });
  });
});

describe('AbiClient — low-level RGA methods exist but are separate', () => {
  it('exposes insertText that calls insert_text', async () => {
    const client = makeClient();
    mockExecute.mockResolvedValue({ success: true, result: undefined });

    await client.insertText({ id: 'doc-1', position: 5, text: 'X' });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.anything(),
      'insert_text',
      { doc_id: 'doc-1', position: 5, text: 'X' },
    );
  });

  it('exposes deleteText that calls delete_text', async () => {
    const client = makeClient();
    mockExecute.mockResolvedValue({ success: true, result: undefined });

    await client.deleteText({ id: 'doc-1', start: 0, end: 3 });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.anything(),
      'delete_text',
      { doc_id: 'doc-1', start: 0, end: 3 },
    );
  });

  it('exposes replaceText that calls replace_text', async () => {
    const client = makeClient();
    mockExecute.mockResolvedValue({ success: true, result: undefined });

    await client.replaceText({ id: 'doc-1', start: 0, end: 3, text: 'new' });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.anything(),
      'replace_text',
      { doc_id: 'doc-1', start: 0, end: 3, text: 'new' },
    );
  });
});

describe('AbiClient — document query methods', () => {
  it('listDocuments calls list_documents', async () => {
    const client = makeClient();
    mockExecute.mockResolvedValue({ success: true, result: [] });

    const result = await client.listDocuments({ include_archived: false });
    expect(result).toEqual([]);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.anything(),
      'list_documents',
      { include_archived: false },
    );
  });

  it('searchDocuments calls search_documents', async () => {
    const client = makeClient();
    mockExecute.mockResolvedValue({ success: true, result: [] });

    await client.searchDocuments({ query: 'test', include_archived: true });
    expect(mockExecute).toHaveBeenCalledWith(
      expect.anything(),
      'search_documents',
      { query: 'test', include_archived: true },
    );
  });

  it('deleteDocument calls delete_document', async () => {
    const client = makeClient();
    mockExecute.mockResolvedValue({ success: true, result: undefined });

    await client.deleteDocument({ id: 'doc-1' });
    expect(mockExecute).toHaveBeenCalledWith(
      expect.anything(),
      'delete_document',
      { doc_id: 'doc-1' },
    );
  });
});

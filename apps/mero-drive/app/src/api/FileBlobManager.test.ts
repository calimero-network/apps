import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileBlobManager } from './FileBlobManager';
import { blobClient } from '@calimero-network/calimero-client';

vi.mock('@calimero-network/calimero-client', () => ({
  blobClient: {
    uploadBlob: vi.fn(),
  },
}));

vi.mock('./AdminApi', () => ({
  getNodeEndpoint: () => 'http://localhost:2428',
  getAdminHeaders: () => ({ 'Content-Type': 'application/json' }),
}));

describe('FileBlobManager', () => {
  let manager: FileBlobManager;

  beforeEach(() => {
    manager = new FileBlobManager();
    vi.clearAllMocks();
  });

  describe('uploadFile', () => {
    it('returns blobId and size on success', async () => {
      vi.mocked(blobClient.uploadBlob).mockResolvedValue({
        data: { blobId: 'blob-123', size: 1024 },
        error: null,
      });

      const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
      const result = await manager.uploadFile(file);

      expect(result).toEqual({ blobId: 'blob-123', size: 1024 });
      expect(blobClient.uploadBlob).toHaveBeenCalledWith(file, undefined);
    });

    it('passes onProgress callback', async () => {
      vi.mocked(blobClient.uploadBlob).mockResolvedValue({
        data: { blobId: 'blob-456', size: 2048 },
        error: null,
      });

      const file = new File(['data'], 'file.bin');
      const onProgress = vi.fn();
      await manager.uploadFile(file, onProgress);

      expect(blobClient.uploadBlob).toHaveBeenCalledWith(file, onProgress);
    });

    it('accepts snake_case blob response payload', async () => {
      vi.mocked(blobClient.uploadBlob).mockResolvedValue({
        data: { blob_id: 'blob-snake', size: 2 } as any,
        error: null,
      });

      const file = new File(['ok'], 'snake.txt');
      const result = await manager.uploadFile(file);

      expect(result).toEqual({ blobId: 'blob-snake', size: 2 });
    });

    it('accepts nested data payload from wrapped clients', async () => {
      vi.mocked(blobClient.uploadBlob).mockResolvedValue({
        data: { data: { blob_id: 'blob-nested', size: '2' } } as any,
        error: null,
      });

      const file = new File(['ok'], 'nested.txt');
      const result = await manager.uploadFile(file);

      expect(result).toEqual({ blobId: 'blob-nested', size: 2 });
    });

    it('accepts deeply nested payload wrappers', async () => {
      vi.mocked(blobClient.uploadBlob).mockResolvedValue({
        data: {
          result: {
            payload: {
              data: {
                blob_id: 'blob-deep',
                size: 3,
              },
            },
          },
        } as any,
        error: null,
      });

      const file = new File(['ok'], 'deep.txt');
      const result = await manager.uploadFile(file);

      expect(result).toEqual({ blobId: 'blob-deep', size: 3 });
    });

    it('accepts JSON-string payload', async () => {
      vi.mocked(blobClient.uploadBlob).mockResolvedValue({
        data: JSON.stringify({
          data: {
            blob_id: 'blob-string',
            size: 2,
          },
        }) as any,
        error: null,
      });

      const file = new File(['ok'], 'string.txt');
      const result = await manager.uploadFile(file);

      expect(result).toEqual({ blobId: 'blob-string', size: 2 });
    });

    it('throws on upload error', async () => {
      vi.mocked(blobClient.uploadBlob).mockResolvedValue({
        data: null,
        error: { code: 500, message: 'Server error' },
      });

      const file = new File(['x'], 'bad.txt');
      await expect(manager.uploadFile(file)).rejects.toThrow('Server error');
    });

    it('throws when data is missing', async () => {
      vi.mocked(blobClient.uploadBlob).mockResolvedValue({
        data: null as any,
        error: null,
      });

      const file = new File(['x'], 'empty.txt');
      await expect(manager.uploadFile(file)).rejects.toThrow('Blob upload failed');
    });

    it('throws when response payload shape is invalid', async () => {
      vi.mocked(blobClient.uploadBlob).mockResolvedValue({
        data: { size: 10 } as any,
        error: null,
      });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { size: 10 } }),
      });

      const file = new File(['x'], 'invalid.txt');
      await expect(manager.uploadFile(file)).rejects.toThrow(
        'Blob upload returned an invalid response payload.',
      );
    });
  });

  describe('downloadFile', () => {
    it('fetches blob from admin API with context_id', async () => {
      const mockBlob = new Blob(['file-content']);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      const result = await manager.downloadFile('blob-123', 'ctx-456');

      expect(result).toBe(mockBlob);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:2428/admin-api/blobs/blob-123?context_id=ctx-456',
        { headers: { 'Content-Type': 'application/json' } },
      );
    });

    it('throws on download failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(manager.downloadFile('bad-id', 'ctx-1')).rejects.toThrow(
        'Download failed: 404 Not Found',
      );
    });

    it('retries with base58 context id when hex format is rejected', async () => {
      const mockBlob = new Blob(['file-content']);
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
        })
        .mockResolvedValueOnce({
          ok: true,
          blob: () => Promise.resolve(mockBlob),
        });

      const hexContextId = 'b894283d386c7e1428fac965260c9a745327e5c3c5f2e9571768f8c3a9ac3f03';
      const result = await manager.downloadFile('blob-123', hexContextId);

      expect(result).toBe(mockBlob);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      const firstCallUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      const secondCallUrl = vi.mocked(globalThis.fetch).mock.calls[1][0] as string;
      expect(firstCallUrl).toContain('/admin-api/blobs/blob-123?context_id=');
      expect(secondCallUrl).toContain('/admin-api/blobs/blob-123?context_id=');
      expect(firstCallUrl).not.toBe(secondCallUrl);
      expect(firstCallUrl.includes(hexContextId) || secondCallUrl.includes(hexContextId)).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// blob.ts only uses mero-react for the node URL; stub it so tests don't depend
// on mero-react's localStorage-availability cache (fragile under node).
vi.mock('@calimero-network/mero-react', () => ({
  getNodeUrl: () => 'http://node.local:2528',
}));

import {
  formatBytes,
  isImageMime,
  getAccessToken,
  uploadBlob,
  downloadBlob,
  MAX_ATTACHMENT_SIZE,
} from './blob';

// In-memory localStorage so getNodeUrl (mero-react) + getAccessToken resolve.
function installLocalStorage(values: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(values));
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}

describe('blob helpers (pure)', () => {
  it('formatBytes renders human sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('isImageMime detects images only', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
    expect(isImageMime(undefined)).toBe(false);
    expect(isImageMime(null)).toBe(false);
  });
});

describe('getAccessToken', () => {
  afterEach(() => { delete (globalThis as any).localStorage; });

  it('reads the access token from the mero-tokens blob', () => {
    installLocalStorage({ 'mero-tokens': JSON.stringify({ access_token: 'jwt-123' }) });
    expect(getAccessToken()).toBe('jwt-123');
  });

  it('returns empty string when missing or malformed', () => {
    installLocalStorage({ 'mero-tokens': 'not json' });
    expect(getAccessToken()).toBe('');
    installLocalStorage({});
    expect(getAccessToken()).toBe('');
  });
});

describe('uploadBlob / downloadBlob', () => {
  beforeEach(() => {
    installLocalStorage({
      'mero:node_url': 'http://node.local:2528',
      'mero-tokens': JSON.stringify({ access_token: 'jwt-xyz' }),
    });
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
    vi.unstubAllGlobals();
  });

  function fakeFile(bytes: number, type = 'image/png', name = 'pic.png'): File {
    const data = new Uint8Array(bytes);
    return new File([data], name, { type });
  }

  it('rejects an empty file', async () => {
    await expect(uploadBlob(fakeFile(0))).rejects.toThrow(/empty/i);
  });

  it('rejects a file over the size cap', async () => {
    const big = { size: MAX_ATTACHMENT_SIZE + 1, name: 'big.png', type: 'image/png',
      arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;
    await expect(uploadBlob(big)).rejects.toThrow(/too large/i);
  });

  it('PUTs bytes with auth + returns the blob id', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ data: { blob_id: 'blob-abc', size: 4 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const res = await uploadBlob(fakeFile(4));
    expect(res).toEqual({ blobId: 'blob-abc', size: 4 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://node.local:2528/admin-api/blobs');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-xyz');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
  });

  it('accepts camelCase blobId responses too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ blobId: 'blob-cc', size: 9 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    expect(await uploadBlob(fakeFile(9))).toEqual({ blobId: 'blob-cc', size: 9 });
  });

  it('throws on a non-OK upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500, statusText: 'Server Error' })));
    await expect(uploadBlob(fakeFile(3))).rejects.toThrow(/Upload failed/);
  });

  it('downloadBlob requests the blob scoped to the context', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await downloadBlob('blob-abc', 'ctx-1');
    expect(out).toBeInstanceOf(Blob);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/admin-api/blobs/blob-abc');
    expect(url.searchParams.get('context_id')).toBe('ctx-1');
  });

  it('downloadBlob throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' })));
    await expect(downloadBlob('missing', 'ctx-1')).rejects.toThrow(/Download failed/);
  });
});

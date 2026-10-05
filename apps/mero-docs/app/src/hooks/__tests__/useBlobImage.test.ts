import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HTTPError } from '@calimero-network/mero-js';
import { useBlobImage } from '../useBlobImage';

const getBlob = vi.fn();
const mero = { admin: { getBlob } }; // the provider hands out one client
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ mero, admin: mero.admin }),
}));

const ID = 'cd'.repeat(32);
const CTX = 'ctx-1';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const httpError = (status: number) =>
  new HTTPError(status, 'x', `http://node/admin-api/blobs/${ID}`, new Headers(), '');

let created: Blob[] = [];
const createObjectURL = vi.fn((blob: Blob) => {
  created.push(blob);
  return `blob:test/${created.length}`;
});
const revokeObjectURL = vi.fn();

beforeEach(() => {
  created = [];
  getBlob.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});
afterEach(() => vi.useRealTimers());

const show = (ref: string, contextId: string | null = CTX) =>
  renderHook(() => useBlobImage(ref, contextId));
// Lets pending reads settle, so a call that should not happen has had its chance.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('useBlobImage', () => {
  it("reads the blob through the folder's context and shows it as its own type", async () => {
    getBlob.mockResolvedValue(PNG.buffer);
    const { result } = show(`blob:${ID}`);
    expect(result.current.image).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.image.status).toBe('loaded'));
    expect(getBlob).toHaveBeenCalledWith(ID, { contextId: CTX });
    expect(result.current.image).toEqual({ status: 'loaded', url: 'blob:test/1' });
    expect(created[0].type).toBe('image/png');
  });

  it('fetches a blob once for every block showing it, and revokes it after the last one goes', async () => {
    getBlob.mockResolvedValue(PNG.buffer);
    const { unmount: closeFirst } = show(`blob:${ID}`);
    const { result, unmount: closeSecond } = show(`blob:${ID}`);
    await waitFor(() => expect(result.current.image.status).toBe('loaded'));
    expect(getBlob).toHaveBeenCalledTimes(1);

    closeFirst();
    await settle();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    closeSecond();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1'));
  });

  it('refuses bytes that are not an allowed image, without an object URL', async () => {
    getBlob.mockResolvedValue(SVG.buffer);
    const { result } = show(`blob:${ID}`);
    await waitFor(() => expect(result.current.image).toEqual({ status: 'broken' }));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('never fetches a url that is not a blob reference', async () => {
    const { result } = show('https://example.com/a.png');
    expect(result.current.image).toEqual({ status: 'broken' });
    await settle();
    expect(getBlob).not.toHaveBeenCalled();
  });

  it('tells a session refused blob access apart from a blob no peer serves', async () => {
    getBlob.mockRejectedValueOnce(httpError(403));
    const { result: denied } = show(`blob:${ID}`);
    await waitFor(() => expect(denied.current.image).toEqual({ status: 'denied' }));

    getBlob.mockRejectedValueOnce(httpError(404));
    const { result: missing } = show(`blob:${'ef'.repeat(32)}`);
    await waitFor(() => expect(missing.current.image).toEqual({ status: 'unavailable' }));
  });

  it('reads again on retry after a failure', async () => {
    getBlob.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = show(`blob:${ID}`);
    await waitFor(() => expect(result.current.image.status).toBe('unavailable'));

    getBlob.mockResolvedValueOnce(PNG.buffer);
    act(() => result.current.retry());
    expect(result.current.image).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.image.status).toBe('loaded'));
    expect(getBlob).toHaveBeenCalledTimes(2);
  });

  it('waits for the context before reading', async () => {
    const { result } = show(`blob:${ID}`, null);
    expect(result.current.image).toEqual({ status: 'loading' });
    await settle();
    expect(getBlob).not.toHaveBeenCalled();
  });
});

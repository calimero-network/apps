import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCreateDocument } from '../useCreateDocument';
import type { UseDocsState } from '../useDocs';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useCreateDocument', () => {
  it('ignores a second create() call while the first is still in flight', async () => {
    const first = deferred<string>();
    const create = vi.fn().mockReturnValueOnce(first.promise);
    const docs = { create } as unknown as Pick<UseDocsState, 'create'>;
    const onOpenDoc = vi.fn();
    const { result } = renderHook(() =>
      useCreateDocument(docs, 'folder-1', onOpenDoc),
    );

    const p1 = result.current.create();
    const p2 = result.current.create();

    expect(create).toHaveBeenCalledTimes(1);
    first.resolve('doc-1');
    await Promise.all([p1, p2]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(onOpenDoc).toHaveBeenCalledTimes(1);
    expect(onOpenDoc).toHaveBeenCalledWith('folder-1', 'doc-1');
  });

  it('allows a new create() once the previous one has settled', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const create = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const docs = { create } as unknown as Pick<UseDocsState, 'create'>;
    const onOpenDoc = vi.fn();
    const { result } = renderHook(() =>
      useCreateDocument(docs, 'folder-1', onOpenDoc),
    );

    const p1 = result.current.create();
    first.resolve('doc-1');
    await p1;
    await waitFor(() => expect(result.current.creating).toBe(false));

    const p2 = result.current.create();
    second.resolve('doc-2');
    await p2;

    expect(create).toHaveBeenCalledTimes(2);
    expect(onOpenDoc).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { useDocumentInspector } from '../useDocumentInspector';

const client = {
  getTitle: vi.fn().mockResolvedValue('Notes'),
  getStateDigest: vi.fn().mockResolvedValue('digest-abc'),
  getDocument: vi.fn().mockResolvedValue([
    {
      id: 'blk-1',
      kind: 'heading',
      depth: 0,
      attrs: { level: '1' },
      spans: [
        { text: 'Hello ', attributes: {} },
        { text: 'world', attributes: { bold: 'true' } },
      ],
    },
  ]),
};

const mount = (docId: string | null = 'doc-1') =>
  renderHook(() =>
    useDocumentInspector(client as unknown as DocsClient, docId),
  );

describe('useDocumentInspector', () => {
  it('reads nothing until asked', () => {
    const { result } = mount();
    expect(result.current.snapshot).toBeNull();
    expect(client.getDocument).not.toHaveBeenCalled();
  });

  it('reports the title, the digest and one row per block', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.read();
    });
    expect(result.current.snapshot?.title).toBe('Notes');
    expect(result.current.snapshot?.digest).toBe('digest-abc');
    expect(result.current.snapshot?.blocks).toEqual([
      {
        id: 'blk-1',
        kind: 'heading',
        depth: 0,
        attrs: { level: '1' },
        text: 'Hello world',
      },
    ]);
  });

  it('does nothing without a document', async () => {
    const { result } = mount(null);
    await act(async () => {
      await result.current.read();
    });
    expect(result.current.snapshot).toBeNull();
  });

  it('surfaces a failed read', async () => {
    client.getStateDigest.mockRejectedValueOnce(new Error('not a member'));
    const { result } = mount();
    await act(async () => {
      await result.current.read();
    });
    await waitFor(() =>
      expect(result.current.error?.message).toBe('not a member'),
    );
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { liveRecent, useRecentDocs } from '../useRecentDocs';
import type { IndexRow } from '@/lib/workspaceIndex/types';

const KEY = 'mero-drive:recent:ws1';

function row(folderId: string, docId: string, archived = false): IndexRow {
  return {
    folderId,
    docId,
    title: docId,
    tags: [],
    archived,
    createdAt: 0,
    updatedAt: 0,
    createdBy: 'a',
    updatedBy: 'a',
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRecentDocs', () => {
  it('keeps the newest open first, once per doc, and stores it for this workspace', () => {
    const { result } = renderHook(() => useRecentDocs('ws1'));
    act(() => result.current.touch('f1', 'a'));
    vi.setSystemTime(2_000);
    act(() => result.current.touch('f1', 'b'));
    vi.setSystemTime(3_000);
    act(() => result.current.touch('f1', 'a'));

    expect(result.current.recent).toEqual([
      { folderId: 'f1', docId: 'a', openedAt: 3_000 },
      { folderId: 'f1', docId: 'b', openedAt: 2_000 },
    ]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(
      result.current.recent,
    );
  });

  it('keeps at most 8', () => {
    const { result } = renderHook(() => useRecentDocs('ws1'));
    for (let i = 0; i < 10; i++) act(() => result.current.touch('f', `d${i}`));
    expect(result.current.recent.map((r) => r.docId)).toEqual([
      'd9',
      'd8',
      'd7',
      'd6',
      'd5',
      'd4',
      'd3',
      'd2',
    ]);
  });

  it('reads each workspace its own list, and follows a workspace switch', () => {
    localStorage.setItem(
      'mero-drive:recent:ws2',
      JSON.stringify([{ folderId: 'g', docId: 'z', openedAt: 5 }]),
    );
    const { result, rerender } = renderHook(({ ws }) => useRecentDocs(ws), {
      initialProps: { ws: 'ws1' },
    });
    act(() => result.current.touch('f', 'a'));
    rerender({ ws: 'ws2' });
    expect(result.current.recent).toEqual([
      { folderId: 'g', docId: 'z', openedAt: 5 },
    ]);
    rerender({ ws: 'ws1' });
    expect(result.current.recent.map((r) => r.docId)).toEqual(['a']);
  });

  it('ignores a stored value it cannot read, and malformed entries', () => {
    localStorage.setItem(KEY, '{not json');
    expect(
      renderHook(() => useRecentDocs('ws1')).result.current.recent,
    ).toEqual([]);
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { folderId: 'f', docId: 'ok', openedAt: 1 },
        { folderId: 'f', docId: 7, openedAt: 1 },
        'junk',
        null,
      ]),
    );
    expect(
      renderHook(() => useRecentDocs('ws1')).result.current.recent,
    ).toEqual([{ folderId: 'f', docId: 'ok', openedAt: 1 }]);
  });
});

describe('liveRecent', () => {
  it('drops entries whose doc is gone or archived, keeping the order', () => {
    const recent = [
      { folderId: 'f', docId: 'kept', openedAt: 3 },
      { folderId: 'f', docId: 'deleted', openedAt: 2 },
      { folderId: 'f', docId: 'archived', openedAt: 1 },
      { folderId: 'g', docId: 'also', openedAt: 0 },
    ];
    const rows = [
      row('f', 'archived', true),
      row('g', 'also'),
      row('f', 'kept'),
    ];
    expect(liveRecent(recent, rows).map((r) => r.row.docId)).toEqual([
      'kept',
      'also',
    ]);
  });
});

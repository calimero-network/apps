import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { peersByDoc, useFolderPresence } from '../usePresenceByDoc';

const useEphemeral = vi.fn();
vi.mock('@calimero-network/mero-react', () => ({
  useEphemeral: (...args: unknown[]) => useEphemeral(...args),
}));

const slice = (docId: string, name: string, colour = '#123456') => ({
  docId,
  blockId: null,
  anchor: '',
  head: '',
  name,
  colour,
});

describe('peersByDoc', () => {
  it('groups one folder’s readers by doc, keyed like index rows', () => {
    const map = peersByDoc(
      'f1',
      new Map([
        ['bob-node', slice('d1', 'Bob', '#ff0000')],
        ['cy-node', slice('d1', 'Cy')],
        ['di-node', slice('d2', 'Di')],
      ]),
    );
    expect(map.get('f1/d1')).toEqual([
      { id: 'bob-node', name: 'Bob', colour: '#ff0000' },
      { id: 'cy-node', name: 'Cy', colour: '#123456' },
    ]);
    expect(map.get('f1/d2')?.map((p) => p.name)).toEqual(['Di']);
  });

  it('drops a reader who left or sent a slice with no doc', () => {
    const map = peersByDoc(
      'f1',
      new Map<string, unknown>([
        ['gone', {}],
        ['swept', undefined],
        ['junk', { docId: 7 }],
      ]),
    );
    expect(map.size).toBe(0);
  });

  it('never shows a key for a reader with no name', () => {
    const map = peersByDoc('f1', new Map([['anon-node', slice('d1', '  ')]]));
    expect(map.get('f1/d1')?.[0].name).toBe('Unnamed member');
  });
});

describe('useFolderPresence', () => {
  it('reads the folder’s docs context, leaving yourself out', () => {
    useEphemeral.mockReturnValue({
      peers: new Map([['bob-node', slice('d1', 'Bob')]]),
      ageOf: () => 0,
    });
    const { result } = renderHook(() => useFolderPresence('f1', 'ctx-1'));
    expect(useEphemeral).toHaveBeenCalledWith('ctx-1');
    expect(result.current.get('f1/d1')?.[0].name).toBe('Bob');
  });

  afterEach(() => vi.useRealTimers());

  it('drops a reader whose closed tab stopped refreshing, on the next beat', () => {
    vi.useFakeTimers();
    const ages = new Map([
      ['bob-node', 1_000],
      ['ghost-node', 20_000],
    ]);
    const ageOf = (author: string) => ages.get(author);
    const peers = new Map([
      ['bob-node', slice('d1', 'Bob')],
      ['ghost-node', slice('d1', 'Ghost')],
    ]);
    useEphemeral.mockReturnValue({ peers, ageOf });
    const { result } = renderHook(() => useFolderPresence('f1', 'ctx-1'));
    expect(result.current.get('f1/d1')).toHaveLength(2);
    ages.set('ghost-node', 25_000);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.get('f1/d1')?.map((p) => p.name)).toEqual(['Bob']);
  });
});

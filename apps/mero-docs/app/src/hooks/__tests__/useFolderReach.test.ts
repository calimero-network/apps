// Folder access for a mentioned member, read from the node's effective member
// list of the open doc's own folder, over a faked node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { canOpenFolder, useFolderReach } from '../useFolderReach';

const lists = new Map<string, () => Promise<unknown>>();
const listGroupMembers = vi.fn((folder: string) => lists.get(folder)!());
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ mero: {}, admin: { listGroupMembers } }),
  useAddGroupMembers: () => ({ addGroupMembers: vi.fn() }),
  useRemoveGroupMembers: () => ({ removeGroupMembers: vi.fn() }),
}));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ selfIdentity: 'me', registryContextId: null }),
}));
let membershipEvent = () => {};
vi.mock('../useContextEvents', () => ({
  useContextEvents: (_ctx: unknown, onEvent: () => void) => {
    membershipEvent = onEvent;
  },
}));

const listed = (...ids: string[]) =>
  Promise.resolve({ members: ids.map((identity) => ({ identity })) });

beforeEach(() => lists.clear());
afterEach(() => vi.clearAllMocks());

describe('canOpenFolder', () => {
  const read = {
    members: [{ identity: 'me' }, { identity: 'bob' }],
    readFor: 'f1',
  };

  it('answers from the list read for this folder', () => {
    expect(canOpenFolder(read, 'f1', 'bob', 'me')).toBe(true);
    expect(canOpenFolder(read, 'f1', 'zed', 'me')).toBe(false);
  });

  it('does not know from a list read for another folder, or none', () => {
    expect(canOpenFolder(read, 'f2', 'bob', 'me')).toBeUndefined();
    expect(
      canOpenFolder({ ...read, readFor: null }, 'f1', 'bob', 'me'),
    ).toBeUndefined();
    expect(canOpenFolder(read, undefined, 'bob', 'me')).toBeUndefined();
  });

  it('does not know from a list without you, since you can open the doc', () => {
    expect(
      canOpenFolder(
        { members: [{ identity: 'bob' }], readFor: 'f1' },
        'f1',
        'zed',
        'me',
      ),
    ).toBeUndefined();
  });
});

describe('useFolderReach', () => {
  it('says a Guest the node does not list for an open folder cannot open it', async () => {
    lists.set('open', () => listed('me', 'bob'));
    const { result } = renderHook(() => useFolderReach('open'));
    await waitFor(() => expect(result.current('bob')).toBe(true));
    expect(result.current('guest')).toBe(false);
    expect(listGroupMembers).toHaveBeenCalledWith('open');
  });

  it('never checks a new folder against the old folder list', async () => {
    lists.set('a', () => listed('me', 'bob'));
    let answer: (v: unknown) => void = () => {};
    lists.set('b', () => new Promise((resolve) => (answer = resolve)));
    const { result, rerender } = renderHook(({ f }) => useFolderReach(f), {
      initialProps: { f: 'a' },
    });
    await waitFor(() => expect(result.current('bob')).toBe(true));
    rerender({ f: 'b' });
    expect(result.current('bob')).toBeUndefined();
    await act(async () => answer({ members: [{ identity: 'me' }] }));
    expect(result.current('bob')).toBe(false);
  });

  it('keeps the last good list while a refetch runs and after it fails', async () => {
    lists.set('a', () => listed('me', 'bob'));
    const { result } = renderHook(() => useFolderReach('a'));
    await waitFor(() => expect(result.current('bob')).toBe(true));
    let fail: (e: Error) => void = () => {};
    lists.set('a', () => new Promise((_, reject) => (fail = reject)));
    act(() => membershipEvent());
    expect(result.current('bob')).toBe(true);
    await act(async () => fail(new Error('offline')));
    expect(result.current('bob')).toBe(true);
  });
});

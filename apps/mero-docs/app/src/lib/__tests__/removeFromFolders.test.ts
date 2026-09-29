import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeFromFolders } from '../removeFromFolders';

const BOB = 'b'.repeat(64);
let rows: Record<string, { identity: string }[]>;
const admin = {
  listGroupMembers: vi.fn(async (g: string) => ({ members: rows[g] ?? [] })),
  removeGroupMembers: vi.fn(async (_g: string, _r: { members: string[] }) => {}),
};

beforeEach(() => {
  vi.clearAllMocks();
  rows = {};
});

describe('removeFromFolders', () => {
  // Core does not carry a workspace removal into its folders' direct rows.
  it('removes the member from every folder that still lists them', async () => {
    rows = { a: [{ identity: BOB }], b: [], c: [{ identity: BOB }] };
    expect(await removeFromFolders(admin, ['a', 'b', 'c'], BOB)).toEqual([]);
    expect(admin.removeGroupMembers.mock.calls).toEqual([
      ['a', { members: [BOB] }],
      ['c', { members: [BOB] }],
    ]);
  });

  it('names the folders it could not remove them from and carries on', async () => {
    rows = { a: [{ identity: BOB }], c: [{ identity: BOB }] };
    admin.removeGroupMembers.mockRejectedValueOnce(new Error('403'));
    expect(await removeFromFolders(admin, ['a', 'c'], BOB)).toEqual(['a']);
    expect(admin.removeGroupMembers).toHaveBeenCalledWith('c', { members: [BOB] });
  });
});

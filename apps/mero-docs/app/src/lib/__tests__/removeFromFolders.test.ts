import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeFromFolders } from '../removeFromFolders';

const BOB = 'b'.repeat(64);
// Folders where Bob holds a direct row, and Open folders that list him while
// the parent does (core lists an inheritor, with no row of its own).
let direct: Set<string>;
let inheritsFrom: Record<string, string>;
const listed = (g: string): boolean =>
  direct.has(g) || (g in inheritsFrom && listed(inheritsFrom[g]));
const admin = {
  listGroupMembers: vi.fn(async (g: string) => ({ members: listed(g) ? [{ identity: BOB }] : [] })),
  removeGroupMembers: vi.fn(async (g: string, _r: { members: string[] }) => {
    direct.delete(g);
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  direct = new Set();
  inheritsFrom = {};
});

describe('removeFromFolders', () => {
  // Core does not carry a workspace removal into its folders' direct rows.
  it('removes the member from every folder where they hold a direct row', async () => {
    direct = new Set(['a', 'c']);
    const folders = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: null },
      { id: 'c', parent_id: null },
    ];
    expect(await removeFromFolders(admin, folders, BOB)).toEqual([]);
    expect(admin.removeGroupMembers.mock.calls).toEqual([
      ['a', { members: [BOB] }],
      ['c', { members: [BOB] }],
    ]);
  });

  // A removal from an Open folder is a ban there, so an inheritor must not get one.
  it('goes parents first and never removes a member an Open child only inherits', async () => {
    direct = new Set(['parent']);
    inheritsFrom = { child: 'parent' };
    const folders = [
      { id: 'child', parent_id: 'parent' },
      { id: 'parent', parent_id: null },
    ];
    await removeFromFolders(admin, folders, BOB);
    expect(admin.removeGroupMembers.mock.calls).toEqual([['parent', { members: [BOB] }]]);
  });

  it('names the folders it could not remove them from and carries on', async () => {
    direct = new Set(['a', 'c']);
    admin.removeGroupMembers.mockRejectedValueOnce(new Error('403'));
    const folders = [
      { id: 'a', parent_id: null },
      { id: 'c', parent_id: null },
    ];
    expect(await removeFromFolders(admin, folders, BOB)).toEqual(['a']);
    expect(admin.removeGroupMembers).toHaveBeenCalledWith('c', { members: [BOB] });
  });
});

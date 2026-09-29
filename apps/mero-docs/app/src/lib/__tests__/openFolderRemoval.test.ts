import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  banAcrossOpenSubtree,
  removedFrom,
  restoreAcrossOpenSubtree,
} from '../openFolderRemoval';
import { CAPABILITIES } from '@/constants/config';

const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const GUEST = 'd'.repeat(64);
const JOIN = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS;
const folders = [
  { id: 'g', parent_id: null, visibility: 'Open' as const },
  { id: 'g2', parent_id: 'g', visibility: 'Open' as const },
  { id: 'h', parent_id: 'g', visibility: 'Restricted' as const },
];
let lists: Record<string, { identity: string; role?: string }[]>;
let caps: Record<string, number>;
const admin = {
  listGroupMembers: vi.fn(async (g: string) => ({ members: lists[g] ?? [] })),
  removeGroupMembers: vi.fn(
    async (_g: string, _r: { members: string[] }) => {},
  ),
  addGroupMembers: vi.fn(
    async (
      _g: string,
      _r: { members: { identity: string; role: string }[] },
    ) => {},
  ),
  getMemberCapabilities: vi.fn(async (_g: string, m: string) => ({
    capabilities: caps[m] ?? 0,
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  lists = {};
  caps = {};
});

describe('open folder removal', () => {
  // A ban on a folder does not reach its Open sub-folders, which still inherit.
  it("bans the member from the folder's Open sub-folders that still list them", async () => {
    lists = { g2: [{ identity: BOB }], h: [{ identity: BOB }] };
    expect(await banAcrossOpenSubtree(admin, folders, 'g', BOB)).toEqual([]);
    expect(admin.removeGroupMembers.mock.calls).toEqual([
      ['g2', { members: [BOB] }],
    ]);
  });

  it('lists as removed a parent member who could join the Open folder but is not in it', async () => {
    lists = {
      root: [
        { identity: BOB, role: 'Member' },
        { identity: CAROL, role: 'Member' },
        { identity: GUEST, role: 'ReadOnly' },
      ],
      g: [{ identity: CAROL, role: 'Member' }],
    };
    caps = { [BOB]: JOIN, [CAROL]: JOIN };
    expect(await removedFrom(admin, 'root', 'g')).toEqual([BOB]);
  });

  // An admin add is what clears core's ban on a folder.
  it('restores the member to the folder and to the Open sub-folders that dropped them', async () => {
    lists = { g2: [], h: [] };
    expect(await restoreAcrossOpenSubtree(admin, folders, 'g', BOB)).toEqual(
      [],
    );
    expect(admin.addGroupMembers.mock.calls).toEqual([
      ['g', { members: [{ identity: BOB, role: 'Member' }] }],
      ['g2', { members: [{ identity: BOB, role: 'Member' }] }],
    ]);
  });
});

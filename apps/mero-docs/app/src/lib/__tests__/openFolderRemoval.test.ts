import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPError } from '@calimero-network/mero-js';
import { clearOpenSubtree, removedFrom, restoreTo } from '../openFolderRemoval';
import type { FolderRoleWriter } from '../applyFolderRole';
import { CAPABILITIES } from '@/constants/config';

const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const GUEST = 'd'.repeat(64);
const TEE = 'e'.repeat(64);
const JOIN = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS;
// g (Open) > g2 (Open); g > h (Restricted) > h2 (Open).
const folders = [
  { id: 'g', parent_id: null, visibility: 'Open' as const },
  { id: 'g2', parent_id: 'g', visibility: 'Open' as const },
  { id: 'h', parent_id: 'g', visibility: 'Restricted' as const },
  { id: 'h2', parent_id: 'h', visibility: 'Open' as const },
];
let lists: Record<string, { identity: string; role?: string }[]>;
let caps: Record<string, number>;
const admin = {
  listGroupMembers: vi.fn(async (g: string) => ({ members: lists[g] ?? [] })),
  removeGroupMembers: vi.fn(async (_g: string, _r: { members: string[] }) => {}),
  addGroupMembers: vi.fn(async (_g: string, _r: unknown) => {}),
  updateMemberRole: vi.fn(async (g: string) => {
    throw new HTTPError(404, '', `/groups/${g}`, new Headers());
  }),
  setMemberCapabilities: vi.fn(async () => {}),
  getMemberCapabilities: vi.fn(async (_g: string, m: string) => ({ capabilities: caps[m] ?? 0 })),
};
const registry = {
  setFolderRole: vi.fn(async () => {}),
  getFolderRole: vi.fn(async () => 'Editor' as const),
};
const writer = { admin, registry } as unknown as FolderRoleWriter & { admin: typeof admin };

beforeEach(() => {
  vi.clearAllMocks();
  lists = {};
  caps = {};
});

describe('clearOpenSubtree', () => {
  // A removal must reach the Open sub-folders that let the person in through
  // this folder, and stop where a Restricted folder walls them off.
  it('removes the person from the Open sub-folders reached through this folder only', async () => {
    lists = { g2: [{ identity: BOB }], h: [{ identity: BOB }], h2: [{ identity: BOB }] };
    expect(await clearOpenSubtree(admin, folders, 'g', BOB)).toEqual([]);
    expect(admin.removeGroupMembers.mock.calls).toEqual([['g2', { members: [BOB] }]]);
  });

  it('reaches the Open sub-folders of a Restricted folder', async () => {
    lists = { h2: [{ identity: BOB }] };
    await clearOpenSubtree(admin, folders, 'h', BOB);
    expect(admin.removeGroupMembers.mock.calls).toEqual([['h2', { members: [BOB] }]]);
  });
});

describe('removedFrom', () => {
  it('lists a parent member who could join the Open folder but is not in it, never a Guest or a TEE', async () => {
    lists = {
      root: [
        { identity: BOB, role: 'Member' },
        { identity: CAROL, role: 'Member' },
        { identity: GUEST, role: 'ReadOnly' },
        { identity: TEE, role: 'RelayTee' },
      ],
      g: [{ identity: CAROL, role: 'Member' }],
    };
    caps = { [BOB]: JOIN, [CAROL]: JOIN, [TEE]: JOIN };
    expect(await removedFrom(admin, 'root', 'g')).toEqual([BOB]);
  });
});

describe('restoreTo', () => {
  // Each folder has its own Removed list, so a restore lifts this folder's ban only.
  it('lets the person back into this folder alone', async () => {
    lists = { root: [{ identity: BOB, role: 'Member' }] };
    await restoreTo(writer, 'root', 'g', BOB);
    expect(admin.addGroupMembers.mock.calls).toEqual([
      ['g', { members: [{ identity: BOB, role: 'Member' }] }],
    ]);
  });

  // A Read only member restored here stays Read only, as the parent says.
  it('keeps a person Read only when the parent holds them Read only', async () => {
    lists = { root: [{ identity: BOB, role: 'ReadOnly' }], g: [{ identity: BOB, role: 'Member' }] };
    await restoreTo(writer, 'root', 'g', BOB);
    expect(admin.addGroupMembers).toHaveBeenLastCalledWith('g', {
      members: [{ identity: BOB, role: 'ReadOnly' }],
    });
  });
});

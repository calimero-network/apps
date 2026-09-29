import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPError } from '@calimero-network/mero-js';
import { applyAcross, inheritReadOnly, type FolderRoleWriter } from '../applyFolderRole';
import { FOLDER_ROLE_GRANTS } from '../roles';

const BOB = 'b'.repeat(64);

// Folder id -> member rows as `listGroupMembers` reports them.
let rows: Record<string, { identity: string; role: string }[]>;
// Folders where Bob has a direct row, as core's update_member_role sees it.
let direct: Set<string>;

const writer = {
  admin: {
    listGroupMembers: vi.fn(async (g: string) => ({ members: rows[g] ?? [] })),
    updateMemberRole: vi.fn(async (g: string, id: string, { role }: { role: string }) => {
      if (!direct.has(g)) throw new HTTPError(404, '', `/groups/${g}`, new Headers());
      rows[g] = rows[g].map((m) => (m.identity === id ? { ...m, role } : m));
    }),
    addGroupMembers: vi.fn(async (g: string) => {
      direct.add(g);
    }),
    setMemberCapabilities: vi.fn(async () => {}),
  },
  registry: { setFolderRole: vi.fn(async () => {}) },
};
const w = writer as unknown as FolderRoleWriter;

beforeEach(() => {
  vi.clearAllMocks();
  rows = {};
  direct = new Set();
});

describe('applyAcross', () => {
  it('makes the member Read only in every folder they reach, by row or by inheritance', async () => {
    rows = {
      restricted: [{ identity: BOB, role: 'Member' }],
      open: [{ identity: BOB, role: 'Member' }],
      walled: [],
    };
    direct = new Set(['restricted']);
    const failed = await applyAcross(w, ['restricted', 'open', 'walled'], BOB, true);
    expect(failed).toEqual([]);
    expect(writer.admin.updateMemberRole).toHaveBeenCalledWith('restricted', BOB, { role: 'ReadOnly' });
    expect(writer.admin.addGroupMembers).toHaveBeenCalledWith('open', {
      members: [{ identity: BOB, role: 'ReadOnly' }],
    });
    expect(writer.admin.setMemberCapabilities).toHaveBeenCalledWith('open', BOB, {
      capabilities: FOLDER_ROLE_GRANTS.ReadOnly.folderCaps,
    });
    expect(writer.registry.setFolderRole).toHaveBeenCalledTimes(2);
    // A folder they cannot reach is left alone.
    expect(writer.admin.listGroupMembers).toHaveBeenCalledWith('walled');
    expect(writer.registry.setFolderRole).not.toHaveBeenCalledWith(
      expect.objectContaining({ folder_id: 'walled' }),
    );
  });

  // Core lists an inheritor with its anchor row's role, but refuses writes by
  // the direct row alone, so a listed ReadOnly is no reason to skip.
  it('writes a direct ReadOnly row where the member is listed ReadOnly only by inheritance', async () => {
    rows = { 'open-child': [{ identity: BOB, role: 'ReadOnly' }] };
    const failed = await applyAcross(w, ['open-child'], BOB, true);
    expect(failed).toEqual([]);
    expect(writer.admin.addGroupMembers).toHaveBeenCalledWith('open-child', {
      members: [{ identity: BOB, role: 'ReadOnly' }],
    });
  });

  it('restores Editor only where the member is Read only', async () => {
    rows = {
      a: [{ identity: BOB, role: 'ReadOnly' }],
      b: [{ identity: BOB, role: 'Member' }],
    };
    direct = new Set(['a', 'b']);
    await applyAcross(w, ['a', 'b'], BOB, false);
    expect(writer.admin.updateMemberRole).toHaveBeenCalledTimes(1);
    expect(writer.admin.updateMemberRole).toHaveBeenCalledWith('a', BOB, { role: 'Member' });
    expect(writer.registry.setFolderRole).toHaveBeenCalledWith(
      expect.objectContaining({ folder_id: 'a', role: 'Editor' }),
    );
  });

  it('never touches an owner or a TEE row', async () => {
    rows = { a: [{ identity: BOB, role: 'Admin' }], b: [{ identity: BOB, role: 'RelayTee' }] };
    await applyAcross(w, ['a', 'b'], BOB, true);
    expect(writer.admin.updateMemberRole).not.toHaveBeenCalled();
    expect(writer.admin.addGroupMembers).not.toHaveBeenCalled();
  });

  it('reports the folders core refused and carries on with the rest', async () => {
    rows = { a: [{ identity: BOB, role: 'Member' }], b: [{ identity: BOB, role: 'Member' }] };
    direct = new Set(['a', 'b']);
    writer.admin.updateMemberRole.mockRejectedValueOnce(
      new HTTPError(403, '', '/groups/a', new Headers()),
    );
    expect(await applyAcross(w, ['a', 'b'], BOB, true)).toEqual(['a']);
    expect(writer.registry.setFolderRole).toHaveBeenCalledWith(
      expect.objectContaining({ folder_id: 'b', role: 'Viewer' }),
    );
  });
});

describe('inheritReadOnly', () => {
  it("makes the parent's Read only members Read only in a new sub-folder they reach", async () => {
    const CAROL = 'c'.repeat(64);
    rows = {
      parent: [
        { identity: BOB, role: 'ReadOnly' },
        { identity: CAROL, role: 'Member' },
      ],
      // An Open child lists each inheritor with the parent row's role.
      child: [
        { identity: BOB, role: 'ReadOnly' },
        { identity: CAROL, role: 'Member' },
      ],
    };
    expect(await inheritReadOnly(w, 'parent', 'child')).toEqual([]);
    expect(writer.admin.addGroupMembers).toHaveBeenCalledTimes(1);
    expect(writer.admin.addGroupMembers).toHaveBeenCalledWith('child', {
      members: [{ identity: BOB, role: 'ReadOnly' }],
    });
  });
});

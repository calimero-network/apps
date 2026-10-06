import { describe, expect, it, vi } from 'vitest';
import { folderDocsContext, loadCoreFolders, type FolderReader } from '../coreFolders';

const ROOT = 'root';

// A tree as core would answer it to one caller: `children` is what
// listSubgroups lists, `info` what getGroupInfo answers (absent = refused).
function reader(opts: {
  children: Record<string, string[]>;
  info: Record<string, { name?: string; color?: string; visibility?: string; ns?: string }>;
  contexts?: Record<string, string>;
  held?: { groupId?: string }[];
}): FolderReader {
  return {
    listSubgroups: vi.fn(async (g: string) => (opts.children[g] ?? []).map((groupId) => ({ groupId }))),
    getGroupInfo: vi.fn(async (g: string) => {
      const i = opts.info[g];
      if (!i) throw new Error('not a member');
      return {
        namespaceId: i.ns ?? ROOT,
        subgroupVisibility: i.visibility ?? 'open',
        metadata: { name: i.name, data: i.color ? { color: i.color } : {} },
      };
    }),
    listGroupContexts: vi.fn(async (g: string) =>
      opts.contexts?.[g] ? [{ contextId: opts.contexts[g] }] : [],
    ),
    getContextsForApplication: vi.fn(async () => ({ contexts: opts.held ?? [] })),
  } as unknown as FolderReader;
}

describe('loadCoreFolders', () => {
  it('walks the tree, with each folder its name, colour, visibility and docs context', async () => {
    const admin = reader({
      children: { [ROOT]: ['a'], a: ['b'] },
      info: { a: { name: 'Plans', color: '#ff0000' }, b: { name: 'Q3', visibility: 'restricted' } },
      contexts: { a: 'ctx-a', b: 'ctx-b' },
    });
    expect(await loadCoreFolders(admin, ROOT, 'app')).toEqual([
      { id: 'a', parent_id: null, alias: 'Plans', color: '#ff0000', context_id: 'ctx-a', visibility: 'Open', shared: false },
      { id: 'b', parent_id: 'a', alias: 'Q3', color: null, context_id: 'ctx-b', visibility: 'Restricted', shared: false },
    ]);
  });

  it('lists nothing core does not list, and nothing core refuses to describe', async () => {
    const admin = reader({
      // Core never lists the Restricted 'secret' to this caller; 'gone' it lists but refuses.
      children: { [ROOT]: ['open', 'gone'] },
      info: { open: { name: 'Open' } },
    });
    const ids = (await loadCoreFolders(admin, ROOT, 'app')).map((f) => f.id);
    expect(ids).toEqual(['open']);
  });

  it('finds a folder under a parent the caller cannot see through the context it holds, as Shared', async () => {
    const admin = reader({
      children: { [ROOT]: [], inner: ['innerChild'] },
      info: { inner: { name: 'Shared one' }, innerChild: { name: 'Below it' } },
      held: [{ groupId: 'inner' }, { groupId: ROOT }],
    });
    const folders = await loadCoreFolders(admin, ROOT, 'app');
    expect(folders.map((f) => [f.id, f.parent_id, f.shared])).toEqual([
      ['inner', null, true],
      ['innerChild', 'inner', false],
    ]);
  });

  it("leaves out another workspace's folder held by the same app", async () => {
    const admin = reader({
      children: { [ROOT]: [] },
      info: { elsewhere: { name: 'Other', ns: 'other-root' } },
      held: [{ groupId: 'elsewhere' }],
    });
    expect(await loadCoreFolders(admin, ROOT, 'app')).toEqual([]);
  });

  it('lists a folder found both ways once, where the tree puts it', async () => {
    const admin = reader({
      children: { [ROOT]: ['a'] },
      info: { a: { name: 'A' } },
      held: [{ groupId: 'a' }],
    });
    const folders = await loadCoreFolders(admin, ROOT, 'app');
    expect(folders).toHaveLength(1);
    expect(folders[0].shared).toBe(false);
  });

  it('keeps walking when one branch cannot be listed', async () => {
    const admin = reader({ children: { [ROOT]: ['a', 'b'] }, info: { a: { name: 'A' }, b: { name: 'B' } } });
    (admin.listSubgroups as ReturnType<typeof vi.fn>).mockImplementation(async (g: string) => {
      if (g === 'a') throw new Error('boom');
      return g === ROOT ? [{ groupId: 'a' }, { groupId: 'b' }] : [];
    });
    expect((await loadCoreFolders(admin, ROOT, 'app')).map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('folderDocsContext', () => {
  it("is the subgroup's one context, or null", async () => {
    const admin = reader({ children: {}, info: {}, contexts: { a: 'ctx-a' } });
    expect(await folderDocsContext(admin, 'a')).toBe('ctx-a');
    expect(await folderDocsContext(admin, 'none')).toBeNull();
  });
});

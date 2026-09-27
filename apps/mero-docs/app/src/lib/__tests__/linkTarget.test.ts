import { describe, it, expect } from 'vitest';
import { resolveLinkTarget } from '../linkTarget';
import type { AppRoute } from '../routes';

const folder = (id: string, alias?: string | null) => ({
  id,
  parent_id: null,
  color: null,
  alias,
});
const NONE = new Set<string>();

const base = {
  namespaceIds: ['ws'],
  folderRegistry: [folder('f1', 'Finance')],
  hiddenFolderIds: NONE,
  docs: [{ id: 'doc-1' }],
};

describe('resolveLinkTarget', () => {
  it('is ok with no route', () => {
    expect(resolveLinkTarget({ ...base, route: null })).toBe('ok');
  });

  it('is ok for a bare workspace route', () => {
    expect(resolveLinkTarget({ ...base, route: { ws: 'ws' } })).toBe('ok');
  });

  it('is not-in-workspace once the namespace list has loaded and excludes it', () => {
    expect(
      resolveLinkTarget({ ...base, route: { ws: 'other' } }),
    ).toBe('not-in-workspace');
  });

  it('is ok (not not-in-workspace) while the namespace list is still loading', () => {
    expect(
      resolveLinkTarget({ ...base, namespaceIds: null, route: { ws: 'other' } }),
    ).toBe('ok');
  });

  it('is ok for a folder route once the folder resolves', () => {
    const route: AppRoute = { ws: 'ws', folder: 'f1' };
    expect(resolveLinkTarget({ ...base, route })).toBe('ok');
  });

  it('is syncing for a folder route before the folder list has loaded — never a false deleted', () => {
    const route: AppRoute = { ws: 'ws', folder: 'f1' };
    expect(
      resolveLinkTarget({ ...base, folderRegistry: null, route }),
    ).toBe('syncing');
  });

  it('is deleted when the folder is not in the registry at all', () => {
    const route: AppRoute = { ws: 'ws', folder: 'gone' };
    expect(resolveLinkTarget({ ...base, route })).toBe('deleted');
  });

  it('is no-access when the folder is registered but hidden from this caller', () => {
    const route: AppRoute = { ws: 'ws', folder: 'f1' };
    expect(
      resolveLinkTarget({ ...base, hiddenFolderIds: new Set(['f1']), route }),
    ).toBe('no-access');
  });

  it('is ok for a doc route once the doc resolves', () => {
    const route: AppRoute = { ws: 'ws', folder: 'f1', doc: 'doc-1' };
    expect(resolveLinkTarget({ ...base, route })).toBe('ok');
  });

  it('is syncing for a doc route before the docs list has loaded — never a false deleted', () => {
    const route: AppRoute = { ws: 'ws', folder: 'f1', doc: 'doc-1' };
    expect(resolveLinkTarget({ ...base, docs: null, route })).toBe('syncing');
  });

  it('is deleted when the doc is not in the loaded list', () => {
    const route: AppRoute = { ws: 'ws', folder: 'f1', doc: 'gone' };
    expect(resolveLinkTarget({ ...base, route })).toBe('deleted');
  });

  it('judges no-access before ever looking at the doc', () => {
    const route: AppRoute = { ws: 'ws', folder: 'f1', doc: 'doc-1' };
    expect(
      resolveLinkTarget({
        ...base,
        hiddenFolderIds: new Set(['f1']),
        docs: null,
        route,
      }),
    ).toBe('no-access');
  });
});

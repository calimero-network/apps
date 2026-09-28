import { describe, expect, it } from 'vitest';
import { canOpenFolder, gatingFolder } from '../useFolderReach';

type F = {
  id: string;
  parent_id: string | null;
  visibility: 'Open' | 'Restricted' | undefined;
};
const folders: F[] = [
  { id: 'open', parent_id: 'root', visibility: 'Open' },
  { id: 'top', parent_id: null, visibility: 'Open' },
  { id: 'fin', parent_id: 'root', visibility: 'Restricted' },
  { id: 'fin-open', parent_id: 'fin', visibility: 'Open' },
  { id: 'fin-sub', parent_id: 'fin', visibility: 'Restricted' },
  { id: 'pending', parent_id: 'root', visibility: undefined },
  { id: 'orphan', parent_id: 'hidden', visibility: 'Open' },
];

describe('gatingFolder', () => {
  it('is none for an open folder up to the workspace', () => {
    expect(gatingFolder('open', folders, 'root')).toBeNull();
    expect(gatingFolder('top', folders, 'root')).toBeNull();
  });

  it('is the nearest restricted folder, itself included', () => {
    expect(gatingFolder('fin', folders, 'root')).toBe('fin');
    expect(gatingFolder('fin-open', folders, 'root')).toBe('fin');
    expect(gatingFolder('fin-sub', folders, 'root')).toBe('fin-sub');
  });

  it('is unknown while a visibility or a parent is not known', () => {
    expect(gatingFolder('pending', folders, 'root')).toBeUndefined();
    expect(gatingFolder('orphan', folders, 'root')).toBeUndefined();
    expect(gatingFolder('missing', folders, 'root')).toBeUndefined();
  });
});

describe('canOpenFolder', () => {
  const members = {
    members: [{ identity: 'me' }, { identity: 'bob' }],
    loading: false,
    error: null,
  };

  it('lets anyone in the workspace open an ungated folder', () => {
    expect(canOpenFolder(null, members, 'zed', 'me')).toBe(true);
  });

  it('asks the gating folder member list', () => {
    expect(canOpenFolder('fin', members, 'bob', 'me')).toBe(true);
    expect(canOpenFolder('fin', members, 'zed', 'me')).toBe(false);
  });

  it('does not know while the gate or its members are unknown', () => {
    expect(canOpenFolder(undefined, members, 'zed', 'me')).toBeUndefined();
    expect(
      canOpenFolder('fin', { ...members, loading: true }, 'zed', 'me'),
    ).toBeUndefined();
    expect(
      canOpenFolder('fin', { ...members, error: new Error('x') }, 'zed', 'me'),
    ).toBeUndefined();
    // You can open the doc, so a list without you has not been read yet.
    expect(
      canOpenFolder('fin', { ...members, members: [] }, 'zed', 'me'),
    ).toBeUndefined();
  });
});

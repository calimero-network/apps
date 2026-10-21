import { describe, expect, it } from 'vitest';
import { openAudience, restrictionOf, type RestrictionInput } from '../folderRestriction';

const folder = (
  id: string,
  parent_id: string | null,
  visibility: RestrictionInput['visibility'],
  extra: Partial<RestrictionInput> = {},
): RestrictionInput => ({ id, parent_id, visibility, ...extra });

describe('restrictionOf', () => {
  it('closes an Open folder inside a Restricted one, naming the folder that closes it', () => {
    const r = restrictionOf([
      folder('private', null, 'Restricted'),
      folder('sub', 'private', 'Open'),
      folder('subsub', 'sub', 'Open'),
    ]);
    expect(r.get('sub')).toEqual({ restricted: true, by: 'private' });
    expect(r.get('subsub')).toEqual({ restricted: true, by: 'private' });
  });

  it('names the nearest wall', () => {
    const r = restrictionOf([
      folder('private', null, 'Restricted'),
      folder('inner', 'private', 'Restricted'),
      folder('leaf', 'inner', 'Open'),
    ]);
    expect(r.get('leaf')).toEqual({ restricted: true, by: 'inner' });
  });

  it('leaves an Open chain to the workspace open', () => {
    const r = restrictionOf([folder('pub', null, 'Open'), folder('child', 'pub', 'Open')]);
    expect(r.get('child')).toEqual({ restricted: false, by: null });
  });

  it('closes a Shared folder, whose wall is above what the caller sees', () => {
    const r = restrictionOf([folder('shared', null, 'Open', { shared: true })]);
    expect(r.get('shared')).toEqual({ restricted: true, by: null });
  });

  it("takes core's answer when the node gives one", () => {
    const r = restrictionOf([
      folder('pub', null, 'Open'),
      folder('child', 'pub', 'Open', { effectiveVisibility: 'Restricted' }),
    ]);
    expect(r.get('child')?.restricted).toBe(true);
  });
});

describe('openAudience', () => {
  const labelOf = (id: string) => ({ private: 'Private' })[id];
  it('is the workspace on an Open chain, and the wall folder inside a Restricted one', () => {
    expect(openAudience({ restricted: false }, labelOf)).toBe('all workspace members');
    expect(openAudience({ restricted: true, restrictedBy: 'private' }, labelOf)).toBe(
      'members of Private',
    );
    expect(openAudience({ restricted: true, restrictedBy: null }, labelOf)).toBe(
      'members of the folder above',
    );
  });
});

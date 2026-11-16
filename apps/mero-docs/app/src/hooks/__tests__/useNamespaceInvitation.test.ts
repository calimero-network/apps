import { describe, expect, it } from 'vitest';
import { inviteLinkBase } from '../useNamespaceInvitation';

describe('inviteLinkBase', () => {
  it('names the workspace, and the folder for a folder invite, without a token', () => {
    const url = new URL(inviteLinkBase('group', { workspace: 'o', folder: 'f' }));
    expect(Object.fromEntries(url.searchParams)).toEqual({ org: 'o', team: 'f', kind: 'group' });
  });
});

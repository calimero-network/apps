import { describe, it, expect } from 'vitest';
import { decideCallbackFolder, type CallbackFolderInput } from './activeFolder';

const base: CallbackFolderInput = {
  callbackContextId: null,
  nsKnown: true,
  pick: null,
  pickCallback: null,
  folderIds: ['cb', 'other', 'picked'],
};

describe('decideCallbackFolder', () => {
  it('does not apply to a fresh login without a callback', () => {
    expect(decideCallbackFolder(base)).toBeNull();
    expect(decideCallbackFolder({ ...base, pick: 'picked' })).toBeNull();
  });

  it('opens the callback folder and records it when nothing was picked', () => {
    expect(decideCallbackFolder({ ...base, callbackContextId: 'cb' }))
      .toEqual({ folder: 'cb', userPick: false, persist: true });
  });

  it('lets a new callback win over a pick made under another callback', () => {
    expect(decideCallbackFolder({ ...base, callbackContextId: 'cb', pick: 'picked', pickCallback: 'older' }))
      .toEqual({ folder: 'cb', userPick: false, persist: true });
  });

  it('lets a new callback win over a pick made with no callback at all', () => {
    expect(decideCallbackFolder({ ...base, callbackContextId: 'cb', pick: 'picked', pickCallback: null }))
      .toEqual({ folder: 'cb', userPick: false, persist: true });
  });

  it('keeps a pick made after the same callback (the reload case)', () => {
    expect(decideCallbackFolder({ ...base, callbackContextId: 'cb', pick: 'picked', pickCallback: 'cb' }))
      .toEqual({ folder: 'picked', userPick: true, persist: false });
  });

  it('waits for the folder list before giving up on that pick, without overwriting it', () => {
    expect(decideCallbackFolder({ ...base, callbackContextId: 'cb', pick: 'picked', pickCallback: 'cb', folderIds: [] }))
      .toEqual({ folder: 'cb', userPick: false, persist: false });
  });

  it('shows the callback without recording anything while its namespace resolves', () => {
    expect(decideCallbackFolder({ ...base, callbackContextId: 'cb', nsKnown: false }))
      .toEqual({ folder: 'cb', userPick: false, persist: false });
  });
});

// The flicker, as a rule you can assert.
//
// mero-react's `useAsyncResource.refetch` sets `loading = true` on EVERY
// refetch, and an SSE ding refetches the whole workspace. If any of those
// pulses reaches a content-hiding stage, `FolderTree` swaps the entire `<ul>`
// for a one-line placeholder and every row unmounts and remounts — which is
// what users saw as the sidebar flickering.

import { describe, expect, it } from 'vitest';
import {
  deriveDriveStage,
  stageHidesContent,
  type StageInput,
} from '../driveStage';

/** A workspace that is fully up: everything resolved, nothing in flight. */
const ready: StageInput = {
  authLoading: false,
  appIdResolving: false,
  isAuthenticated: true,
  hasApplicationId: true,
  nsLoading: false,
  hasSelectedNamespace: true,
  hasRegistryContext: true,
  membersLoading: false,
  identityLoading: false,
  hasSelfIdentity: true,
  subLoading: false,
  regLoading: false,
  hasLoadedFoldersForNs: true,
  awaitingFirstFolderResolve: false,
  isJustJoined: false,
};

describe('a background refresh keeps the content on screen', () => {
  it('is ready when nothing is in flight', () => {
    expect(deriveDriveStage(ready)).toBe('ready');
  });

  // ⚠️ THE FLICKER. Each of these flips true on every SSE-triggered refetch.
  it('stays ready while the registry folder list refetches', () => {
    expect(deriveDriveStage({ ...ready, regLoading: true })).toBe('ready');
  });

  it('stays ready while the subgroup list refetches', () => {
    expect(deriveDriveStage({ ...ready, subLoading: true })).toBe('ready');
  });

  it('stays ready while both refetch at once', () => {
    expect(
      deriveDriveStage({ ...ready, regLoading: true, subLoading: true }),
    ).toBe('ready');
  });

  it('never hides content during a background refresh', () => {
    for (const patch of [
      { regLoading: true },
      { subLoading: true },
      { regLoading: true, subLoading: true },
    ]) {
      expect(stageHidesContent(deriveDriveStage({ ...ready, ...patch }))).toBe(
        false,
      );
    }
  });
});

describe('the FIRST load still shows a skeleton', () => {
  const firstLoad: StageInput = { ...ready, hasLoadedFoldersForNs: false };

  it('reports loading-folders before any load has completed', () => {
    expect(deriveDriveStage({ ...firstLoad, regLoading: true })).toBe(
      'loading-folders',
    );
  });

  it('reports loading-subgroups before any load has completed', () => {
    expect(deriveDriveStage({ ...firstLoad, subLoading: true })).toBe(
      'loading-subgroups',
    );
  });

  // The access fan-out gate is first-paint-only by construction, so it must
  // keep hiding content even after a load has completed.
  it('still withholds a folder set whose access is unresolved', () => {
    expect(
      deriveDriveStage({ ...ready, awaitingFirstFolderResolve: true }),
    ).toBe('loading-folders');
  });
});

describe('the registry context is not re-probed on every refresh', () => {
  // `contextsLoading` is deliberately NOT an input: it pulses on every
  // refetch, and the hook holds the resolved id sticky across an in-flight
  // read so this branch cannot fire for a workspace already resolved.
  it('has no input that a context refetch could flip', () => {
    expect(Object.keys(ready)).not.toContain('contextsLoading');
  });

  it('reports resolving-registry-context only when there is genuinely no id', () => {
    expect(deriveDriveStage({ ...ready, hasRegistryContext: false })).toBe(
      'resolving-registry-context',
    );
  });

  it('calls that syncing-from-peers for a just-joined workspace', () => {
    expect(
      deriveDriveStage({
        ...ready,
        hasRegistryContext: false,
        isJustJoined: true,
      }),
    ).toBe('syncing-from-peers');
  });
});

describe('the earlier stages are unchanged', () => {
  it('waits for auth first', () => {
    expect(deriveDriveStage({ ...ready, authLoading: true })).toBe(
      'awaiting-auth',
    );
    expect(deriveDriveStage({ ...ready, isAuthenticated: false })).toBe(
      'awaiting-auth',
    );
    expect(deriveDriveStage({ ...ready, appIdResolving: true })).toBe(
      'awaiting-auth',
    );
    expect(deriveDriveStage({ ...ready, hasApplicationId: false })).toBe(
      'awaiting-auth',
    );
  });

  it('resolves namespaces before picking one', () => {
    expect(deriveDriveStage({ ...ready, nsLoading: true })).toBe(
      'resolving-namespaces',
    );
  });

  it('is idle with no namespace selected', () => {
    expect(deriveDriveStage({ ...ready, hasSelectedNamespace: false })).toBe(
      'idle',
    );
  });

  it('waits for the caller identity', () => {
    expect(deriveDriveStage({ ...ready, hasSelfIdentity: false })).toBe(
      'resolving-registry-context',
    );
    expect(deriveDriveStage({ ...ready, identityLoading: true })).toBe(
      'resolving-registry-context',
    );
    expect(deriveDriveStage({ ...ready, membersLoading: true })).toBe(
      'resolving-registry-context',
    );
  });

  it('treats idle as not hiding content', () => {
    expect(stageHidesContent('idle')).toBe(false);
    expect(stageHidesContent('ready')).toBe(false);
    expect(stageHidesContent('loading-folders')).toBe(true);
    expect(stageHidesContent('syncing-from-peers')).toBe(true);
  });
});

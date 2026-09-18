// The bug this file is the regression suite for, in one sentence: an empty
// context list was read as "this namespace has no registry", so every node that
// had not finished replicating minted another one — and `contexts[0]` then
// picked between them by list order, which two nodes do not agree on.
//
// A test that only covers "empty because the namespace is new" would pass
// against the broken code. The cases that matter are the ones where something
// exists and this node cannot see it.

import { describe, expect, it } from 'vitest';
import {
  pinnedMetadataData,
  readPin,
  REGISTRY_PIN_KEY,
  resolveRegistryContext,
  shouldAdoptPin,
  type RegistryCandidate,
} from '../registryContext';

const REG = 'Registry';

// Ids chosen so list order and id order DISAGREE: a test whose fixtures are
// already sorted cannot tell "deterministic" from "took the first one".
const A = 'aaa111';
const B = 'bbb222';
const C = 'ccc333';

const ctx = (contextId: string, name?: string): RegistryCandidate => ({
  contextId,
  name,
});

describe('the pin is authoritative', () => {
  it('uses the pinned context when it is present', () => {
    const r = resolveRegistryContext(
      { pin: B, listed: [ctx(C), ctx(B), ctx(A)], reportedCount: 3 },
      REG,
    );
    expect(r).toMatchObject({ status: 'resolved', contextId: B, source: 'pin' });
  });

  it('reports the other contexts as duplicates rather than hiding them', () => {
    const r = resolveRegistryContext(
      { pin: B, listed: [ctx(C), ctx(B), ctx(A)], reportedCount: 3 },
      REG,
    );
    if (r.status !== 'resolved') throw new Error('expected resolved');
    // Asserted WITHOUT re-sorting: the module must emit a stable order itself,
    // or two nodes disagree about this field even when they agree on the winner.
    expect(r.duplicates).toEqual([A, C]);
  });

  // ⚠️ THE BUG. A pin naming a context this node has not received proves a
  // registry EXISTS. Minting here is what produced three of them.
  it('says UNSYNCED — never absent — when the pinned context has not arrived', () => {
    const r = resolveRegistryContext(
      { pin: B, listed: [], reportedCount: 0 },
      REG,
    );
    expect(r.status).toBe('unsynced');
  });

  it('still says unsynced when the pin names a context missing from a NON-empty list', () => {
    const r = resolveRegistryContext(
      { pin: B, listed: [ctx(A)], reportedCount: 1 },
      REG,
    );
    expect(r.status).toBe('unsynced');
  });

  // The winner must not depend on the order the node happened to list them in.
  it('is independent of list order', () => {
    const one = resolveRegistryContext(
      { pin: B, listed: [ctx(A), ctx(B), ctx(C)], reportedCount: 3 },
      REG,
    );
    const two = resolveRegistryContext(
      { pin: B, listed: [ctx(C), ctx(A), ctx(B)], reportedCount: 3 },
      REG,
    );
    expect(one).toEqual(two);
  });
});

describe('empty list: unsynced vs absent', () => {
  // The only case where minting is correct.
  it('is absent when the group itself reports zero contexts', () => {
    expect(
      resolveRegistryContext({ pin: null, listed: [], reportedCount: 0 }, REG),
    ).toEqual({ status: 'absent' });
  });

  // ⚠️ THE BUG, second form. The second node in the reported incident was in
  // exactly this state: it held the namespace, governance said there was a
  // context, and the listing was empty because an op had not applied.
  it('is UNSYNCED when the group reports contexts but none have arrived', () => {
    const r = resolveRegistryContext(
      { pin: null, listed: [], reportedCount: 1 },
      REG,
    );
    expect(r.status).toBe('unsynced');
    if (r.status !== 'unsynced') throw new Error('unreachable');
    expect(r.reason).toMatch(/reached this node/i);
  });

  // Refusing to mint on "I don't know" is the safe direction: a missing
  // registry is recoverable by an admin; a duplicate splits the workspace.
  it('is unsynced, not absent, when the count could not be read', () => {
    expect(
      resolveRegistryContext({ pin: null, listed: [], reportedCount: null }, REG)
        .status,
    ).toBe('unsynced');
  });

  it('is unsynced when the list is partial', () => {
    const r = resolveRegistryContext(
      { pin: null, listed: [ctx(A)], reportedCount: 3 },
      REG,
    );
    expect(r.status).toBe('unsynced');
  });
});

describe('one candidate', () => {
  it('resolves it', () => {
    const r = resolveRegistryContext(
      { pin: null, listed: [ctx(B)], reportedCount: 1 },
      REG,
    );
    expect(r).toMatchObject({ status: 'resolved', contextId: B, source: 'sole' });
  });

  it('is pinned afterwards, so a later second context cannot change the answer', () => {
    const r = resolveRegistryContext(
      { pin: null, listed: [ctx(B)], reportedCount: 1 },
      REG,
    );
    expect(shouldAdoptPin(r)).toBe(true);
  });
});

describe('duplicates: adopt the one holding the data', () => {
  const listed = [ctx(C, REG), ctx(B, REG), ctx(A, REG)];

  // The reported incident exactly: three registries, folders in one of them,
  // and the app reading an empty one.
  it('picks the context with folders over the first-listed and the lowest id', () => {
    const r = resolveRegistryContext(
      {
        pin: null,
        listed,
        reportedCount: 3,
        folderCounts: { [A]: 0, [B]: 2, [C]: 0 },
      },
      REG,
    );
    expect(r).toMatchObject({ status: 'resolved', contextId: B, source: 'data' });
  });

  it('picks the fullest when several hold data', () => {
    const r = resolveRegistryContext(
      {
        pin: null,
        listed,
        reportedCount: 3,
        folderCounts: { [A]: 1, [B]: 5, [C]: 2 },
      },
      REG,
    );
    expect(r).toMatchObject({ contextId: B, source: 'data' });
  });

  it('breaks an equal-count tie on the lowest id, not list order', () => {
    const r = resolveRegistryContext(
      {
        pin: null,
        listed,
        reportedCount: 3,
        folderCounts: { [A]: 2, [B]: 2, [C]: 2 },
      },
      REG,
    );
    expect(r).toMatchObject({ contextId: A });
  });

  it('gives the same answer whatever order the node listed them in', () => {
    const counts = { [A]: 0, [B]: 2, [C]: 0 };
    const orders: RegistryCandidate[][] = [
      [ctx(A, REG), ctx(B, REG), ctx(C, REG)],
      [ctx(C, REG), ctx(B, REG), ctx(A, REG)],
      [ctx(B, REG), ctx(C, REG), ctx(A, REG)],
    ];
    const answers = orders.map(
      (o) =>
        resolveRegistryContext(
          { pin: null, listed: o, reportedCount: 3, folderCounts: counts },
          REG,
        ).status === 'resolved' &&
        (
          resolveRegistryContext(
            { pin: null, listed: o, reportedCount: 3, folderCounts: counts },
            REG,
          ) as { contextId: string }
        ).contextId,
    );
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe(B);
  });

  it('reports the losers as duplicates so the UI can surface them', () => {
    const r = resolveRegistryContext(
      {
        pin: null,
        listed,
        reportedCount: 3,
        folderCounts: { [A]: 0, [B]: 2, [C]: 0 },
      },
      REG,
    );
    if (r.status !== 'resolved') throw new Error('expected resolved');
    expect(r.duplicates).toEqual([A, C]);
  });
});

describe('duplicates with no data anywhere', () => {
  it('prefers a context named Registry over an unnamed lower id', () => {
    const r = resolveRegistryContext(
      {
        pin: null,
        listed: [ctx(A), ctx(B, REG)],
        reportedCount: 2,
        folderCounts: { [A]: 0, [B]: 0 },
      },
      REG,
    );
    expect(r).toMatchObject({ contextId: B, source: 'named' });
  });

  it('falls back to the lowest id when nothing is named', () => {
    const r = resolveRegistryContext(
      {
        pin: null,
        listed: [ctx(C), ctx(B), ctx(A)],
        reportedCount: 3,
        folderCounts: { [A]: 0, [B]: 0, [C]: 0 },
      },
      REG,
    );
    expect(r).toMatchObject({ contextId: A, source: 'lowest-id' });
  });

  it('still answers when folder counts were never probed', () => {
    const r = resolveRegistryContext(
      { pin: null, listed: [ctx(C), ctx(A)], reportedCount: 2 },
      REG,
    );
    expect(r).toMatchObject({ contextId: A, source: 'lowest-id' });
  });
});

describe('shouldAdoptPin', () => {
  it('does not re-write a pin it just read', () => {
    expect(
      shouldAdoptPin({
        status: 'resolved',
        contextId: A,
        source: 'pin',
        duplicates: [],
      }),
    ).toBe(false);
  });

  it('writes back every guessed answer', () => {
    for (const source of ['sole', 'data', 'named', 'lowest-id'] as const) {
      expect(
        shouldAdoptPin({
          status: 'resolved',
          contextId: A,
          source,
          duplicates: [],
        }),
      ).toBe(true);
    }
  });

  it('never adopts from a non-resolved state', () => {
    expect(shouldAdoptPin({ status: 'absent' })).toBe(false);
    expect(shouldAdoptPin({ status: 'unsynced', reason: 'x' })).toBe(false);
  });
});

describe('pinnedMetadataData', () => {
  // `SetMetadataRequest` wholly replaces the record, so a non-merging write
  // would delete every other key the group carries.
  it('merges onto the existing map instead of replacing it', () => {
    expect(pinnedMetadataData({ keep: 'me' }, A)).toEqual({
      keep: 'me',
      [REGISTRY_PIN_KEY]: A,
    });
  });

  it('handles a null or absent existing map', () => {
    expect(pinnedMetadataData(null, A)).toEqual({ [REGISTRY_PIN_KEY]: A });
    expect(pinnedMetadataData(undefined, A)).toEqual({ [REGISTRY_PIN_KEY]: A });
  });

  it('overwrites a stale pin', () => {
    expect(pinnedMetadataData({ [REGISTRY_PIN_KEY]: B }, A)).toEqual({
      [REGISTRY_PIN_KEY]: A,
    });
  });
});

describe('readPin', () => {
  it('reads the key', () => {
    expect(readPin({ data: { [REGISTRY_PIN_KEY]: A } })).toBe(A);
  });

  it('is null for every absent shape', () => {
    expect(readPin(null)).toBeNull();
    expect(readPin(undefined)).toBeNull();
    expect(readPin({})).toBeNull();
    expect(readPin({ data: null })).toBeNull();
    expect(readPin({ data: {} })).toBeNull();
    expect(readPin({ data: { [REGISTRY_PIN_KEY]: '' } })).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { decideActiveNs, type ActiveNsInput } from './activeNamespace';

const ns = (...ids: string[]) => ids.map((namespaceId) => ({ namespaceId }));

const base: ActiveNsInput = {
  namespaces: [],
  listed: true,
  activeNs: null,
  pinned: false,
  resolvingCallback: false,
};

describe('decideActiveNs', () => {
  it('keeps a selection while the list has not answered, even though it reads empty', () => {
    // The SSO race: the callback named `injected`, the list is still `[]`.
    expect(decideActiveNs({ ...base, listed: false, activeNs: 'injected' })).toEqual({ kind: 'keep' });
  });

  it('does not default into the first workspace before the list answers', () => {
    expect(decideActiveNs({ ...base, listed: false, namespaces: ns('aaa', 'injected') }))
      .toEqual({ kind: 'keep' });
  });

  it('keeps a selection the answered list holds, wherever it sorts', () => {
    expect(decideActiveNs({ ...base, namespaces: ns('aaa', 'injected'), activeNs: 'injected' }))
      .toEqual({ kind: 'keep' });
  });

  it('never overrides an explicit pick, even one the list lacks', () => {
    expect(decideActiveNs({ ...base, namespaces: ns('aaa'), activeNs: 'injected', pinned: true }))
      .toEqual({ kind: 'keep' });
  });

  it('waits out a callback that is still resolving', () => {
    expect(decideActiveNs({ ...base, namespaces: ns('aaa'), resolvingCallback: true }))
      .toEqual({ kind: 'keep' });
  });

  it('defaults to the first workspace on a cold start, without persisting it', () => {
    expect(decideActiveNs({ ...base, namespaces: ns('aaa', 'bbb') }))
      .toEqual({ kind: 'set', id: 'aaa', dropPersisted: false });
  });

  it('replaces a selection the answered list no longer holds, and drops it from storage', () => {
    expect(decideActiveNs({ ...base, namespaces: ns('aaa'), activeNs: 'gone' }))
      .toEqual({ kind: 'set', id: 'aaa', dropPersisted: true });
  });

  it('clears the selection when the answered list is really empty', () => {
    expect(decideActiveNs({ ...base, activeNs: 'gone' }))
      .toEqual({ kind: 'set', id: null, dropPersisted: true });
    expect(decideActiveNs(base)).toEqual({ kind: 'keep' });
  });
});

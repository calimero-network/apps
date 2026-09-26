import { describe, it, expect } from 'vitest';
import { nextNamespaceSelection } from '../namespaceSelection';

const none = new Set<string>();

describe('nextNamespaceSelection', () => {
  it('keeps a just-created namespace selected while the list does not show it yet', () => {
    expect(
      nextNamespaceSelection({
        listed: ['a', 'b'],
        selected: 'new',
        justJoined: none,
        created: 'new',
      }),
    ).toBe('new');
  });

  it('falls back to the first listed namespace when the selection is gone', () => {
    expect(
      nextNamespaceSelection({
        listed: ['a', 'b'],
        selected: 'gone',
        justJoined: none,
        created: null,
      }),
    ).toBe('a');
  });

  it('falls back when a created namespace is no longer the selection', () => {
    expect(
      nextNamespaceSelection({
        listed: ['a', 'b'],
        selected: 'gone',
        justJoined: none,
        created: 'new',
      }),
    ).toBe('a');
  });

  it('keeps a listed selection', () => {
    expect(
      nextNamespaceSelection({
        listed: ['a', 'b'],
        selected: 'b',
        justJoined: none,
        created: null,
      }),
    ).toBe('b');
  });

  it('prefers a just-joined namespace over the current selection', () => {
    expect(
      nextNamespaceSelection({
        listed: ['a', 'j'],
        selected: 'a',
        justJoined: new Set(['j']),
        created: null,
      }),
    ).toBe('j');
  });

  it('changes nothing while the list is empty', () => {
    expect(
      nextNamespaceSelection({
        listed: [],
        selected: 'x',
        justJoined: none,
        created: null,
      }),
    ).toBe('x');
  });

  it('selects the first namespace when nothing is selected', () => {
    expect(
      nextNamespaceSelection({
        listed: ['a'],
        selected: null,
        justJoined: none,
        created: null,
      }),
    ).toBe('a');
  });
});

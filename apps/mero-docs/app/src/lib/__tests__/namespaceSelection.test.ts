import { describe, it, expect } from 'vitest';
import { nextNamespaceSelection, syncWorkspaceRoute } from '../namespaceSelection';

const none = new Set<string>();

describe('nextNamespaceSelection', () => {
  it('keeps a just-created namespace selected while the list does not show it yet', () => {
    expect(
      nextNamespaceSelection({
        listed: ['a', 'b'],
        selected: 'new',
        justJoined: none,
        created: 'new',
        remembered: null,
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
        remembered: null,
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
        remembered: null,
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
        remembered: null,
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
        remembered: null,
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
        remembered: null,
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
        remembered: null,
      }),
    ).toBe('a');
  });

  // A link to a workspace this node is not in falls back to the last one used.
  it('falls back to the remembered workspace before the first listed one', () => {
    expect(
      nextNamespaceSelection({
        listed: ['a', 'b'],
        selected: 'not-mine',
        justJoined: none,
        created: null,
        remembered: 'b',
      }),
    ).toBe('b');
  });

  it('ignores a remembered workspace that is no longer listed', () => {
    expect(
      nextNamespaceSelection({
        listed: ['a', 'b'],
        selected: 'not-mine',
        justJoined: none,
        created: null,
        remembered: 'gone',
      }),
    ).toBe('a');
  });
});

describe('syncWorkspaceRoute', () => {
  const base = { justJoined: none, created: null };

  it('opens the remembered workspace from a bare /app', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: [], routeNs: null, stored: 's' }),
    ).toEqual({ goTo: 's', remember: null });
  });

  it('stays on /app when nothing is remembered or listed', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: [], routeNs: null, stored: null }),
    ).toEqual({ goTo: null, remember: null });
  });

  it('keeps a linked workspace and remembers it once it is listed', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: ['s', 'w'], routeNs: 'w', stored: 's' }),
    ).toEqual({ goTo: null, remember: 'w' });
  });

  it('does not remember a linked workspace before the list confirms it', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: [], routeNs: 'w', stored: 's' }),
    ).toEqual({ goTo: null, remember: null });
  });

  // The card names the workspace instead of a silent swap.
  it('does not redirect away from a linked workspace this node is not in', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: ['a', 's'], routeNs: 'x', stored: 's' }),
    ).toEqual({ goTo: null, remember: null });
  });

  it('does not redirect away from a workspace this node just joined, even before it is listed', () => {
    expect(
      syncWorkspaceRoute({
        listed: ['a', 's'],
        routeNs: 'x',
        stored: 's',
        justJoined: new Set(['x']),
        created: null,
      }),
    ).toEqual({ goTo: null, remember: null });
  });

  it('remembers a just-joined workspace once it is listed, instead of holding forever', () => {
    expect(
      syncWorkspaceRoute({
        listed: ['a', 'x'],
        routeNs: 'x',
        stored: 's',
        justJoined: new Set(['x']),
        created: null,
      }),
    ).toEqual({ goTo: null, remember: 'x' });
  });

  it('changes nothing once the URL and memory agree', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: ['s'], routeNs: 's', stored: 's' }),
    ).toEqual({ goTo: null, remember: null });
  });
});

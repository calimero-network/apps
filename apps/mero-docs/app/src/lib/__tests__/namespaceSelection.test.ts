import { describe, it, expect } from 'vitest';
import {
  confirmedNamespace,
  nextNamespaceSelection,
  parseRemembered,
  rememberedOn,
  syncWorkspaceRoute,
} from '../namespaceSelection';

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
  const base = { justJoined: none, created: null, answered: true };

  it('opens the remembered workspace from a bare /app', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: ['a', 's'], routeNs: null, stored: 's' }),
    ).toEqual({ goTo: 's', remember: null, forget: false });
  });

  it('stays on /app when nothing is remembered or listed', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: [], routeNs: null, stored: null }),
    ).toEqual({ goTo: null, remember: null, forget: false });
  });

  // The list reads [] until the node answers; a remembered id may be another node's.
  it('does not open the remembered workspace before the list answers', () => {
    expect(
      syncWorkspaceRoute({ ...base, answered: false, listed: [], routeNs: null, stored: 's' }),
    ).toEqual({ goTo: null, remember: null, forget: false });
  });

  it('opens the first listed workspace and forgets a remembered one this node does not list', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: ['a', 'b'], routeNs: null, stored: 'gone' }),
    ).toEqual({ goTo: 'a', remember: 'a', forget: true });
  });

  it('forgets a remembered workspace when this node lists none', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: [], routeNs: null, stored: 'gone' }),
    ).toEqual({ goTo: null, remember: null, forget: true });
  });

  it('keeps a linked workspace and remembers it once it is listed', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: ['s', 'w'], routeNs: 'w', stored: 's' }),
    ).toEqual({ goTo: null, remember: 'w', forget: false });
  });

  it('does not remember a linked workspace before the list confirms it', () => {
    expect(
      syncWorkspaceRoute({ ...base, answered: false, listed: [], routeNs: 'w', stored: 's' }),
    ).toEqual({ goTo: null, remember: null, forget: false });
  });

  // The card names the workspace instead of a silent swap.
  it('does not redirect away from a linked workspace this node is not in', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: ['a', 's'], routeNs: 'x', stored: 's' }),
    ).toEqual({ goTo: null, remember: null, forget: false });
  });

  it('does not redirect away from a workspace this node just joined, even before it is listed', () => {
    expect(
      syncWorkspaceRoute({
        ...base,
        listed: ['a', 's'],
        routeNs: 'x',
        stored: 's',
        justJoined: new Set(['x']),
      }),
    ).toEqual({ goTo: null, remember: null, forget: false });
  });

  it('remembers a just-joined workspace once it is listed, instead of holding forever', () => {
    expect(
      syncWorkspaceRoute({
        ...base,
        listed: ['a', 'x'],
        routeNs: 'x',
        stored: 's',
        justJoined: new Set(['x']),
      }),
    ).toEqual({ goTo: null, remember: 'x', forget: true });
  });

  it('changes nothing once the URL and memory agree', () => {
    expect(
      syncWorkspaceRoute({ ...base, listed: ['s'], routeNs: 's', stored: 's' }),
    ).toEqual({ goTo: null, remember: null, forget: false });
  });
});

describe('confirmedNamespace', () => {
  const base = { justJoined: none, created: null, answered: true };

  // Group reads with an id this node does not hold 404 ("group not found").
  it('is null before the list answers', () => {
    expect(confirmedNamespace({ ...base, answered: false, listed: [], routeNs: 'w' })).toBeNull();
  });

  it('is null for a workspace this node does not list', () => {
    expect(confirmedNamespace({ ...base, listed: ['a'], routeNs: 'w' })).toBeNull();
  });

  it('is the routed workspace once listed', () => {
    expect(confirmedNamespace({ ...base, listed: ['a', 'w'], routeNs: 'w' })).toBe('w');
  });

  it('trusts a just-joined or just-created workspace before it is listed', () => {
    expect(
      confirmedNamespace({ ...base, answered: false, listed: [], routeNs: 'j', justJoined: new Set(['j']) }),
    ).toBe('j');
    expect(confirmedNamespace({ ...base, listed: ['a'], routeNs: 'c', created: 'c' })).toBe('c');
  });
});

describe('rememberedOn', () => {
  it('is the workspace remembered on this node', () => {
    expect(rememberedOn({ node: 'http://n1', ns: 'w' }, 'http://n1')).toBe('w');
  });

  // Switching node must not carry the last node's workspace over.
  it('ignores a workspace remembered on another node', () => {
    expect(rememberedOn({ node: 'http://n1', ns: 'w' }, 'http://n2')).toBeNull();
  });

  // Older builds stored the bare id; the list read still has to confirm it.
  it('reads a bare id from an older build as unscoped', () => {
    expect(parseRemembered('w')).toEqual({ node: null, ns: 'w' });
    expect(rememberedOn('w', 'http://n2')).toBe('w');
  });

  it('is null for anything else', () => {
    for (const bad of [null, '', 42, { ns: 1 }, { node: 'x' }]) {
      expect(rememberedOn(bad, 'http://n1')).toBeNull();
    }
  });
});

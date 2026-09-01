import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNamespaceDisplayNames } from '../useNamespaceDisplayNames';
import { rememberNamespaceName } from '../namespaceNames';

// useNamespaceDisplayNames merges the join-time namespace name (stored
// by the invite-accept flow) into the namespace list, so a joined node
// shows the real name instead of the raw id while its root-group
// metadata is still un-synced.

describe('useNamespaceDisplayNames', () => {
  beforeEach(() => localStorage.clear());

  it('backfills a missing name from the join-time store', () => {
    rememberNamespaceName('ns1', 'tessst');
    const { result } = renderHook(() =>
      useNamespaceDisplayNames([{ namespaceId: 'ns1', name: null }]),
    );
    expect(result.current[0].name).toBe('tessst');
  });

  it('leaves a namespace that already has a name untouched', () => {
    // A namespace the node created carries its name from the list
    // endpoint — the store must not override it.
    rememberNamespaceName('ns1', 'stale stored value');
    const { result } = renderHook(() =>
      useNamespaceDisplayNames([{ namespaceId: 'ns1', name: 'Canonical' }]),
    );
    expect(result.current[0].name).toBe('Canonical');
  });

  it('leaves the name absent when nothing is stored', () => {
    const { result } = renderHook(() =>
      useNamespaceDisplayNames([{ namespaceId: 'ns1', name: null }]),
    );
    expect(result.current[0].name ?? null).toBeNull();
  });

  it('resolves only the namespaces it has a stored name for', () => {
    rememberNamespaceName('ns1', 'Known');
    const { result } = renderHook(() =>
      useNamespaceDisplayNames([
        { namespaceId: 'ns1', name: null },
        { namespaceId: 'ns2', name: null },
      ]),
    );
    expect(result.current[0].name).toBe('Known');
    expect(result.current[1].name ?? null).toBeNull();
  });
});

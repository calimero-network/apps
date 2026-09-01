import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRememberedNamespaceNames,
  rememberNamespaceName,
} from '../namespaceNames';

describe('namespaceNames store', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a remembered name', () => {
    rememberNamespaceName('ns1', 'Acme Workspace');
    expect(getRememberedNamespaceNames()).toEqual({ ns1: 'Acme Workspace' });
  });

  it('returns an empty map when nothing is stored', () => {
    expect(getRememberedNamespaceNames()).toEqual({});
  });

  it('ignores empty id or name', () => {
    rememberNamespaceName('', 'x');
    rememberNamespaceName('ns1', '');
    expect(getRememberedNamespaceNames()).toEqual({});
  });

  it('keeps multiple namespaces and overwrites on rename', () => {
    rememberNamespaceName('ns1', 'First');
    rememberNamespaceName('ns2', 'Second');
    rememberNamespaceName('ns1', 'Renamed');
    expect(getRememberedNamespaceNames()).toEqual({
      ns1: 'Renamed',
      ns2: 'Second',
    });
  });
});

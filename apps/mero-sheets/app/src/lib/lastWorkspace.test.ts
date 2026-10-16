import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetLastSpreadsheet,
  forgetLastWorkspace,
  lastWorkspaceKey,
  pickNamespace,
  pickResume,
  readLastWorkspace,
  rememberWorkspace,
} from './lastWorkspace';

/** A minimal in-memory Storage, and a switch to make it throw like Safari does. */
function stubStorage(throws = false) {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => {
      if (throws) throw new Error('blocked');
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (throws) throw new Error('blocked');
      map.set(k, v);
    },
    removeItem: (k: string) => {
      if (throws) throw new Error('blocked');
      map.delete(k);
    },
  };
  vi.stubGlobal('window', { localStorage: store });
  return map;
}

afterEach(() => vi.unstubAllGlobals());

const NODE = 'http://localhost:2428';

describe('lastWorkspaceKey', () => {
  it('is scoped to the node, ignoring a trailing slash', () => {
    expect(lastWorkspaceKey(NODE)).toBe(lastWorkspaceKey(`${NODE}/`));
    expect(lastWorkspaceKey(NODE)).not.toBe(lastWorkspaceKey('http://other:2428'));
    expect(lastWorkspaceKey(null)).toBe(lastWorkspaceKey(''));
  });
});

describe('remember / read / forget', () => {
  it('reads back what was remembered, on that node only', () => {
    stubStorage();
    rememberWorkspace(NODE, 'ns1', 'ctx1');
    expect(readLastWorkspace(NODE)).toEqual({ namespaceId: 'ns1', contextId: 'ctx1' });
    expect(readLastWorkspace('http://other:2428')).toEqual({});
  });

  it('forgetting the spreadsheet keeps the workspace', () => {
    stubStorage();
    rememberWorkspace(NODE, 'ns1', 'ctx1');
    forgetLastSpreadsheet(NODE);
    expect(readLastWorkspace(NODE)).toEqual({ namespaceId: 'ns1' });
  });

  it('forgetting everything (log out) leaves nothing', () => {
    const map = stubStorage();
    rememberWorkspace(NODE, 'ns1', 'ctx1');
    forgetLastWorkspace(NODE);
    expect(readLastWorkspace(NODE)).toEqual({});
    expect(map.size).toBe(0);
  });

  it('treats a corrupt entry as nothing remembered', () => {
    const map = stubStorage();
    map.set(lastWorkspaceKey(NODE), '{not json');
    expect(readLastWorkspace(NODE)).toEqual({});
    map.set(lastWorkspaceKey(NODE), JSON.stringify({ contextId: 42 }));
    expect(readLastWorkspace(NODE)).toEqual({});
  });

  it('survives storage that throws', () => {
    stubStorage(true);
    expect(() => rememberWorkspace(NODE, 'ns1', 'ctx1')).not.toThrow();
    expect(() => forgetLastWorkspace(NODE)).not.toThrow();
    expect(readLastWorkspace(NODE)).toEqual({});
  });
});

describe('pickNamespace', () => {
  const listed = ['ns1', 'ns2'];

  it('prefers the namespace just joined', () => {
    expect(pickNamespace(listed, 'ns2', 'ns1')).toBe('ns2');
  });

  it('then the remembered one, while the node still lists it', () => {
    expect(pickNamespace(listed, null, 'ns2')).toBe('ns2');
  });

  it('falls back to the first listed when the remembered one is gone', () => {
    expect(pickNamespace(listed, null, 'gone')).toBe('ns1');
    expect(pickNamespace([], null, 'ns1')).toBeNull();
  });
});

describe('pickResume', () => {
  it('resumes the remembered spreadsheet when its workspace still lists it', () => {
    expect(pickResume('ns1', ['a', 'b'], { namespaceId: 'ns1', contextId: 'b' })).toBe('b');
  });

  it('shows the picker when the spreadsheet is gone or was never remembered', () => {
    expect(pickResume('ns1', ['a'], { namespaceId: 'ns1', contextId: 'b' })).toBeNull();
    expect(pickResume('ns1', ['a'], { namespaceId: 'ns1' })).toBeNull();
    expect(pickResume('ns1', ['a'], {})).toBeNull();
  });

  it('never resumes into a different workspace than the one it was opened in', () => {
    expect(pickResume('ns2', ['b'], { namespaceId: 'ns1', contextId: 'b' })).toBeNull();
    expect(pickResume(null, ['b'], { namespaceId: 'ns1', contextId: 'b' })).toBeNull();
  });
});

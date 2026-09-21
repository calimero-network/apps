import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── The workspace the app is acting in ──────────────────────────────────────
//
// A module store, because `useCalimero()` is called from twelve places and the
// `app` handle it returns has to know the workspace — `createContext` cannot
// be sent without a group. These tests cover the two properties that matter:
// a change reaches every subscriber, and the choice survives a reload.

function stubStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  vi.stubGlobal('localStorage', storage);
  return map;
}

/** Imported fresh each time: the module reads storage once, at import. */
async function loadModule() {
  vi.resetModules();
  return import('./activeWorkspace');
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('the active workspace', () => {
  it('starts empty on a node that has never picked one', async () => {
    stubStorage();
    const { getActiveWorkspace } = await loadModule();
    expect(getActiveWorkspace()).toBeNull();
  });

  it('restores the last workspace on reload', async () => {
    // The desktop opens this app in a window that reloads. Landing back at the
    // picker with no explanation is the failure this prevents.
    stubStorage({ 'mero-sign:workspace': 'ns-acme' });
    const { getActiveWorkspace } = await loadModule();
    expect(getActiveWorkspace()).toBe('ns-acme');
  });

  it('tells every subscriber, so all twelve useCalimero() callers re-render', async () => {
    stubStorage();
    const { setActiveWorkspace, subscribeActiveWorkspace } = await loadModule();
    const seen: number[] = [];
    subscribeActiveWorkspace(() => seen.push(1));
    subscribeActiveWorkspace(() => seen.push(2));
    setActiveWorkspace('ns-acme');
    expect(seen).toEqual([1, 2]);
  });

  it('does not wake subscribers for a no-op', async () => {
    stubStorage({ 'mero-sign:workspace': 'ns-acme' });
    const { setActiveWorkspace, subscribeActiveWorkspace } = await loadModule();
    let woken = 0;
    subscribeActiveWorkspace(() => (woken += 1));
    setActiveWorkspace('ns-acme');
    expect(woken).toBe(0);
  });

  it('forgets the workspace when cleared, storage included', async () => {
    const map = stubStorage({ 'mero-sign:workspace': 'ns-acme' });
    const { getActiveWorkspace, setActiveWorkspace } = await loadModule();
    setActiveWorkspace(null);
    expect(getActiveWorkspace()).toBeNull();
    expect(map.has('mero-sign:workspace')).toBe(false);
  });

  it('still selects a workspace when storage throws', async () => {
    // A private window blocks storage outright. It may cost the selection its
    // persistence; it must not cost the user the selection.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    const { getActiveWorkspace, setActiveWorkspace } = await loadModule();
    expect(getActiveWorkspace()).toBeNull();
    setActiveWorkspace('ns-acme');
    expect(getActiveWorkspace()).toBe('ns-acme');
  });
});

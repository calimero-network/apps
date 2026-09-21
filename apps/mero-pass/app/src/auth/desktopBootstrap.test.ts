import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapDesktopSession, hashNodeUrl } from './desktopBootstrap';

// ── The desktop hand-off ───────────────────────────────────────────────────
//
// The Calimero desktop opens this app with the session in the fragment:
//
//   #access_token=…&refresh_token=…&node_url=…&app-id=…
//
// ⚠️ `app-id`, WITH A HYPHEN, while mero-react reads `application_id`. This
// app took the tokens and dropped the app id, then resolved one itself — you
// land signed in against no application, or against whichever install the
// fallback picked. Nothing errors. That is the "auth skip" not working.
//
// And `allowedNodeUrls` was handed the RAW url, where mero-react compares
// trust BY ORIGIN: a path or trailing slash never matches, the callback is
// rejected, and the tokens are dropped with only a console error.

const APP_ID_KEY = 'mero:application_id';
const NODE_URL_KEY = 'mero:node_url';

function withHash(hash: string, stored: Record<string, string> = {}) {
  const map = new Map(Object.entries(stored));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  });
  vi.stubGlobal('window', {
    location: { hash },
  });
  return map;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('bootstrapDesktopSession', () => {
  it('seeds the app id from `app-id`, the spelling the desktop sends', () => {
    const store = withHash(
      '#access_token=a&node_url=http://localhost:2428&app-id=abc123',
    );
    bootstrapDesktopSession();
    expect(store.get(APP_ID_KEY)).toBe('abc123');
  });

  it('accepts the other two spellings too', () => {
    for (const key of ['application_id', 'applicationId']) {
      const store = withHash(`#${key}=xyz`);
      bootstrapDesktopSession();
      expect(store.get(APP_ID_KEY)).toBe('xyz');
    }
  });

  it('seeds the node url as a BARE string, not JSON', () => {
    // The old SDK JSON-encoded this key. mero-react does not, and a quoted
    // URL never matches the origin its trust check compares.
    const store = withHash('#node_url=http://localhost:2428');
    bootstrapDesktopSession();
    expect(store.get(NODE_URL_KEY)).toBe('http://localhost:2428');
  });

  it('never overwrites a returning user’s stored values', () => {
    // A fragment is a cold-open hint, not an instruction.
    const store = withHash('#app-id=fromhash&node_url=http://hash:1', {
      [APP_ID_KEY]: 'mine',
      [NODE_URL_KEY]: 'http://mine:2428',
    });
    bootstrapDesktopSession();
    expect(store.get(APP_ID_KEY)).toBe('mine');
    expect(store.get(NODE_URL_KEY)).toBe('http://mine:2428');
  });

  it('does NOT touch the tokens or strip the hash', () => {
    // Both belong to MeroProvider. Consuming either here races React: the
    // token lands in the wrong place and every call goes out unauthenticated.
    const store = withHash('#access_token=tok&refresh_token=ref&app-id=a');
    bootstrapDesktopSession();
    expect([...store.keys()]).toEqual([APP_ID_KEY]);
    expect(
      (globalThis as { window: { location: { hash: string } } }).window.location
        .hash,
    ).toBe('#access_token=tok&refresh_token=ref&app-id=a');
  });

  it('is a no-op on an empty or malformed fragment', () => {
    for (const hash of ['', '#', '#%%%']) {
      const store = withHash(hash);
      expect(() => bootstrapDesktopSession()).not.toThrow();
      expect(store.size).toBe(0);
    }
  });
});

describe('hashNodeUrl', () => {
  it('returns the ORIGIN, which is what trust is compared by', () => {
    withHash('#node_url=http://localhost:2428/admin-api/');
    expect(hashNodeUrl()).toBe('http://localhost:2428');
  });

  it('is undefined with no node in the fragment, so trust is not anchored to nothing', () => {
    withHash('#access_token=a');
    expect(hashNodeUrl()).toBeUndefined();
  });

  it('is undefined for a value that is not a url, rather than throwing at boot', () => {
    withHash('#node_url=not-a-url');
    expect(hashNodeUrl()).toBeUndefined();
  });
});

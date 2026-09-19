import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapDesktopSession } from './desktopBootstrap';

/**
 * This suite runs in vitest's `node` environment (see vite.config.ts) and jsdom
 * is not a dependency of this app, so `window` and `localStorage` are stubbed
 * rather than emulated. The module under test touches exactly two globals and
 * both are trivial to stand in for — adding jsdom to get them would be a new
 * dependency in a security-relevant app for six assertions.
 */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

let storage: Storage;
const win = { location: { hash: '' } };

/**
 * These assert the exact STORAGE KEYS and the exact ENCODING, because that is
 * precisely what was broken: the previous implementation wrote a well-formed
 * value to `node-url`, which `calimero-client` never reads, and the desktop
 * hand-off degraded to the connect screen with nothing reported.
 *
 * A test that only checked "something was stored" would have passed against the
 * bug. So would one that read the value back through a helper of our own.
 */
function setHash(hash: string) {
  win.location.hash = hash;
}

beforeEach(() => {
  storage = fakeStorage();
  win.location.hash = '';
  vi.stubGlobal('window', win);
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bootstrapDesktopSession', () => {
  it('seeds the app id from `app-id`, the spelling the desktop actually sends', () => {
    setHash('#access_token=t&refresh_token=r&app-id=app-abc');
    bootstrapDesktopSession();
    // The SDK reads this key, and reads `application_id` from the fragment —
    // which is why the hyphenated spelling has to be handled here.
    expect(localStorage.getItem('mero:application_id')).toBe('app-abc');
  });

  it('accepts the other two spellings too', () => {
    setHash('#application_id=app-snake');
    bootstrapDesktopSession();
    expect(localStorage.getItem('mero:application_id')).toBe('app-snake');
  });

  it('stores the node under `mero:node_url`, as a bare string', () => {
    setHash('#node_url=https://node-7.calimero.network');
    bootstrapDesktopSession();
    const raw = localStorage.getItem('mero:node_url');
    // A BARE string. The old SDK JSON-encoded this; mero-react does not, and a
    // quoted URL never matches the origin its trust check compares.
    expect(raw).toBe('https://node-7.calimero.network');
    // The two keys nothing reads any more. Writing to either is the bug this
    // file exists to prevent, and the SDK swap reintroduced it once already.
    expect(localStorage.getItem('node-url')).toBeNull();
    expect(localStorage.getItem('app-url')).toBeNull();
  });

  it('leaves the tokens and the hash alone', () => {
    const hash = '#access_token=t&refresh_token=r&app-id=app-abc';
    setHash(hash);
    bootstrapDesktopSession();
    // CalimeroProvider owns both; consuming either here races React and the
    // token lands somewhere the SDK does not look.
    expect(win.location.hash).toBe(hash);
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('never overwrites an existing session', () => {
    localStorage.setItem('mero:application_id', 'already-here');
    localStorage.setItem('mero:node_url', 'https://mine.example');
    setHash('#app-id=app-abc&node_url=https://other.example');
    bootstrapDesktopSession();
    expect(localStorage.getItem('mero:application_id')).toBe('already-here');
    expect(localStorage.getItem('mero:node_url')).toBe('https://mine.example');
  });

  it('does nothing without a hash', () => {
    bootstrapDesktopSession();
    expect(localStorage.getItem('mero:application_id')).toBeNull();
    expect(localStorage.getItem('app-url')).toBeNull();
  });
});

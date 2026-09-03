/**
 * Pins the desktop auth-skip.
 *
 * `persistAuthHash` must seed the node for a token-bearing hash — the ONE case
 * it exists for. mero-react's `resolveTrustedNodeUrl` is default-deny,
 * so unless `getNodeUrl()` already holds the callback's node (or the app passes
 * `allowedNodeUrls`), MeroProvider drops the desktop's tokens and logs
 * "OAuth callback node_url is not trusted … no tokens stored" — and nothing
 * else. The app then renders its Connect screen while holding a good session.
 *
 * Nothing throws on that path and web login works either way, so only a test
 * that asserts the seed for a TOKEN-BEARING hash can hold the fix down.
 * mero-sheets shares this file and carries the same test — this copy is here
 * because the fix drifted between the two once already.
 *
 * The DOM is stubbed by hand rather than run under jsdom: this app's vitest
 * config is a deliberately jsdom-free `environment: 'node'`, and pulling jsdom
 * in for one file would touch the workspace lockfile — which fans CI out to
 * every app in the monorepo. The stub also documents exactly which seams
 * the bootstrap touches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setNodeUrl = vi.fn();
const setApplicationId = vi.fn();

vi.mock('@calimero-network/mero-react', () => ({
  setNodeUrl: (u: string) => setNodeUrl(u),
  setApplicationId: (id: string) => setApplicationId(id),
}));

// ── minimal DOM ──────────────────────────────────────────────────────────────
// Installed before the dynamic import below, because the module evaluates
// `'__TAURI_INTERNALS__' in window` at import time.

const store = new Map<string, string>();

const location = { pathname: '/', search: '', hash: '' };

/** Split a URL into the three parts the bootstrap reads, and apply them. */
function apply(url: string): void {
  const [, pathname, search, hash] = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url)!;
  location.pathname = pathname || '/';
  location.search = search ?? '';
  location.hash = hash ?? '';
}

/** Point the fake location at `/<rest>`, the way an app open would. */
function locate(rest: string): void {
  apply(`/${rest}`);
}

Object.assign(globalThis, {
  window: {
    location,
    history: {
      // The real one rewrites the address bar; ours rewrites the fake location
      // so a test can assert what the bootstrap left behind.
      replaceState: (_s: unknown, _t: unknown, url: string) => apply(url),
    },
  },
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const { bootstrapSsoAndInvitation, peekPendingInvitation, clearPendingInvitation } =
  await import('./ssoBootstrap');

const NODE = 'http://localhost:2528';
const APP_ID = '9xQe1v2b3c4d5e6f';

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  locate('');
});

describe('persistAuthHash (via bootstrapSsoAndInvitation)', () => {
  it('seeds the node from a TOKEN-BEARING hash — the desktop cold open', () => {
    locate(
      `#access_token=a.b.c&refresh_token=r&node_url=${encodeURIComponent(NODE)}` +
        `&application_id=${APP_ID}`,
    );
    bootstrapSsoAndInvitation();
    expect(setNodeUrl).toHaveBeenCalledWith(NODE);
    expect(setApplicationId).toHaveBeenCalledWith(APP_ID);
  });

  it('leaves the token-bearing hash in place for MeroProvider to consume', () => {
    const hash = `#access_token=a.b.c&node_url=${encodeURIComponent(NODE)}`;
    locate(hash);
    bootstrapSsoAndInvitation();
    // Stripping it here is the other half of this bug's family: the provider
    // never sees the callback, so `resolveTokenAdoption` never runs and the
    // token is never stored where mero-js reads it.
    expect(location.hash).toBe(hash);
  });

  it('still seeds a TOKEN-LESS hash, which only pre-fills the connect screen', () => {
    locate(`#node_url=${encodeURIComponent(NODE)}`);
    bootstrapSsoAndInvitation();
    expect(setNodeUrl).toHaveBeenCalledWith(NODE);
  });

  it('accepts the legacy `app-id` spelling alongside `application_id`', () => {
    locate(
      `#access_token=a.b.c&node_url=${encodeURIComponent(NODE)}&app-id=${APP_ID}`,
    );
    bootstrapSsoAndInvitation();
    expect(setApplicationId).toHaveBeenCalledWith(APP_ID);
  });

  it('seeds nothing when there is no hash at all (an ordinary web visit)', () => {
    locate('');
    bootstrapSsoAndInvitation();
    expect(setNodeUrl).not.toHaveBeenCalled();
    expect(setApplicationId).not.toHaveBeenCalled();
  });
});

describe('captureInvitation (via bootstrapSsoAndInvitation)', () => {
  it('stashes ?invitation= and strips it from the address bar', () => {
    locate('?invitation=PAYLOAD');
    bootstrapSsoAndInvitation();
    // Peek, not take: the join is only attempted once authenticated and a
    // failed attempt has to stay retryable, so it is cleared explicitly.
    expect(peekPendingInvitation()).toBe('PAYLOAD');
    expect(peekPendingInvitation()).toBe('PAYLOAD');
    expect(location.search).toBe('');
    clearPendingInvitation();
    expect(peekPendingInvitation()).toBeNull();
  });

  it('keeps a token-bearing hash while stripping the invitation query', () => {
    const hash = `#access_token=a.b.c&node_url=${encodeURIComponent(NODE)}`;
    locate(`?invitation=PAYLOAD${hash}`);
    bootstrapSsoAndInvitation();
    expect(location.search).toBe('');
    expect(location.hash).toBe(hash);
    expect(setNodeUrl).toHaveBeenCalledWith(NODE);
  });
});

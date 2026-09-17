/**
 * Pins invitation CAPTURE — the half of link invitations that runs before any
 * React renders.
 *
 * What the old hand-rolled `captureInvitation` got wrong, and what each test
 * here holds down:
 *
 *   - it read `location.search` only, so a `calimero://` desktop link and the
 *     launcher's warm `deep-link` event were invisible;
 *   - it accepted any `?invitation=`, including another app's, which two mero
 *     apps on one origin (and therefore one `localStorage`) make a real case;
 *   - it consumed the capture on read, so only one component could ever see it.
 *
 * The DOM is stubbed by hand rather than run under jsdom: this app's vitest
 * config is a deliberately jsdom-free `environment: 'node'`, and pulling jsdom
 * in for two files would touch the workspace lockfile — which fans CI out to
 * every app in the monorepo.
 */
import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();

const location = {
  href: 'https://tracker.example/',
  get search() {
    const q = this.href.indexOf('?');
    if (q < 0) return '';
    const end = this.href.indexOf('#', q);
    return end < 0 ? this.href.slice(q) : this.href.slice(q, end);
  },
};

const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

Object.assign(globalThis, {
  window: {
    location,
    localStorage,
    history: {
      replaceState: (_s: unknown, _t: unknown, url: string) => { location.href = url; },
    },
  },
  localStorage,
});

const {
  ensureInvitationCapture,
  invitationFromRaw,
  onInvitation,
  peekInvitation,
  resetInvitationCaptureForTests,
  urlWithoutInvitation,
} = await import('./invitationIntents');

const SLUG = 'com.calimero.mero-issue-tracker';

function open(href: string): void {
  location.href = href;
  ensureInvitationCapture();
}

beforeEach(() => {
  resetInvitationCaptureForTests();
  store.clear();
  location.href = 'https://tracker.example/';
});

describe('invitationFromRaw', () => {
  it('reads the platform HTTPS link', () => {
    expect(
      invitationFromRaw(`https://links.calimero.network/${SLUG}/join?invitation=CODE`),
    ).toBe('CODE');
  });

  it('reads a calimero:// deep link, whose dotted slug `new URL().hostname` mangles', () => {
    expect(invitationFromRaw(`calimero://${SLUG}/join?invitation=CODE`)).toBe('CODE');
  });

  it('reads the app’s own URL, where the launcher appends the query to any route', () => {
    // `{slug: "issue-tracker", action: null}` — a ROUTE misread as a slug.
    // Rejecting on the slug alone would throw this away.
    expect(invitationFromRaw('https://tracker.example/issue-tracker?invitation=CODE')).toBe(
      'CODE',
    );
    expect(invitationFromRaw('/?invitation=CODE')).toBe('CODE');
  });

  it('refuses ANOTHER app’s invitation — a shared origin means a shared store', () => {
    expect(
      invitationFromRaw('https://links.calimero.network/com.calimero.mero-stream/join?invitation=CODE'),
    ).toBeNull();
  });

  it('returns null when there is no invitation in it', () => {
    expect(invitationFromRaw(`https://links.calimero.network/${SLUG}/join`)).toBeNull();
    expect(invitationFromRaw('   ')).toBeNull();
  });
});

describe('urlWithoutInvitation', () => {
  it('drops the invitation and keeps every other parameter', () => {
    expect(urlWithoutInvitation('https://x.test/app?a=1&invitation=CODE&b=2')).toBe(
      'https://x.test/app?a=1&b=2',
    );
  });

  it('KEEPS the hash — it carries the SSO session on a desktop hand-off', () => {
    expect(
      urlWithoutInvitation('https://x.test/app?invitation=CODE#access_token=a.b.c'),
    ).toBe('https://x.test/app#access_token=a.b.c');
  });

  it('leaves a URL with no query alone', () => {
    expect(urlWithoutInvitation('https://x.test/app#h')).toBe('https://x.test/app#h');
  });
});

describe('capture', () => {
  it('captures from the cold-open URL and strips the parameter from the address bar', () => {
    open('https://tracker.example/issue-tracker?invitation=CODE');
    expect(peekInvitation()?.code).toBe('CODE');
    expect(location.search).toBe('');
  });

  it('is STICKY: every subscriber sees the same capture, and it survives a read', () => {
    open('https://tracker.example/?invitation=CODE');
    const seenA: (string | null)[] = [];
    const seenB: (string | null)[] = [];
    onInvitation((i) => seenA.push(i?.code ?? null));
    onInvitation((i) => seenB.push(i?.code ?? null));
    expect(seenA).toEqual(['CODE']);
    expect(seenB).toEqual(['CODE']);
    expect(peekInvitation()?.code).toBe('CODE');
  });

  it('one ack clears it for every subscriber, and it does not come back', () => {
    open('https://tracker.example/?invitation=CODE');
    const seen: (string | null)[] = [];
    onInvitation((i) => seen.push(i?.code ?? null));
    peekInvitation()!.resolve();
    expect(seen).toEqual(['CODE', null]);
    expect(peekInvitation()).toBeNull();

    // A second controller over the same storage must not replay an acked intent
    // — that is the whole point of the durable store's ack.
    resetInvitationCaptureForTests();
    ensureInvitationCapture();
    expect(peekInvitation()).toBeNull();
  });

  it('survives a reload before it is acked', () => {
    open('https://tracker.example/?invitation=CODE');
    resetInvitationCaptureForTests(); // a reload: same storage, new controller
    location.href = 'https://tracker.example/issue-tracker';
    ensureInvitationCapture();
    expect(peekInvitation()?.code).toBe('CODE');
  });

  it('ignores another app’s link instead of stashing it', () => {
    open('https://links.calimero.network/com.calimero.mero-stream/join?invitation=CODE');
    expect(peekInvitation()).toBeNull();
  });

  it('adopts a link captured by the pre-platform bootstrap', () => {
    store.set('pending-invitation', 'LEGACY');
    ensureInvitationCapture();
    expect(peekInvitation()?.code).toBe('LEGACY');
    peekInvitation()!.resolve();
    expect(store.has('pending-invitation')).toBe(false);
  });

  it('delivers to a subscriber that mounts long after the link was opened', () => {
    open('https://tracker.example/?invitation=CODE');
    let seen: string | null = null;
    onInvitation((i) => { seen = i?.code ?? null; });
    expect(seen).toBe('CODE');
  });
});

import { describe, expect, it } from 'vitest';
import {
  APP_PACKAGE,
  appsFromResponse,
  clearApplicationIdCache,
  packageOf,
  pickApplicationId,
  resolveApplicationId,
  type InstalledApp,
} from './appId';

const MINE = 'a'.repeat(64);
const THEIRS = 'b'.repeat(64);

function bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

describe('packageOf', () => {
  it('prefers the package field core serves', () => {
    expect(packageOf({ id: MINE, package: '  com.example.app  ' })).toBe(
      'com.example.app',
    );
  });

  it('falls back to the manifest bytes when the field is absent', () => {
    // `@calimero-network/calimero-client@1.25.0-beta.2` types the row without
    // `package`; core does serve it, but a node may still answer without it.
    const app: InstalledApp = {
      id: MINE,
      metadata: bytes(
        JSON.stringify({ package: APP_PACKAGE, name: 'MeroSign' }),
      ),
    };
    expect(packageOf(app)).toBe(APP_PACKAGE);
  });

  it('does not guess from a manifest it cannot parse', () => {
    // Deliberately not a substring search: "does this blob mention my package"
    // would also match an app that merely references us, and picking the wrong
    // application id is the failure this module exists to prevent.
    expect(
      packageOf({ id: MINE, metadata: bytes('not json') }),
    ).toBeUndefined();
    expect(
      packageOf({ id: MINE, metadata: bytes(`{"note":"${APP_PACKAGE}"}`) }),
    ).toBeUndefined();
    expect(packageOf({ id: MINE })).toBeUndefined();
    expect(packageOf({ id: MINE, metadata: [] })).toBeUndefined();
  });
});

describe('pickApplicationId', () => {
  it('matches on package, not position', () => {
    expect(
      pickApplicationId([
        { id: THEIRS, package: 'com.calimero.kv-store' },
        { id: MINE, package: APP_PACKAGE },
      ]),
    ).toBe(MINE);
  });

  // The fallback that once pointed scaffolding-e2e at a kv-store context and
  // ran its suite against the wrong contract.
  it('returns "" rather than apps[0] when this app is not installed', () => {
    expect(
      pickApplicationId([{ id: THEIRS, package: 'com.calimero.kv-store' }]),
    ).toBe('');
    expect(pickApplicationId([])).toBe('');
  });

  it('ignores rows with no id', () => {
    expect(pickApplicationId([{ id: '', package: APP_PACKAGE }])).toBe('');
  });

  it('prefers the highest version when one package has several installs', () => {
    // A registry build and a locally dev-signed one have DIFFERENT ids, because
    // an ApplicationId is hash(package, signer).
    const apps: InstalledApp[] = [
      { id: THEIRS, package: APP_PACKAGE, version: '0.0.9' },
      { id: MINE, package: APP_PACKAGE, version: '0.0.12' },
    ];
    expect(pickApplicationId(apps)).toBe(MINE);
    expect(pickApplicationId([...apps].reverse())).toBe(MINE);
  });

  it('compares versions numerically, not as strings', () => {
    expect(
      pickApplicationId([
        { id: THEIRS, package: APP_PACKAGE, version: '0.0.9' },
        { id: MINE, package: APP_PACKAGE, version: '0.0.10' },
      ]),
    ).toBe(MINE);
  });

  it('keeps the node ordering when versions tie, so reads do not flap', () => {
    const apps: InstalledApp[] = [
      { id: MINE, package: APP_PACKAGE, version: '1.0.0' },
      { id: THEIRS, package: APP_PACKAGE, version: '1.0.0' },
    ];
    expect(pickApplicationId(apps)).toBe(MINE);
    expect(pickApplicationId(apps)).toBe(MINE);
  });

  it('treats a missing version as lowest', () => {
    expect(
      pickApplicationId([
        { id: THEIRS, package: APP_PACKAGE },
        { id: MINE, package: APP_PACKAGE, version: '0.0.1' },
      ]),
    ).toBe(MINE);
  });
});

describe('appsFromResponse', () => {
  const row = { id: MINE, package: APP_PACKAGE };

  it('reads the {data: {apps}} envelope current core sends', () => {
    expect(appsFromResponse({ data: { apps: [row] } })).toEqual([row]);
  });

  it('reads a bare {apps} body', () => {
    expect(appsFromResponse({ apps: [row] })).toEqual([row]);
  });

  it('reads a bare array', () => {
    expect(appsFromResponse([row])).toEqual([row]);
  });

  it('returns nothing for anything else, rather than throwing', () => {
    expect(appsFromResponse(null)).toEqual([]);
    expect(appsFromResponse(undefined)).toEqual([]);
    expect(appsFromResponse('nope')).toEqual([]);
    expect(appsFromResponse({ data: null })).toEqual([]);
    expect(appsFromResponse({ apps: 'nope' })).toEqual([]);
  });
});

describe('resolveApplicationId', () => {
  const ok = { data: { data: { apps: [{ id: MINE, package: APP_PACKAGE }] } } };

  it('asks the node and matches on package', async () => {
    clearApplicationIdCache();
    await expect(resolveApplicationId(async () => ok)).resolves.toBe(MINE);
  });

  it('asks once and caches the answer', async () => {
    clearApplicationIdCache();
    let calls = 0;
    const list = async () => {
      calls += 1;
      return ok;
    };
    await resolveApplicationId(list);
    await resolveApplicationId(list);
    expect(calls).toBe(1);
  });

  it('does NOT cache "not installed"', async () => {
    // Caching it would pin the app to "not installed" for the rest of the
    // session — including across the install that would have fixed it.
    clearApplicationIdCache();
    let calls = 0;
    const list = async () => {
      calls += 1;
      return calls === 1 ? { data: { data: { apps: [] } } } : ok;
    };
    await expect(resolveApplicationId(list)).resolves.toBe('');
    await expect(resolveApplicationId(list)).resolves.toBe(MINE);
  });

  it('returns "" on an error response instead of throwing', async () => {
    clearApplicationIdCache();
    await expect(
      resolveApplicationId(async () => ({ error: { message: 'nope' } })),
    ).resolves.toBe('');
  });

  it('returns "" when the call rejects', async () => {
    clearApplicationIdCache();
    await expect(
      resolveApplicationId(async () => {
        throw new Error('offline');
      }),
    ).resolves.toBe('');
  });
});

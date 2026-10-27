import { transportKeyBinding } from '@calimero-network/mero-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CloudMero,
  createCloudAdmin,
  invitationOf,
  mockQuotesAllowed,
  packageApplicationId,
  parseGroupId,
  parsePackageApplicationId,
  readSession,
  tokenOf,
  writeSession,
} from './backend.ts';

const BASE = 'https://cluster.example';

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A node that answers `/attestation` with a mock quote that is otherwise
 * perfect: it binds the client's nonce and the transport key it names. The
 * only thing wrong with it is that it is a mock, which is exactly what an
 * impostor can produce.
 */
function impostorFetch(): typeof fetch {
  const transportKey = new Uint8Array(32).fill(7);
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/attestation') {
      const nonce = url.searchParams.get('nonce') ?? '';
      const suffix = await transportKeyBinding(new Uint8Array(32), transportKey);
      const header = new TextEncoder().encode('MOCK_TDX_QUOTE_V1');
      const nonceBytes = Uint8Array.from(nonce.match(/../g)!.map((h) => parseInt(h, 16)));
      const quote = new Uint8Array([...header, ...nonceBytes, ...suffix]);
      let bin = '';
      for (const b of quote) bin += String.fromCharCode(b);
      return new Response(
        JSON.stringify({ quote: btoa(bin), transportKey: hex(transportKey), appHash: '', nonce, mock: true }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    // Anything past attestation means the client trusted the mock.
    return new Response(JSON.stringify({ error: 'IMPOSTOR', message: 'you sent me your request' }), { status: 418 });
  }) as typeof fetch;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  writeSession(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe('a production build', () => {
  it('trusts no mock quote unless built with VITE_CALIMERO_ALLOW_MOCK=true', () => {
    expect(mockQuotesAllowed()).toBe(false);
    vi.stubEnv('VITE_CALIMERO_ALLOW_MOCK', 'false');
    expect(mockQuotesAllowed()).toBe(false);
    vi.stubEnv('VITE_CALIMERO_ALLOW_MOCK', 'true');
    expect(mockQuotesAllowed()).toBe(true);
  });

  it('refuses an impostor that answers with a valid mock quote, before sending it anything', async () => {
    const fetchSpy = vi.fn(impostorFetch());
    vi.stubGlobal('fetch', fetchSpy);
    const mero = new CloudMero(BASE);
    await expect(mero.get('auth/me')).rejects.toThrow(/mock quote refused/);
    // Only the attestation was asked for: no request (and no passkey data) left.
    expect(fetchSpy.mock.calls.map((c) => new URL(String(c[0])).pathname)).toEqual(['/attestation']);
  });

  it('even when the cluster is on this machine', async () => {
    const fetchSpy = vi.fn(impostorFetch());
    vi.stubGlobal('fetch', fetchSpy);
    await expect(new CloudMero('http://127.0.0.1:2501').get('auth/me')).rejects.toThrow(/mock quote refused/);
  });

  it('a development build accepts the same mock and goes on to talk to the node', async () => {
    vi.stubEnv('VITE_CALIMERO_ALLOW_MOCK', 'true');
    const fetchSpy = vi.fn(impostorFetch());
    vi.stubGlobal('fetch', fetchSpy);
    await expect(new CloudMero(BASE).get('auth/me')).rejects.not.toThrow(/mock quote refused/);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('the session', () => {
  const session = { accountId: 'acc', sessionToken: 'secret-session', refreshToken: 'refresh-1', expiresAt: 1e12 };

  it('never writes the session token to localStorage', () => {
    writeSession(session);
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-session');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-session');
    expect(readSession()).toEqual(session);
  });

  it('a reload keeps only a refreshable stub, from this tab', () => {
    writeSession(session);
    // A new page: memory is gone, the tab's storage is not.
    const stored = sessionStorage.getItem('calimero-cloud:refresh');
    writeSession(null);
    sessionStorage.setItem('calimero-cloud:refresh', stored!);
    expect(readSession()).toEqual({ accountId: 'acc', refreshToken: 'refresh-1', sessionToken: '', expiresAt: 0 });
  });

  it('forgets a session an older build left in localStorage', () => {
    localStorage.setItem('calimero-cloud:session', JSON.stringify(session));
    expect(readSession()).toBeNull();
    expect(localStorage.getItem('calimero-cloud:session')).toBeNull();
  });
});

describe('v1 ids on release-v2', () => {
  it('a group is the organization or one of its teams', () => {
    expect(parseGroupId('org1')).toEqual({ org: 'org1', team: null });
    expect(parseGroupId('org1.teamA')).toEqual({ org: 'org1', team: 'teamA' });
  });

  it('an application id can name a signed package, with or without a version', () => {
    expect(parsePackageApplicationId(packageApplicationId('com.calimero.kv'))).toEqual({ name: 'com.calimero.kv' });
    expect(parsePackageApplicationId(packageApplicationId('com.calimero.kv', '1.2.0'))).toEqual({ name: 'com.calimero.kv', version: '1.2.0' });
    expect(parsePackageApplicationId('ab'.repeat(32))).toBeNull();
  });

  it('an invitation token travels inside v1’s signed-invitation shape', () => {
    const inv = invitationOf('inv_tok', 'org1.teamA');
    expect(inv.invitation.group_id).toBe('org1.teamA');
    expect(tokenOf(inv)).toBe('inv_tok');
    expect(() => tokenOf({ invitation: { group_id: 'x' }, inviter_signature: 'sig' })).toThrow(/not a Calimero Cloud invitation/);
  });
});

describe('the admin API', () => {
  function adminOver(routes: Record<string, (body: unknown) => unknown>) {
    const mero = new CloudMero(BASE);
    const calls: Array<[string, string, unknown]> = [];
    const handle = (method: string) => async (path: string, body?: unknown) => {
      calls.push([method, path, body]);
      const route = routes[`${method} ${path}`];
      if (!route) throw Object.assign(new Error(`no route ${method} ${path}`), { status: 404 });
      return route(body);
    };
    Object.assign(mero, { get: handle('GET'), post: handle('POST'), delete: handle('DELETE'), whoami: async () => ({ accountId: 'me', orgs: [{ orgId: 'org1' }] }) });
    return { admin: createCloudAdmin(mero), calls };
  }

  it('creates a context from a package as an app in the team', async () => {
    const { admin, calls } = adminOver({ 'POST apps': () => ({ appId: 'app1' }) });
    const out = await admin.createContext({
      applicationId: packageApplicationId('com.calimero.kv', '1.0.0'),
      groupId: 'org1.teamA',
      initializationParams: [...new TextEncoder().encode('{"x":1}')],
    });
    expect(calls[0]).toEqual([
      'POST',
      'apps',
      { name: 'app', package: 'com.calimero.kv', version: '1.0.0', service: undefined, org: 'org1', access: { kind: 'team', team: 'teamA' }, initArgs: { x: 1 } },
    ]);
    expect(out.contextId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lists a team’s members with v1 roles', async () => {
    const { admin } = adminOver({
      'GET orgs/org1/teams/teamA': () => ({ members: [{ account: 'a', role: 'lead' }, { account: 'b', role: 'readOnly' }] }),
    });
    expect((await admin.listGroupMembers('org1.teamA')).members).toEqual([
      { identity: 'a', role: 'Admin' },
      { identity: 'b', role: 'ReadOnly' },
    ]);
  });

  it('names what release-v2 lacks instead of pretending', async () => {
    const { admin } = adminOver({});
    await expect((admin as unknown as { someV1OnlyMethod: () => Promise<unknown> }).someV1OnlyMethod()).rejects.toThrow(/someV1OnlyMethod is not available on Calimero Cloud/);
  });
});

/**
 * The one thing in `flow.ts` worth a test on its own: which cloud refusal is a
 * failure and which is a result.
 *
 * `POST /api/auth/account` answers 403 for two completely different situations
 * — a signature that did not verify, and a valid proof from an account no cloud
 * login has linked. The second is the claim *succeeding*: the cloud has written
 * the ownership down and is declining only to open a session over a plan that
 * does not exist. Treating it as an error would tell a keyholder their proof
 * failed when it is on record.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { claimAccountWithCloud, findAccountRelays } from './flow.js';
import type { DeviceIdentity } from './identity.js';

const ROOT_SECRET = '5b6b8a1e9f2c47d3a80e6f14c2b9d75380af4e21c6d3b95f7e08a1c4d2f63b97';
const ACCOUNT_ID = 'ca7645ffd4d0621d00c6c88743aeace5797135ab298c49e77de066206090b778';
const ROOT_PUBLIC_KEY = 'a021d221f1e7601e8d280c857f8a667383e3923dda13b55f21ca2d928b79c70c';

/** Answer a scripted queue and record what was asked. */
function scriptFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('claimAccountWithCloud', () => {
  it('claims the account and keeps the session a linked one opens', async () => {
    const calls = scriptFetch([
      { body: { nonce: 'n-1', expires_at_ms: 1_700_000_120_000 } },
      {
        body: {
          session_token: 'session.jwt',
          expires_at: 1_700_000_000,
          user: { email: 'owner@example.com' },
        },
      },
    ]);

    const result = await claimAccountWithCloud('https://manager.example/', ROOT_SECRET);

    expect(calls[0]?.url).toBe('https://manager.example/api/auth/account/challenge');
    expect(result.linked).toBe(true);
    expect(result.sessionToken).toBe('session.jwt');
    expect(result.email).toBe('owner@example.com');
    expect(result.accountId).toBe(ACCOUNT_ID);
    expect(result.rootPublicKey).toBe(ROOT_PUBLIC_KEY);
  });

  it('reports an unlinked account as proven rather than throwing', async () => {
    scriptFetch([
      { body: { nonce: 'n-2', expires_at_ms: 1 } },
      {
        status: 403,
        body: {
          detail:
            `ownership of account ${ACCOUNT_ID} is recorded, but it is not linked to a cloud ` +
            'login, so there is no plan or namespace list to open a session over.',
        },
      },
    ]);

    const result = await claimAccountWithCloud('https://manager.example', ROOT_SECRET);

    expect(result.linked).toBe(false);
    expect(result.sessionToken).toBe('');
    // The account is still named, because the claim landed and the panel says so.
    expect(result.accountId).toBe(ACCOUNT_ID);
    expect(result.detail).toMatch(/not linked to a cloud login/);
  });

  it('throws on the other 403, where nothing was recorded', async () => {
    scriptFetch([
      { body: { nonce: 'n-3', expires_at_ms: 1 } },
      { status: 403, body: { detail: 'account login signature did not verify' } },
    ]);

    await expect(claimAccountWithCloud('https://manager.example', ROOT_SECRET)).rejects.toThrow(
      /did not verify/,
    );
  });

  it('sends the root public key and no account id', async () => {
    const calls = scriptFetch([
      { body: { nonce: 'n-4', expires_at_ms: 1 } },
      { body: { session_token: 't', expires_at: 1, user: { email: 'o@e' } } },
    ]);

    await claimAccountWithCloud('https://manager.example', ROOT_SECRET);

    const sent = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    expect(sent.root_public_key).toBe(ROOT_PUBLIC_KEY);
    expect(sent.nonce).toBe('n-4');
    // The account is the hash of the key, so a supplied id could only agree or
    // lie -- not sending one is what removes the question.
    expect(sent.account_id).toBeUndefined();
  });
});

describe('findAccountRelays', () => {
  /**
   * The credential and device secret are the cross-repo fixture mero-js and
   * mdma both pin, so the proof this sends is the one the cloud verifies.
   */
  const IDENTITY = {
    accountId: '38701bbfdcbc1c30a0674e5e374a051bd22d22fffd1059be29148ce1f2c22752',
    credential:
      '02d2fa6fe39efba7493f76ad6efc0e7996d831eb1a0ce6fda707397fe2c012c6060000000038701bbfdcbc1c30a0674e5e374a051bd22d22fffd1059be29148ce1f2c227526c23496a85d5a2d25942c3196928d927e0074d01f73688cfd18c1943318ee66c236a93514a84577e9324eda015da3a8fb280b54a534d93ca2ab70f1eb5c77ed493e7d2ea8a91f18655f5c52a00ed0185d5cf4d45a27aa66b39ad3f2d41e6876a000000000100000093449921849d2388e7281f85c7382f6c8f1da95a7246ef17698428a4e9388541c8712acbaf3534ff6efcc89da0ff3c88534eb08537838dccd364743ce7ffd90a',
    deviceSecret: 'ef26085f1651bd1f4bba0832bf981c93cc00de33a037fb432b49b5fd4d552c88',
  } as unknown as DeviceIdentity;

  const challenge = { account_id: 'acct', nonce: 'n-1', expires_at_ms: 1_700_000_120_000 };

  it('splits usable relays from the rest', async () => {
    scriptFetch([
      { body: challenge },
      {
        body: {
          relays: [
            { peer_id: 'p-live', relay_url: 'https://live.example', fresh: true },
            { peer_id: 'p-stale', relay_url: 'https://stale.example', fresh: false },
            { peer_id: 'p-nourl', relay_url: null, fresh: true },
          ],
        },
      },
    ]);

    const out = await findAccountRelays('https://cloud.example', IDENTITY);

    expect(out.usable.map((r) => r.peerId)).toEqual(['p-live']);
    // Stale and URL-less are RETURNED, not dropped: "your relay is down" and
    // "you have no relay" need different actions from a person.
    expect(out.others.map((r) => r.peerId)).toEqual(['p-stale', 'p-nourl']);
  });

  it('reports an account with no relays as empty rather than throwing', async () => {
    // The normal answer for an account that has never joined anything: the
    // cloud derives this from records relays write for members they serve.
    // A first join still needs an invitation, and the UI has to say so.
    scriptFetch([{ body: challenge }, { body: { relays: [] } }]);

    const out = await findAccountRelays('https://cloud.example', IDENTITY);

    expect(out.usable).toEqual([]);
    expect(out.others).toEqual([]);
  });

  it('proves the read with the device certificate', async () => {
    const calls = scriptFetch([{ body: challenge }, { body: { relays: [] } }]);

    await findAccountRelays('https://cloud.example', IDENTITY);

    // Second call is the listing; it must carry the proof headers, because the
    // cloud requires them here unconditionally.
    const listing = calls[1];
    if (!listing) throw new Error('expected a second request: the relay listing');
    const headers = listing.init?.headers as Record<string, string> | undefined;
    expect(headers?.['X-Calimero-Credential']).toBe(IDENTITY.credential);
    expect(headers?.['X-Calimero-Nonce']).toBe('n-1');
    expect(headers?.['X-Calimero-Signature']).toBeTruthy();
  });
});

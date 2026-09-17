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

import { claimAccountWithCloud } from './flow.js';

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

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
import {
  AdminApiClient,
  signGroupInvitation,
  type DelegatedSession,
} from '@calimero-network/mero-js';

import {
  admitterBaseUrl,
  claimAccountWithCloud,
  createContextThroughRelay,
  describeCreation,
  explainCreationFailure,
  findAccountRelays,
  readContext,
  readInvitation,
  sendJoin,
} from './flow.js';
import type { DeviceIdentity } from './identity.js';

/**
 * A switch on `RelayClient`, so the creation tests can script what the relay
 * says without a relay — and every other test keeps the real one. `fake` null
 * means "the real client, unchanged".
 */
const relay = vi.hoisted(() => ({
  fake: null as null | ((config: Record<string, unknown>) => object),
  configs: [] as Array<Record<string, unknown>>,
}));

vi.mock('@calimero-network/mero-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@calimero-network/mero-js')>();
  class SwitchableRelayClient extends actual.RelayClient {
    constructor(config: ConstructorParameters<typeof actual.RelayClient>[0]) {
      super(config);
      relay.configs.push(config as unknown as Record<string, unknown>);
      if (relay.fake) {
        return relay.fake(config as unknown as Record<string, unknown>) as SwitchableRelayClient;
      }
    }
  }
  // The join op is borsh over a real signed invitation; the admit tests are
  // about where the op goes, not how it is encoded, so they script the signer.
  const signMemberJoinOp: typeof actual.signMemberJoinOp = (input) =>
    join.fake ? join.fake(input) : actual.signMemberJoinOp(input);
  return { ...actual, RelayClient: SwitchableRelayClient, signMemberJoinOp };
});

/** A switch on `signMemberJoinOp`; `fake` null means the real one. */
const join = vi.hoisted(() => ({
  fake: null as null | ((input: unknown) => Promise<string>),
}));

/** Sealing would attest a real relay; a marker is enough to see it was asked for. */
const sealedFetch = vi.hoisted(() => (() => Promise.reject(new Error('sealed'))) as typeof fetch);
vi.mock('./sealing.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sealing.js')>();
  return { ...actual, sealedRelayFetch: vi.fn(() => sealedFetch) };
});

const ROOT_SECRET = '5b6b8a1e9f2c47d3a80e6f14c2b9d75380af4e21c6d3b95f7e08a1c4d2f63b97';
const ACCOUNT_ID = 'ca7645ffd4d0621d00c6c88743aeace5797135ab298c49e77de066206090b778';
const ROOT_PUBLIC_KEY = 'a021d221f1e7601e8d280c857f8a667383e3923dda13b55f21ca2d928b79c70c';

/** Answer a scripted queue and record what was asked. */
function scriptFetch(responses: Array<{ status?: number; body?: unknown; text?: string }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch');
    // `text` is the body verbatim, for a refusal whose exact wording a test
    // expects to see quoted back.
    return new Response(next.text ?? JSON.stringify(next.body ?? {}), {
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

/**
 * The redesign's load-bearing claim: the namespace id is already in the
 * invitation, so the page must not ask for it a second time.
 *
 * It was two fields for one fact, and the two could disagree — a typed id that
 * did not match the signed `group_id` produced a join op for a namespace the
 * invitation does not cover, refused at the admitter with a 403 that reads like
 * a permissions problem rather than like a typo.
 */
describe('readInvitation', () => {
  const NS = '89ab' + 'cd'.repeat(30);

  it('reads the namespace and the admitters out of the signed body', () => {
    const parsed = readInvitation(
      JSON.stringify({
        invitation: { group_id: NS, admitters: ['aa', 'bb'] },
        inviter_signature: 'sig',
        // Unsigned envelope hints. Present in real invitations, and neither is
        // authorization: whoever relayed the invitation chose them.
        admitter_addrs: ['/ip4/10.0.0.1/tcp/2528/p2p/12D3KooW'],
      }),
    );

    expect(parsed.namespaceId).toBe(NS);
    expect(parsed.admitters).toEqual(['aa', 'bb']);
  });

  it('reads the namespace out of an invitation an account minted (bytes, not hex)', async () => {
    // What a browser-held key produces: mero-js's `signGroupInvitation`, the
    // same JSON shape a node's `createGroupInvitation` returns -- and in it
    // `group_id` is the 32-byte array core's wire type is, not 64 hex. On prod
    // this parsed as "no `group_id`" and the join legs were never reached.
    const inviterAccount = '11'.repeat(32);
    const admitter = '22'.repeat(32);
    const signed = await signGroupInvitation({
      groupId: NS,
      inviterAccount,
      deviceSecret: '7f'.repeat(32),
      admitters: [admitter],
      now: 1_700_000_000,
    });
    // The premise of the test: the installed mero-js really does spell it as bytes.
    expect(Array.isArray(signed.invitation.group_id)).toBe(true);
    expect(signed.invitation.group_id).toHaveLength(32);

    const parsed = readInvitation(JSON.stringify(signed));

    expect(parsed.namespaceId).toBe(NS);
    expect(parsed.admitters).toEqual([admitter]);
  });

  it('reads admitters spelled as bytes the same way', () => {
    const bytes = Array.from({ length: 32 }, (_, i) => i);
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    const parsed = readInvitation(
      JSON.stringify({ invitation: { group_id: bytes, admitters: [bytes, 'aa'.repeat(32)] } }),
    );

    expect(parsed.namespaceId).toBe(hex);
    expect(parsed.admitters).toEqual([hex, 'aa'.repeat(32)]);
  });

  it('refuses a byte array that is not a 32-byte id', () => {
    expect(() =>
      readInvitation(JSON.stringify({ invitation: { group_id: [1, 2, 3] } })),
    ).toThrow(/no `group_id`/);
    expect(() =>
      readInvitation(
        JSON.stringify({ invitation: { group_id: [...Array(31).fill(0), 256] } }),
      ),
    ).toThrow(/no `group_id`/);
    expect(() =>
      readInvitation(JSON.stringify({ invitation: { group_id: [...Array(31).fill(0), 'ff'] } })),
    ).toThrow(/no `group_id`/);
  });

  it('accepts an invitation naming no admitters', () => {
    // Empty is the legacy path -- any `*Ready` peer may admit -- and is a real
    // invitation rather than a malformed one.
    const parsed = readInvitation(JSON.stringify({ invitation: { group_id: NS } }));

    expect(parsed.admitters).toEqual([]);
  });

  it('lower-cases the namespace so it matches what the cloud is keyed by', () => {
    const parsed = readInvitation(
      JSON.stringify({ invitation: { group_id: NS.toUpperCase(), admitters: [] } }),
    );

    expect(parsed.namespaceId).toBe(NS);
  });

  it('tells a truncated paste apart from the wrong blob', () => {
    expect(() => readInvitation('{"invitation":')).toThrow(/not valid JSON/);
    expect(() => readInvitation(JSON.stringify({ inviter_signature: 'sig' }))).toThrow(
      /no `invitation` object/,
    );
  });

  it('refuses an invitation with no namespace in it', () => {
    // There is nowhere else to learn one: the cloud lookup deliberately returns
    // relays and never namespaces, so this cannot be recovered from.
    expect(() => readInvitation(JSON.stringify({ invitation: { admitters: [] } }))).toThrow(
      /no `group_id`/,
    );
    expect(() =>
      readInvitation(JSON.stringify({ invitation: { group_id: 'not-hex' } })),
    ).toThrow(/no `group_id`/);
  });

  it('asks for an invitation rather than erroring on an empty box', () => {
    expect(() => readInvitation('   ')).toThrow(/Paste the invitation/);
  });
});

/**
 * Delegated creation: the real `RelayClient` the installed mero-js ships (22.4.0
 * added `describeCreation`/`createContext`), and a scripted client for the
 * paths a relay would have to be set up for.
 */
describe('delegated context creation', () => {
  const GROUP = '11'.repeat(32);
  const APP = '44'.repeat(32);
  const IDENTITY = {
    accountId: '22'.repeat(32),
    credential: 'cafe',
    deviceSecret: '07'.repeat(32),
    devicePublicKey: 'ea'.repeat(32),
  } as unknown as DeviceIdentity;

  afterEach(() => {
    relay.fake = null;
    relay.configs.length = 0;
    localStorage.clear();
  });

  it('asks the relay through the installed mero-js, not a guard', async () => {
    const answer = {
      executorAccount: '33'.repeat(32),
      groupId: GROUP,
      canCreateOnBehalf: true,
      authorMayCreate: true,
    };
    const calls = scriptFetch([{ body: { data: answer } }]);

    await expect(
      describeCreation('https://relay.example/', GROUP, IDENTITY, { seal: false }),
    ).resolves.toEqual(answer);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://relay.example/admin-api/groups/${GROUP}/context-intents?author=${IDENTITY.accountId}`,
    );
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('refuses a creation the author may not make before signing anything', async () => {
    const calls = scriptFetch([
      {
        body: {
          data: {
            executorAccount: '33'.repeat(32),
            groupId: GROUP,
            canCreateOnBehalf: true,
            authorMayCreate: false,
          },
        },
      },
    ]);

    await expect(
      createContextThroughRelay(
        'https://relay.example',
        IDENTITY,
        { groupId: GROUP, applicationId: APP, initArgs: {} },
        { seal: false },
      ),
    ).rejects.toThrow(/admin of the group has to grant it CAN_CREATE_CONTEXT/);
    // Only the describe went out: no warrant was signed, no nonce spent.
    expect(calls).toHaveLength(1);
    expect(localStorage.length).toBe(0);
  });

  it('passes the relay, the author and the arguments through', async () => {
    const describeFn = vi.fn(async () => ({
      executorAccount: '33'.repeat(32),
      groupId: GROUP,
      canCreateOnBehalf: true,
      authorMayCreate: true,
    }));
    const createFn = vi.fn(async () => ({
      contextId: 'cc'.repeat(32),
      groupId: GROUP,
      memberPublicKey: 'dd'.repeat(32),
    }));
    relay.fake = () => ({ describeCreation: describeFn, createContext: createFn });

    const described = await describeCreation('https://relay.example/', GROUP, IDENTITY, {
      seal: false,
    });
    expect(described.canCreateOnBehalf).toBe(true);
    expect(describeFn).toHaveBeenCalledWith(GROUP, { author: IDENTITY.accountId });
    // The check signs nothing, so it is not handed the device secret.
    expect(relay.configs[0]).toMatchObject({ relayUrl: 'https://relay.example', deviceSecret: '' });
    expect(relay.configs[0]?.fetch).toBeUndefined();

    const created = await createContextThroughRelay(
      'https://relay.example/',
      IDENTITY,
      { groupId: GROUP, applicationId: APP, initArgs: { name: 'general' }, name: 'general' },
      { seal: false },
    );
    expect(created.contextId).toBe('cc'.repeat(32));
    expect(createFn).toHaveBeenCalledWith({
      groupId: GROUP,
      applicationId: APP,
      initArgs: { name: 'general' },
      name: 'general',
    });
    expect(relay.configs[1]).toMatchObject({
      relayUrl: 'https://relay.example',
      authorAccount: IDENTITY.accountId,
      authorProof: IDENTITY.credential,
      deviceSecret: IDENTITY.deviceSecret,
    });
  });

  it('puts the service name in the warrant when given, and nothing when not', async () => {
    const createFn = vi.fn(async () => ({
      contextId: 'cc'.repeat(32),
      groupId: GROUP,
      memberPublicKey: 'dd'.repeat(32),
    }));
    relay.fake = () => ({
      describeCreation: async () => ({
        executorAccount: '33'.repeat(32),
        groupId: GROUP,
        canCreateOnBehalf: true,
        authorMayCreate: true,
      }),
      createContext: createFn,
    });

    await createContextThroughRelay(
      'https://relay.example',
      IDENTITY,
      { groupId: GROUP, applicationId: APP, initArgs: {}, serviceName: 'docs' },
      { seal: false },
    );
    expect(createFn).toHaveBeenLastCalledWith({
      groupId: GROUP,
      applicationId: APP,
      initArgs: {},
      serviceName: 'docs',
    });

    await createContextThroughRelay(
      'https://relay.example',
      IDENTITY,
      { groupId: GROUP, applicationId: APP, initArgs: {}, serviceName: '' },
      { seal: false },
    );
    expect(createFn).toHaveBeenLastCalledWith({ groupId: GROUP, applicationId: APP, initArgs: {} });
  });

  it('asks about no author when there is no identity', async () => {
    const describeFn = vi.fn(async () => ({
      executorAccount: '33'.repeat(32),
      groupId: GROUP,
      canCreateOnBehalf: false,
    }));
    relay.fake = () => ({ describeCreation: describeFn });

    await describeCreation('https://relay.example', GROUP, null, { seal: false });

    expect(describeFn).toHaveBeenCalledWith(GROUP, {});
  });

  it('seals both calls when asked, and neither when not', async () => {
    relay.fake = () => ({
      describeCreation: async () => ({ executorAccount: 'e', groupId: GROUP, canCreateOnBehalf: true }),
      createContext: async () => ({ contextId: 'c', groupId: GROUP, memberPublicKey: 'm' }),
    });
    const input = { groupId: GROUP, applicationId: APP, initArgs: {} };

    await describeCreation('https://relay.example', GROUP, IDENTITY, { seal: true });
    await createContextThroughRelay('https://relay.example', IDENTITY, input, { seal: true });
    await createContextThroughRelay('https://relay.example', IDENTITY, input, { seal: false });

    expect(relay.configs[0]?.fetch).toBe(sealedFetch);
    expect(relay.configs[1]?.fetch).toBe(sealedFetch);
    expect(relay.configs[2]?.fetch).toBeUndefined();
  });

  it('turns a refusal into what to go and do, keeping the relay’s words', async () => {
    const refusal = Object.assign(new Error('relay refused the intent (HTTP 403)'), {
      status: 403,
      reason: `the author (${IDENTITY.accountId}) may not create contexts in group ${GROUP}; it needs CAN_CREATE_CONTEXT or admin`,
    });
    relay.fake = () => ({
      createContext: async () => {
        throw refusal;
      },
    });

    const failure = createContextThroughRelay(
      'https://relay.example',
      IDENTITY,
      { groupId: GROUP, applicationId: APP, initArgs: {} },
      { seal: false },
    );

    await expect(failure).rejects.toThrow(/admin of the group has to grant it CAN_CREATE_CONTEXT/);
    await expect(failure).rejects.toThrow(/the relay said: the author/);
  });
});

describe('explainCreationFailure', () => {
  const refused = (status: number, reason: string) =>
    Object.assign(new Error(`HTTP ${status}`), { status, reason });

  it('sends a missing create right to a group admin', () => {
    expect(explainCreationFailure(refused(403, 'author lacks CAN_CREATE_CONTEXT'))).toMatch(
      /grant it CAN_CREATE_CONTEXT.*needs no create rights/s,
    );
  });

  it('sends missing relay standing to RelayTee or CAN_AUTHOR_ON_BEHALF', () => {
    const text = explainCreationFailure(
      refused(403, 'the relay (ab) has no standing to act for members of group cd'),
    );
    expect(text).toMatch(/RelayTee/);
    expect(text).toMatch(/CAN_AUTHOR_ON_BEHALF/);
    expect(text).toMatch(/does not need CAN_CREATE_CONTEXT/);
  });

  it('names a sealed route the relay will not open', () => {
    expect(explainCreationFailure(refused(403, 'sealed_route_unguarded'))).toMatch(
      /does not accept this route sealed/,
    );
  });

  it('falls back to membership or a spent warrant for any other 403', () => {
    expect(explainCreationFailure(refused(403, 'nonce already spent'))).toMatch(
      /not a member.*sign a fresh one/s,
    );
  });

  it('reads 409 as another application and 404 as an unknown group', () => {
    // HTTPError carries the body as `bodyText`, not `reason`.
    const conflict = Object.assign(new Error('HTTP 409'), { status: 409, bodyText: 'app mismatch' });
    expect(explainCreationFailure(conflict)).toMatch(/different application.*sign a new warrant/s);
    expect(explainCreationFailure(conflict)).toMatch(/app mismatch/);
    expect(explainCreationFailure(Object.assign(new Error('HTTP 404'), { status: 404 }))).toMatch(
      /does not know that group/,
    );
  });

  it('leaves everything else alone', () => {
    // A sealing refusal arrives as HTTP 0; the page explains that one itself.
    expect(explainCreationFailure(Object.assign(new Error('x'), { status: 0 }))).toBeNull();
    expect(explainCreationFailure(new Error('no status'))).toBeNull();
    expect(explainCreationFailure('text')).toBeNull();
  });
});

/**
 * The read and the admit were the last two legs POSTed with a bare `fetch`.
 * Both now go through mero-js's `AdminApiClient`; what these tests pin is
 * that they do — the call reaches the client method, the client reaches the
 * node — and that every refusal still reads exactly as it did.
 */
describe('readContext', () => {
  const CONTEXT = 'ab'.repeat(32);
  const SESSION = { accessToken: 'tok-123' } as unknown as DelegatedSession;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads through AdminApiClient.queryContext with the session as bearer', async () => {
    const query = vi.spyOn(AdminApiClient.prototype, 'queryContext');
    const calls = scriptFetch([{ body: { data: { returns: { value: 'v' } } } }]);

    const result = await readContext('https://node.example/', SESSION, CONTEXT, 'get', {
      key: 'k',
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(CONTEXT, { method: 'get', argsJson: { key: 'k' } });
    expect(result).toEqual({ returns: { value: 'v' }, raw: { returns: { value: 'v' } } });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://node.example/admin-api/contexts/${CONTEXT}/query`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer tok-123');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ method: 'get', argsJson: { key: 'k' } });
  });

  it.each([
    [
      401,
      'expired',
      'the session was refused (401): expired. The token may have expired — open a new session.',
    ],
    [
      403,
      'not a member',
      'the node served the session but refused the read (403): not a member. ' +
        'This account is not a member of that context: it has to be invited and join.',
    ],
    [
      404,
      '',
      'no such context on this node (404). Check the context id, and that this node has joined it.',
    ],
    [500, 'boom', 'the read failed (HTTP 500): boom'],
  ])('explains a %i the way it always did', async (status, text, expected) => {
    scriptFetch([{ status, text }]);
    await expect(
      readContext('https://node.example', SESSION, CONTEXT, 'get', {}),
    ).rejects.toThrow(expected);
  });

  it('leaves a node that never answered unexplained', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      readContext('https://node.example', SESSION, CONTEXT, 'get', {}),
    ).rejects.not.toThrow(/the read failed/);
  });
});

describe('sendJoin', () => {
  const NAMESPACE = 'ab'.repeat(32);
  const ADMIT_URL = `https://admitter.example/admin-api/namespaces/${NAMESPACE}/admit`;
  const INVITATION = {
    invitation: { group_id: NAMESPACE, admitters: ['aa'.repeat(32)] },
    inviter_signature: 'sig',
  };
  const IDENTITY = {
    accountId: '22'.repeat(32),
    credential: 'cafe',
    deviceSecret: '07'.repeat(32),
    devicePublicKey: 'ea'.repeat(32),
  } as unknown as DeviceIdentity;

  afterEach(() => {
    join.fake = null;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('presents the join through AdminApiClient.admitJoin, with no credential', async () => {
    join.fake = async () => 'deadbeef';
    const admit = vi.spyOn(AdminApiClient.prototype, 'admitJoin');
    const calls = scriptFetch([{ body: { data: { published: true } } }]);

    const result = await sendJoin(ADMIT_URL, IDENTITY, JSON.stringify(INVITATION));

    expect(result).toEqual({ published: true, namespaceId: NAMESPACE });
    expect(admit).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledWith(NAMESPACE, { invitation: INVITATION, signedOp: 'deadbeef' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(ADMIT_URL);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBeNull();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      invitation: INVITATION,
      signedOp: 'deadbeef',
    });
  });

  it('reports a join the node accepted but did not publish', async () => {
    join.fake = async () => 'deadbeef';
    scriptFetch([{ body: { data: { published: false } } }]);
    await expect(sendJoin(ADMIT_URL, IDENTITY, JSON.stringify(INVITATION))).resolves.toEqual({
      published: false,
      namespaceId: NAMESPACE,
    });
  });

  it.each([
    [
      400,
      'bad op',
      'the node refused the op as malformed (400): bad op. The signature covers the ' +
        'invitation exactly as sent, so a re-serialised or edited invitation fails here.',
    ],
    [
      403,
      'not an admitter',
      'the node refused to carry this join (403): not an admitter. Either it is not in the ' +
        'invitation’s signed `admitters` list — being live and listed by the cloud is not ' +
        'the same thing — or the invitation itself was rejected as expired or not the ' +
        'inviter’s to issue.',
    ],
    [
      409,
      '',
      'that node holds no device of its own, so it cannot endorse anyone (409). ' +
        'Pick another admitter.',
    ],
    [502, 'bad gateway', 'the join was not published (HTTP 502): bad gateway'],
  ])('explains a %i the way it always did', async (status, text, expected) => {
    join.fake = async () => 'deadbeef';
    scriptFetch([{ status, text }]);
    await expect(sendJoin(ADMIT_URL, IDENTITY, JSON.stringify(INVITATION))).rejects.toThrow(
      expected,
    );
  });

  it('refuses an admitter URL for another namespace before signing anything', async () => {
    join.fake = vi.fn(async () => 'deadbeef');
    const calls = scriptFetch([]);
    await expect(
      sendJoin(
        `https://admitter.example/admin-api/namespaces/${'cd'.repeat(32)}/admit`,
        IDENTITY,
        JSON.stringify(INVITATION),
      ),
    ).rejects.toThrow(/does not end in/);
    expect(calls).toHaveLength(0);
  });
});

describe('admitterBaseUrl', () => {
  const NS = 'ab'.repeat(32);

  it('is the cloud-issued URL with the route taken off', () => {
    expect(admitterBaseUrl(`https://node.example/admin-api/namespaces/${NS}/admit`, NS)).toBe(
      'https://node.example',
    );
    expect(admitterBaseUrl(`https://node.example:2428/admin-api/namespaces/${NS}/admit/`, NS)).toBe(
      'https://node.example:2428',
    );
    expect(
      admitterBaseUrl(`https://node.example/relay/admin-api/namespaces/${NS.toUpperCase()}/admit`, NS),
    ).toBe('https://node.example/relay');
  });

  it('refuses a URL that is not that route, or is only the route', () => {
    expect(() => admitterBaseUrl('https://node.example/admin-api/namespaces/x/admit', NS)).toThrow(
      /does not end in/,
    );
    expect(() => admitterBaseUrl(`/admin-api/namespaces/${NS}/admit`, NS)).toThrow(/names no node/);
  });
});

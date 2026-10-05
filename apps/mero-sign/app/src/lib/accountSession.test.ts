import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AdminApiClient,
  ExecuteTransport,
} from '@calimero-network/mero-js';
import type { SignClient } from './node';

import {
  createWorkspace,
  hostingErrorOf,
  memberIdentityAfterCreate,
} from './agreements';
import {
  clearApplicationIdCache,
  resolveApplicationId,
  setSessionApplicationId,
} from './appId';
import { encodeInvite } from './inviteCodec';
import { meroApp } from './meroApp';
import { BLOB_NEEDS_CONTEXT, blobApi, nodeApi, signClientOf } from './node';

// ── An ACCOUNT session, through the account-aware admin ─────────────────────
//
// On prod, as an account, three routes answered HTTP 403 "Token does not carry
// the permissions this route requires": POST /admin-api/namespaces (create a
// workspace), POST /admin-api/contexts (create an agreement) and the
// invitation join. Each was a RAW client call — `mero.admin.<method>` on the
// node client — where the session's admin (`useMero().admin`, the account
// admin on a relay) is what knows how to found through the relay and sign
// under a warrant.
//
// mero-sign already builds its `SignClient` from `useMero()`'s `mero` AND
// `admin` (`signClientOf`), so what these tests pin is that the raw client's
// admin is UNREACHABLE from every write path: the raw `mero` here throws on
// any `admin` access at all. Plus the four account-only gaps this change
// closes: the application id comes from the session (no `listApplications`,
// a node-only route), `haError` is surfaced at creation, the member identity
// is re-derived rather than read off `createContext`, and node-only routes
// are refused in words.

interface Call {
  method: string;
  args: unknown[];
}

const APP_ID = 'a1'.repeat(32);
const NAMESPACE_ID = 'ab'.repeat(32);
const ACCOUNT = 'acct-' + 'cd'.repeat(16);

/** The raw client: `rpc` works, and any `admin` access is the bug. */
function rawClient(): { rpc: ExecuteTransport; admin: never } {
  return new Proxy(
    { rpc: { execute: async () => ({}) } },
    {
      get(target, prop) {
        if (prop === 'admin') {
          throw new Error(
            'raw mero.admin reached — this is the node route an account 403s on',
          );
        }
        return (target as Record<string | symbol, unknown>)[prop];
      },
    },
  ) as unknown as { rpc: ExecuteTransport; admin: never };
}

/** The account admin: records what was asked of it. */
function accountAdmin(over: Record<string, (...a: unknown[]) => unknown> = {}) {
  const calls: Call[] = [];
  const rec =
    (method: string, impl?: (...a: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      const run = over[method] ?? impl;
      return Promise.resolve().then(() => (run ? run(...args) : undefined));
    };
  const admin = {
    // A node-only route. The account admin throws by name; the test asserts
    // nothing in the write paths ever gets this far.
    listApplications: rec('listApplications', () => {
      throw new Error('NotForAccountError: listApplications');
    }),
    listNamespacesForApplication: rec('listNamespacesForApplication', () => []),
    createNamespace: rec('createNamespace', () => ({
      namespaceId: NAMESPACE_ID,
      teeEnabled: true,
      haEnabled: true,
    })),
    getGroupMetadata: rec('getGroupMetadata', () => null),
    setGroupMetadata: rec('setGroupMetadata'),
    setDefaultCapabilities: rec('setDefaultCapabilities'),
    setMemberCapabilities: rec('setMemberCapabilities'),
    getMemberCapabilities: rec('getMemberCapabilities', () => null),
    setSubgroupVisibility: rec('setSubgroupVisibility'),
    createGroupInNamespace: rec('createGroupInNamespace', () => ({
      groupId: 'sg-1',
    })),
    // ⚠️ What the account admin answers TODAY: no member key.
    createContext: rec('createContext', () => ({
      contextId: 'ctx-1',
      memberPublicKey: '',
    })),
    getContextIdentitiesOwned: rec('getContextIdentitiesOwned', () => ({
      identities: [ACCOUNT],
    })),
    joinNamespace: rec('joinNamespace', () => ({
      namespaceId: NAMESPACE_ID,
      memberIdentity: ACCOUNT,
      memberAccount: ACCOUNT,
    })),
    joinGroup: rec('joinGroup', () => {
      throw new Error('NotForAccountError: joinGroup');
    }),
    getBlob: rec('getBlob', () => new Uint8Array([1, 2, 3])),
    uploadBlob: rec('uploadBlob', () => ({ blobId: 'ff'.repeat(32), size: 3 })),
  };
  return { calls, admin: admin as unknown as AdminApiClient };
}

const methodsOf = (calls: Call[]) => calls.map((c) => c.method);
const argsOf = (calls: Call[], m: string) =>
  calls.find((c) => c.method === m)?.args;

function delegatedSession(
  over: Record<string, (...a: unknown[]) => unknown> = {},
): { calls: Call[]; client: SignClient; admin: AdminApiClient } {
  const { calls, admin } = accountAdmin(over);
  const client = signClientOf(rawClient(), admin);
  if (!client) throw new Error('signClientOf returned null');
  return { calls, client, admin };
}

beforeEach(() => {
  clearApplicationIdCache();
  // What `lib/MeroBridge` does for a delegated session: the registry id.
  setSessionApplicationId(APP_ID);
});
afterEach(() => clearApplicationIdCache());

describe('creating a workspace as an account', () => {
  it('goes through the session admin and never lists applications', async () => {
    const { calls, admin } = delegatedSession();
    const created = await createWorkspace(admin, {
      applicationId: APP_ID,
      name: 'Acme',
      accountId: ACCOUNT,
    });
    expect(created.namespaceId).toBe(NAMESPACE_ID);
    expect(created.haError).toBeNull();
    expect(argsOf(calls, 'createNamespace')?.[0]).toEqual({
      applicationId: APP_ID,
      name: 'Acme',
    });
    expect(methodsOf(calls)).not.toContain('listApplications');
  });

  it('surfaces haError when the cloud did not agree to host it', async () => {
    const { admin } = delegatedSession({
      createNamespace: () => ({
        namespaceId: NAMESPACE_ID,
        teeEnabled: true,
        haEnabled: false,
        haError:
          'link this account to your cloud user in the wallet so invitees can find this namespace',
      }),
    });
    const created = await createWorkspace(admin, {
      applicationId: APP_ID,
      name: 'Acme',
    });
    // Founded — the id is real and usable — but the person is told now,
    // not at invite time.
    expect(created.namespaceId).toBe(NAMESPACE_ID);
    expect(created.haError).toMatch(/link this account/);
  });

  it('reads a node answer (no HA fields) as "nothing to report"', () => {
    expect(hostingErrorOf({ namespaceId: NAMESPACE_ID })).toBeNull();
    expect(hostingErrorOf({ haEnabled: true })).toBeNull();
    expect(hostingErrorOf({ haEnabled: false })).toMatch(/did not agree/);
  });
});

describe('creating an agreement as an account', () => {
  it('uses the session application id and never asks the node for the listing', async () => {
    const { calls, client } = delegatedSession();
    await meroApp(client, NAMESPACE_ID, { isDelegated: true }).createContext(
      undefined,
      { context_name: 'Q3 NDA' },
    );
    const req = argsOf(calls, 'createContext')?.[0] as {
      applicationId?: string;
      groupId?: string;
    };
    expect(req.applicationId).toBe(APP_ID);
    expect(req.groupId).toBe('sg-1');
    expect(methodsOf(calls)).not.toContain('listApplications');
  });

  it('re-derives the member identity instead of writing "" into the agreement', async () => {
    // The account admin's `createContext` answers `memberPublicKey: ""`
    // today. The row's identity fields were built from it; the account's own
    // identity in the context is what `getContextIdentitiesOwned` answers.
    const { calls, client } = delegatedSession();
    const created = await meroApp(client, NAMESPACE_ID, {
      isDelegated: true,
    }).createContext(undefined, { context_name: 'Q3 NDA' });
    expect(created.memberPublicKey).toBe(ACCOUNT);
    expect(created.executorId).toBe(ACCOUNT);
    expect(argsOf(calls, 'getContextIdentitiesOwned')?.[0]).toBe('ctx-1');
  });

  it('does the same for the private signature store', async () => {
    const { client } = delegatedSession();
    const created = await meroApp(client, null, {
      isDelegated: true,
    }).createContext(undefined, { context_name: 'default', is_private: true });
    expect(created.memberPublicKey).toBe(ACCOUNT);
  });

  it('keeps the node answer when the node gave one', async () => {
    const { calls, admin } = accountAdmin();
    const identity = await memberIdentityAfterCreate(admin, {
      contextId: 'ctx-1',
      memberPublicKey: 'pk-node',
    });
    expect(identity).toBe('pk-node');
    expect(methodsOf(calls)).not.toContain('getContextIdentitiesOwned');
  });

  it('refuses to hand back an empty identity', async () => {
    const { admin } = accountAdmin({
      getContextIdentitiesOwned: () => ({ identities: [] }),
    });
    await expect(
      memberIdentityAfterCreate(admin, {
        contextId: 'ctx-1',
        memberPublicKey: '',
      }),
    ).rejects.toThrow(/no identity/);
  });
});

describe('joining from an invitation as an account', () => {
  const invitation = {
    invitation: { group_id: NAMESPACE_ID, invited_role: 0 },
    inviterSignature: 'ff'.repeat(64),
  };

  it('redeems a workspace invitation through the session admin', async () => {
    const { calls, client } = delegatedSession();
    const res = await nodeApi(client).joinContextByOpenInvitation(
      NAMESPACE_ID,
      invitation,
    );
    expect(res.error).toBeFalsy();
    expect(res.data?.memberIdentity).toBe(ACCOUNT);
    expect(argsOf(calls, 'joinNamespace')?.[0]).toBe(NAMESPACE_ID);
  });

  it('refuses the legacy per-agreement (joinGroup) invitation in words', async () => {
    // `joinGroup` is a node's own route; the account admin throws by name.
    // The adapter says so BEFORE the call, and points at the path that works.
    const { calls, client } = delegatedSession();
    const payload = encodeInvite({
      invitation: invitation as never,
      workspaceName: 'Acme',
    });
    await expect(
      meroApp(client, NAMESPACE_ID, { isDelegated: true }).joinContext({
        invitationPayload: payload,
      }),
    ).rejects.toThrow(/workspace invitation link/);
    expect(methodsOf(calls)).not.toContain('joinGroup');
  });

  it('still presents it on a node', async () => {
    const { calls, client } = delegatedSession({
      joinGroup: () => ({ groupId: 'sg-1' }),
    });
    const payload = encodeInvite({
      invitation: invitation as never,
      workspaceName: 'Acme',
    });
    await meroApp(client, NAMESPACE_ID).joinContext({
      invitationPayload: payload,
    });
    expect(methodsOf(calls)).toContain('joinGroup');
  });
});

describe('the application id for a delegated session', () => {
  it('is the session id, and the listing is never called', async () => {
    let listed = 0;
    const id = await resolveApplicationId(async () => {
      listed += 1;
      return { data: [] };
    });
    expect(id).toBe(APP_ID);
    expect(listed).toBe(0);
  });

  it('falls back to the listing on a node login (no session id)', async () => {
    setSessionApplicationId(null);
    let listed = 0;
    const id = await resolveApplicationId(async () => {
      listed += 1;
      return { data: [] };
    });
    expect(id).toBe('');
    expect(listed).toBe(1);
  });
});

describe('blob calls for an account', () => {
  it('always carry a context, and say so when none was given', async () => {
    const { calls, client } = delegatedSession();
    const blobs = blobApi(client);

    await expect(blobs.downloadBlob('aa'.repeat(32), '')).rejects.toThrow(
      BLOB_NEEDS_CONTEXT,
    );
    const up = await blobs.uploadBlob(new Blob(['x']), undefined, '');
    expect(up.error?.message).toBe(BLOB_NEEDS_CONTEXT);
    expect(methodsOf(calls)).toEqual([]);

    await blobs.downloadBlob('aa'.repeat(32), 'ctx-1');
    expect(argsOf(calls, 'getBlob')?.[1]).toEqual({ contextId: 'ctx-1' });
    await blobs.uploadBlob(new Blob(['x']), undefined, 'ctx-1');
    expect(argsOf(calls, 'uploadBlob')?.[0]).toMatchObject({
      contextId: 'ctx-1',
    });
  });
});

import { describe, expect, it, vi } from 'vitest';

import { decodeInvite } from './inviteCodec';
import {
  createSpace,
  createVault,
  displayName,
  initParamsFor,
  listSpaces,
  listVaults,
  mintSpaceInvite,
  mintVaultInvite,
  unwrapInvitation,
  type AdminLike,
} from './vaults';

const SIGNED = {
  invitation: { groupId: [0x3f, 0x8a, 0x91, 0xc2] },
  inviterSignature: 'c0ffee',
};

/** Just enough admin client for one flow, with every call recorded. */
function fakeAdmin(over: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string, result: unknown = undefined) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(result);
    };
  const admin = {
    createNamespace: record('createNamespace', { namespaceId: 'ns-1' }),
    setGroupMetadata: record('setGroupMetadata'),
    setDefaultCapabilities: record('setDefaultCapabilities'),
    setSubgroupVisibility: record('setSubgroupVisibility'),
    createGroupInNamespace: record('createGroupInNamespace', {
      groupId: 'sub-1',
    }),
    createContext: record('createContext', {
      contextId: 'ctx-1',
      memberPublicKey: 'exec-1',
    }),
    createNamespaceInvitation: record('createNamespaceInvitation', {
      invitation: SIGNED,
    }),
    listNamespacesForApplication: record('listNamespacesForApplication', []),
    listNamespaceGroups: record('listNamespaceGroups', []),
    listGroupContexts: record('listGroupContexts', []),
    listGroupMembers: record('listGroupMembers', { members: [] }),
    getGroupMetadata: record('getGroupMetadata', null),
    getContextIdentitiesOwned: record('getContextIdentitiesOwned', {
      identities: [],
    }),
    ...over,
  } as unknown as AdminLike;
  return { admin, calls };
}

const methodsOf = (calls: { method: string }[]) => calls.map((c) => c.method);
const argsOf = (calls: { method: string; args: unknown[] }[], m: string) =>
  calls.find((c) => c.method === m)?.args;

describe('displayName', () => {
  it('prefers the first non-blank candidate', () => {
    expect(displayName([null, '  ', 'Acme Ltd'], 'abc123def', 'Space')).toBe(
      'Acme Ltd',
    );
  });

  it('falls back to a short id only when NOBODY typed a name', () => {
    // The hex stub is the failure mode this whole change exists to remove, so
    // it must be unreachable whenever a real name is available.
    expect(displayName([undefined, ''], '3f8a91c2d4e5', 'Vault')).toBe(
      'Vault 3f8a91c2…',
    );
  });

  it('does not throw on an id shorter than the slice', () => {
    expect(displayName([], 'abc', 'Vault')).toBe('Vault abc…');
  });
});

describe('initParamsFor', () => {
  it("encodes the vault's name as the contract's init JSON", () => {
    // This is the call that puts the name into REPLICATED state, which is the
    // only copy that reaches the node of the person who was invited.
    const bytes = initParamsFor('Bank logins');
    const json = new TextDecoder().decode(Uint8Array.from(bytes));
    expect(JSON.parse(json)).toEqual({ name: 'Bank logins' });
  });
});

describe('unwrapInvitation', () => {
  it('descends to the object carrying the signature', () => {
    expect(unwrapInvitation({ invitation: SIGNED })).toBe(SIGNED);
    expect(unwrapInvitation({ data: { invitation: SIGNED } })).toBeNull();
    expect(unwrapInvitation(SIGNED)).toBe(SIGNED);
  });

  it('accepts either signature spelling', () => {
    const snake = { invitation: {}, inviter_signature: 'c0ffee' };
    expect(unwrapInvitation({ invitation: snake })).toBe(snake);
  });

  it('returns null rather than looping on a cycle-shaped payload', () => {
    expect(unwrapInvitation({ invitation: { invitation: {} } })).toBeNull();
    expect(unwrapInvitation(null)).toBeNull();
    expect(unwrapInvitation('nope')).toBeNull();
  });
});

describe('createSpace', () => {
  it('passes the name ON THE WIRE and records it in metadata too', async () => {
    const { admin, calls } = fakeAdmin();
    await createSpace(admin, { applicationId: 'app-1', name: 'Acme Ltd' });

    expect(argsOf(calls, 'createNamespace')).toEqual([
      { applicationId: 'app-1', name: 'Acme Ltd' },
    ]);
    // Belt and braces: `listSpaces` falls back to the metadata record when the
    // namespace listing answers without a name.
    expect(argsOf(calls, 'setGroupMetadata')).toEqual([
      'ns-1',
      { name: 'Acme Ltd' },
    ]);
  });

  it('opens the namespace so invited members can reach its vaults', async () => {
    const { admin, calls } = fakeAdmin();
    await createSpace(admin, { applicationId: 'app-1', name: 'Acme' });
    // Lowercase: core rejects "Open" outright, and mero-js types the field as a
    // bare string so nothing catches the casing at compile time.
    expect(argsOf(calls, 'setSubgroupVisibility')).toEqual([
      'ns-1',
      { subgroupVisibility: 'open' },
    ]);
  });

  it('survives a node that refuses the optional hardening calls', async () => {
    const { admin } = fakeAdmin({
      setDefaultCapabilities: () => Promise.reject(new Error('nope')),
      setSubgroupVisibility: () => Promise.reject(new Error('nope')),
      setGroupMetadata: () => Promise.reject(new Error('nope')),
    });
    await expect(
      createSpace(admin, { applicationId: 'app-1', name: 'Acme' }),
    ).resolves.toEqual({ namespaceId: 'ns-1' });
  });
});

describe('createVault', () => {
  it('writes the name to the subgroup AND into the contract', async () => {
    const { admin, calls } = fakeAdmin();
    const made = await createVault(admin, {
      applicationId: 'app-1',
      namespaceId: 'ns-1',
      name: 'Bank logins',
    });

    expect(made).toEqual({
      vaultId: 'sub-1',
      contextId: 'ctx-1',
      memberPublicKey: 'exec-1',
    });
    // ⚠️ `groupName`, not `name` — every core request body is
    // deny_unknown_fields, so the wrong spelling is a 400 for the whole call.
    expect(argsOf(calls, 'createGroupInNamespace')).toEqual([
      'ns-1',
      { groupName: 'Bank logins' },
    ]);
    // The value does not persist, so the readable copy is the metadata record.
    expect(argsOf(calls, 'setGroupMetadata')).toEqual([
      'sub-1',
      { name: 'Bank logins' },
    ]);
    const [ctxArgs] = argsOf(calls, 'createContext') as [
      { initializationParams: number[]; groupId: string },
    ];
    // Bound to the SUBGROUP, not the namespace.
    expect(ctxArgs.groupId).toBe('sub-1');
    expect(ctxArgs.initializationParams).toEqual(initParamsFor('Bank logins'));
  });

  it('FAILS if the vault cannot be opened to space members', async () => {
    // Not swallowed, unlike the namespace-root call: a restricted vault
    // silently cannot be joined by the people invited to the space, so this has
    // to surface where the message can say so.
    const { admin } = fakeAdmin({
      setSubgroupVisibility: () => Promise.reject(new Error('refused')),
    });
    await expect(
      createVault(admin, {
        applicationId: 'app-1',
        namespaceId: 'ns-1',
        name: 'X',
      }),
    ).rejects.toThrow('refused');
  });

  it('opens the vault before creating its context', async () => {
    const { admin, calls } = fakeAdmin();
    await createVault(admin, {
      applicationId: 'app-1',
      namespaceId: 'ns-1',
      name: 'X',
    });
    const order = methodsOf(calls);
    expect(order.indexOf('setSubgroupVisibility')).toBeLessThan(
      order.indexOf('createContext'),
    );
  });
});

describe('listSpaces / listVaults', () => {
  it('names a space from the listing, falling back to its metadata record', async () => {
    const { admin } = fakeAdmin({
      listNamespacesForApplication: () =>
        Promise.resolve([
          { namespaceId: 'a', name: 'Acme', memberCount: 2, subgroupCount: 1 },
          { namespaceId: 'b', name: '', memberCount: 1, subgroupCount: 0 },
        ]),
      getGroupMetadata: () => Promise.resolve({ name: 'From metadata' }),
    });
    const rows = await listSpaces(admin, 'app-1');
    expect(rows.map((r) => r.name)).toEqual(['Acme', 'From metadata']);
    expect(rows[0].vaultCount).toBe(1);
  });

  it('names a vault from its metadata record, because the listing has none', async () => {
    const { admin } = fakeAdmin({
      listNamespaceGroups: () => Promise.resolve([{ groupId: 'sub-1' }]),
      getGroupMetadata: () => Promise.resolve({ name: 'Bank logins' }),
      listGroupContexts: () => Promise.resolve([{ contextId: 'ctx-1' }]),
      listGroupMembers: () => Promise.resolve({ members: [{ id: 'm' }] }),
      getContextIdentitiesOwned: () =>
        Promise.resolve({ identities: ['exec-1'] }),
    });
    const [row] = await listVaults(admin, 'ns-1');
    expect(row).toEqual({
      vaultId: 'sub-1',
      name: 'Bank logins',
      contextId: 'ctx-1',
      memberCount: 1,
      joined: true,
      identity: 'exec-1',
    });
  });

  it('degrades a vault row rather than emptying the list', async () => {
    // A vault whose context has not replicated to this node yet is the normal
    // state right after joining, not an error.
    const { admin } = fakeAdmin({
      listNamespaceGroups: () => Promise.resolve([{ groupId: 'sub-1' }]),
      listGroupContexts: () => Promise.reject(new Error('not here yet')),
      listGroupMembers: () => Promise.reject(new Error('not here yet')),
      getGroupMetadata: () => Promise.reject(new Error('not here yet')),
    });
    const [row] = await listVaults(admin, 'ns-1');
    expect(row.contextId).toBeNull();
    expect(row.joined).toBe(false);
    expect(row.name).toBe('Vault sub-1…');
  });
});

describe('minting invitations', () => {
  it("mints a space code carrying the space's NAME", async () => {
    const { admin } = fakeAdmin();
    const code = await mintSpaceInvite(admin, {
      namespaceId: 'ns-1',
      spaceName: 'Acme Ltd',
    });
    const decoded = decodeInvite(code)!;
    expect(decoded.kind).toBe('namespace');
    // The name is what the recipient is shown before they accept. Without it
    // the prompt reads "You have been invited to a space".
    expect(decoded.groupAlias).toBe('Acme Ltd');
  });

  it('mints a vault code whose GRANT is still the namespace', async () => {
    const { admin, calls } = fakeAdmin();
    const code = await mintVaultInvite(admin, {
      namespaceId: 'ns-1',
      vaultId: 'sub-1',
      vaultName: 'Bank logins',
      spaceName: 'Acme Ltd',
      contextId: 'ctx-1',
    });
    // Vault access is inherited, so there is no narrower invitation to mint —
    // the node is asked for a NAMESPACE invitation either way.
    expect(argsOf(calls, 'createNamespaceInvitation')).toEqual(['ns-1', {}]);
    const decoded = decodeInvite(code)!;
    expect(decoded.kind).toBe('vault');
    expect(decoded.vaultId).toBe('sub-1');
    expect(decoded.vaultName).toBe('Bank logins');
    expect(decoded.groupAlias).toBe('Acme Ltd');
  });

  it('refuses an invitation the node returned without a signature', async () => {
    const { admin } = fakeAdmin({
      createNamespaceInvitation: () => Promise.resolve({ invitation: {} }),
    });
    await expect(
      mintSpaceInvite(admin, { namespaceId: 'ns-1' }),
    ).rejects.toThrow(/signature/i);
  });

  it('never passes an invitee key', async () => {
    // It is silently ignored by the node and misleads the next reader into
    // thinking the code is scoped to one person.
    const { admin, calls } = fakeAdmin();
    await mintSpaceInvite(admin, { namespaceId: 'ns-1' });
    expect(argsOf(calls, 'createNamespaceInvitation')).toEqual(['ns-1', {}]);
  });
});

describe('a status sink narrates every step', () => {
  it('reports progress rather than leaving the UI on one spinner', async () => {
    const { admin } = fakeAdmin();
    const onStatus = vi.fn();
    await createVault(
      admin,
      { applicationId: 'app-1', namespaceId: 'ns-1', name: 'X' },
      onStatus,
    );
    expect(onStatus.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

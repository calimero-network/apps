import { describe, expect, it, vi } from 'vitest';
import { CAPABILITIES } from '@calimero-network/mero-js';

import { decodeInvite } from './inviteCodec';
import {
  ADMIN_CAPABILITIES,
  MEMBER_CAPABILITIES,
  canCreateVault,
} from './roles';
import {
  DEFAULT_INVITE_SECS,
  createPersonalVault,
  createTeam,
  createVault,
  displayName,
  initParamsFor,
  listTeams,
  listVaults,
  mintTeamInvite,
  listTeamMembers,
  mintVaultInvite,
  isPersonalRecord,
  myCapabilities,
  removeTeamMember,
  repairCreatorAdmin,
  setMemberRole,
  vaultAudience,
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
    getSubgroupVisibility: record('getSubgroupVisibility', 'open'),
    createGroupInvitation: record('createGroupInvitation', {
      invitation: SIGNED,
    }),
    getContextIdentitiesOwned: record('getContextIdentitiesOwned', {
      identities: [],
    }),
    updateMemberRole: record('updateMemberRole'),
    setMemberCapabilities: record('setMemberCapabilities'),
    getMemberCapabilities: record('getMemberCapabilities', {
      capabilities: ADMIN_CAPABILITIES,
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
    expect(displayName([null, '  ', 'Acme Ltd'], 'abc123def', 'Team')).toBe(
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

describe('createTeam', () => {
  it('passes the name ON THE WIRE and records it in metadata too', async () => {
    const { admin, calls } = fakeAdmin();
    await createTeam(admin, { applicationId: 'app-1', name: 'Acme Ltd' });

    expect(argsOf(calls, 'createNamespace')).toEqual([
      { applicationId: 'app-1', name: 'Acme Ltd' },
    ]);
    // Belt and braces: `listTeams` falls back to the metadata record when the
    // namespace listing answers without a name.
    expect(argsOf(calls, 'setGroupMetadata')).toEqual([
      'ns-1',
      { name: 'Acme Ltd' },
    ]);
  });

  it('opens the namespace so invited members can reach its vaults', async () => {
    const { admin, calls } = fakeAdmin();
    await createTeam(admin, { applicationId: 'app-1', name: 'Acme' });
    // Lowercase: core rejects "Open" outright, and mero-js types the field as a
    // bare string so nothing catches the casing at compile time.
    expect(argsOf(calls, 'setSubgroupVisibility')).toEqual([
      'ns-1',
      { subgroupVisibility: 'open' },
    ]);
  });

  // ⚠️ `setDefaultCapabilities` USED TO BE IN THIS LIST, and is not any more.
  //
  // At rc.37 all three were genuinely optional: losing the metadata write cost
  // a label, losing the visibility write cost invitees a vault they could
  // re-reach, and losing the capability write left them with
  // `CAN_JOIN_OPEN_SUBGROUPS`, which is what they were being given anyway.
  //
  // rc.41 seeds a namespace with `CAN_AUTHOR_ON_BEHALF` too (#3969), so losing
  // that write now GRANTS a capability instead of withholding one. It has its
  // own test below, asserting it is fatal. The other two are still optional and
  // this still pins that they are.
  it('survives a node that refuses the genuinely optional calls', async () => {
    const { admin } = fakeAdmin({
      setSubgroupVisibility: () => Promise.reject(new Error('nope')),
      setGroupMetadata: () => Promise.reject(new Error('nope')),
      getMemberCapabilities: () =>
        Promise.resolve({ capabilities: ADMIN_CAPABILITIES }),
    });
    await expect(
      createTeam(admin, {
        applicationId: 'app-1',
        name: 'Acme',
        accountId: 'a'.repeat(64),
      }),
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
    //
    // ⚠️ AND `visibility` AT BIRTH. A subgroup created without it is born
    // RESTRICTED, and the `setSubgroupVisibility` that follows is a SECOND
    // governance write which a member who joined the team after the vault
    // existed never received. Measured from their node: `vis=500`,
    // `join=403`, for sixty seconds, through explicit syncs of both groups.
    // The vault was restricted from where they stood, permanently. Born open
    // it is admitted in 1ms. See `createVault`.
    expect(argsOf(calls, 'createGroupInNamespace')).toEqual([
      'ns-1',
      { groupName: 'Bank logins', visibility: 'open' },
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

  it('FAILS if the vault cannot be opened to team members', async () => {
    // Not swallowed, unlike the namespace-root call: a restricted vault
    // silently cannot be joined by the people invited to the team, so this has
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

describe('listTeams / listVaults', () => {
  it('names a team from the listing, falling back to its metadata record', async () => {
    const { admin } = fakeAdmin({
      listNamespacesForApplication: () =>
        Promise.resolve([
          { namespaceId: 'a', name: 'Acme', memberCount: 2, subgroupCount: 1 },
          { namespaceId: 'b', name: '', memberCount: 1, subgroupCount: 0 },
        ]),
      getGroupMetadata: () => Promise.resolve({ name: 'From metadata' }),
    });
    const rows = await listTeams(admin, 'app-1');
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
      restricted: false,
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
  it("mints a team code carrying the team's NAME", async () => {
    const { admin } = fakeAdmin();
    const code = await mintTeamInvite(admin, {
      namespaceId: 'ns-1',
      teamName: 'Acme Ltd',
    });
    const decoded = decodeInvite(code)!;
    expect(decoded.kind).toBe('namespace');
    // The name is what the recipient is shown before they accept. Without it
    // the prompt reads "You have been invited to a team".
    expect(decoded.groupAlias).toBe('Acme Ltd');
  });

  it('mints a vault code whose GRANT is still the namespace', async () => {
    const { admin, calls } = fakeAdmin();
    const code = await mintVaultInvite(admin, {
      namespaceId: 'ns-1',
      vaultId: 'sub-1',
      vaultName: 'Bank logins',
      teamName: 'Acme Ltd',
      contextId: 'ctx-1',
    });
    // An OPEN vault's access is inherited, so there is no narrower invitation
    // to mint — the node is asked for a NAMESPACE invitation, with the default
    // one-day lifetime.
    expect(argsOf(calls, 'createNamespaceInvitation')).toEqual([
      'ns-1',
      { expirationTimestamp: DEFAULT_INVITE_SECS },
    ]);
    expect(calls.some((c) => c.method === 'createGroupInvitation')).toBe(false);
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
      mintTeamInvite(admin, { namespaceId: 'ns-1' }),
    ).rejects.toThrow(/signature/i);
  });

  it('never passes an invitee key', async () => {
    // It is silently ignored by the node and misleads the next reader into
    // thinking the code is scoped to one person.
    const { admin, calls } = fakeAdmin();
    await mintTeamInvite(admin, { namespaceId: 'ns-1', validForSecs: 3600 });
    expect(argsOf(calls, 'createNamespaceInvitation')).toEqual([
      'ns-1',
      { expirationTimestamp: 3600 },
    ]);
  });

  it('an invite-only vault code carries a team and a vault invitation, team first', async () => {
    const { admin, calls } = fakeAdmin();
    const code = await mintVaultInvite(admin, {
      namespaceId: 'ns-1',
      vaultId: 'sub-1',
      vaultName: 'Prod keys',
      contextId: 'ctx-1',
      restricted: true,
    });
    expect(argsOf(calls, 'createGroupInvitation')).toEqual([
      'sub-1',
      { expirationTimestamp: DEFAULT_INVITE_SECS },
    ]);
    const decoded = decodeInvite(code)!;
    expect(decoded.chain?.map((c) => [c.kind, c.groupId])).toEqual([
      ['namespace', 'ns-1'],
      ['vault', 'sub-1'],
    ]);
  });
});

describe('invite-only vaults and removal', () => {
  it('creates an invite-only vault RESTRICTED at birth and never opens it', async () => {
    const { admin, calls } = fakeAdmin();
    await createVault(admin, {
      applicationId: 'app',
      namespaceId: 'ns-1',
      name: 'Prod keys',
      restricted: true,
    });
    expect(argsOf(calls, 'createGroupInNamespace')?.[1]).toMatchObject({
      visibility: 'restricted',
    });
    const vis = calls
      .filter((c) => c.method === 'setSubgroupVisibility')
      .map(
        (c) => (c.args[1] as { subgroupVisibility: string }).subgroupVisibility,
      );
    expect(vis).toEqual(['restricted']);
  });

  it('reads the audience from the vault when it is invite-only, else the team', async () => {
    const listed: string[] = [];
    const { admin } = fakeAdmin({
      getSubgroupVisibility: () => Promise.resolve('restricted'),
      listGroupMembers: (id: string) => {
        listed.push(id);
        return Promise.resolve({ members: [{ identity: 'acct-a' }] });
      },
    });
    const who = await vaultAudience(admin, {
      namespaceId: 'ns-1',
      vaultId: 'sub-1',
    });
    expect(listed).toEqual(['sub-1']);
    expect([...(who ?? [])]).toEqual(['acct-a']);
  });

  it('answers null rather than guessing when the node cannot say', async () => {
    const { admin } = fakeAdmin({
      getSubgroupVisibility: () => Promise.reject(new Error('down')),
    });
    expect(
      await vaultAudience(admin, { namespaceId: 'ns-1', vaultId: 'sub-1' }),
    ).toBeNull();
  });

  it('removes a member by ACCOUNT', async () => {
    const calls: unknown[][] = [];
    const { admin } = fakeAdmin({
      removeGroupMembers: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve();
      },
    });
    await removeTeamMember(admin, { namespaceId: 'ns-1', accountId: 'acct-b' });
    expect(calls).toEqual([['ns-1', { members: ['acct-b'] }]]);
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

describe('createTeam no longer makes every invitee an admin', () => {
  it('sets the DEFAULT capabilities to the Member set, not 15', async () => {
    const { admin, calls } = fakeAdmin();
    await createTeam(admin, { applicationId: 'app-1', name: 'Acme' });
    expect(argsOf(calls, 'setDefaultCapabilities')).toEqual([
      'ns-1',
      { defaultCapabilities: MEMBER_CAPABILITIES },
    ]);
    // Regression guard with the old value written out, because the bug was
    // invisible: 15 includes MANAGE_MEMBERS, so everyone invited to a password
    // vault could demote the person who created it.
    expect(MEMBER_CAPABILITIES).not.toBe(15);
  });
});

describe('listTeamMembers', () => {
  it('reads the ROLE and the real capability mask for every member', async () => {
    const { admin } = fakeAdmin({
      listGroupMembers: () =>
        Promise.resolve({
          members: [
            { identity: 'acct-alice', role: 'Owner', name: 'Alice' },
            { identity: 'acct-bob', role: 'Member', name: 'Bob' },
          ],
        }),
      getMemberCapabilities: (_g: string, id: string) =>
        Promise.resolve({
          capabilities:
            id === 'acct-alice' ? ADMIN_CAPABILITIES : MEMBER_CAPABILITIES,
        }),
    });

    const rows = await listTeamMembers(admin, 'ns-1', 'acct-bob');
    expect(rows).toEqual([
      {
        accountId: 'acct-alice',
        name: 'Alice',
        // The namespace owner is an admin — never a plain member of the team
        // they created.
        role: 'admin',
        rawRole: 'Owner',
        capabilities: ADMIN_CAPABILITIES,
        isSelf: false,
      },
      {
        accountId: 'acct-bob',
        name: 'Bob',
        role: 'member',
        rawRole: 'Member',
        capabilities: MEMBER_CAPABILITIES,
        // Located by ACCOUNT, which is what `listGroupMembers` rows are keyed
        // by and what `useNodeIdentity().identity.accountId` returns.
        isSelf: true,
      },
    ]);
  });

  it('degrades one row to a null mask rather than emptying the list', async () => {
    const { admin } = fakeAdmin({
      listGroupMembers: () =>
        Promise.resolve({ members: [{ identity: 'a', role: 'Member' }] }),
      getMemberCapabilities: () => Promise.reject(new Error('not here yet')),
    });
    const [row] = await listTeamMembers(admin, 'ns-1', null);
    expect(row.capabilities).toBeNull();
    expect(row.name).toBe('Member a…');
  });
});

describe('setMemberRole', () => {
  it('writes the role AND the capabilities, in that order', async () => {
    // ⚠️ The bug this exists to prevent: `updateMemberRole` sets a STRING.
    // Writing only that produces a roster saying "Admin" beside a person every
    // admin endpoint refuses — the UI and the node disagreeing, with the UI
    // looking correct.
    const { admin, calls } = fakeAdmin();
    await setMemberRole(admin, {
      namespaceId: 'ns-1',
      accountId: 'acct-bob',
      role: 'admin',
    });

    expect(argsOf(calls, 'updateMemberRole')).toEqual([
      'ns-1',
      'acct-bob',
      { role: 'Admin' },
    ]);
    expect(argsOf(calls, 'setMemberCapabilities')).toEqual([
      'ns-1',
      'acct-bob',
      { capabilities: ADMIN_CAPABILITIES },
    ]);
    const order = methodsOf(calls);
    expect(order.indexOf('updateMemberRole')).toBeLessThan(
      order.indexOf('setMemberCapabilities'),
    );
  });

  it('READS THE MASK BACK and reports that the change took effect', async () => {
    const { admin, calls } = fakeAdmin();
    const result = await setMemberRole(admin, {
      namespaceId: 'ns-1',
      accountId: 'acct-bob',
      role: 'admin',
    });
    expect(methodsOf(calls)).toContain('getMemberCapabilities');
    expect(result.effective).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.capabilities).toBe(ADMIN_CAPABILITIES);
  });

  it('names the bits a promotion is still short of, rather than claiming success', async () => {
    // A grant is published as an op and PROJECTED a moment later, so a mask
    // read right after a promotion can legitimately be incomplete. The honest
    // answer is which bits are missing.
    const { admin } = fakeAdmin({
      getMemberCapabilities: () =>
        Promise.resolve({
          capabilities: ADMIN_CAPABILITIES & ~CAPABILITIES.MANAGE_MEMBERS,
        }),
    });
    const result = await setMemberRole(admin, {
      namespaceId: 'ns-1',
      accountId: 'acct-bob',
      role: 'admin',
    });
    expect(result.effective).toBe(false);
    expect(result.missing).toEqual(['MANAGE_MEMBERS']);
  });

  it('demotes by writing the Member mask', async () => {
    const { admin, calls } = fakeAdmin({
      getMemberCapabilities: () =>
        Promise.resolve({ capabilities: MEMBER_CAPABILITIES }),
    });
    const result = await setMemberRole(admin, {
      namespaceId: 'ns-1',
      accountId: 'acct-bob',
      role: 'member',
    });
    expect(argsOf(calls, 'updateMemberRole')).toEqual([
      'ns-1',
      'acct-bob',
      { role: 'Member' },
    ]);
    expect(argsOf(calls, 'setMemberCapabilities')).toEqual([
      'ns-1',
      'acct-bob',
      { capabilities: MEMBER_CAPABILITIES },
    ]);
    expect(result.effective).toBe(true);
  });

  it('DOES NOT swallow a failed capability write', async () => {
    // Swallowing it is how you get the role-without-capabilities row. The
    // caller has to hear about it rather than show a promotion that did
    // nothing.
    const { admin } = fakeAdmin({
      setMemberCapabilities: () => Promise.reject(new Error('refused')),
    });
    await expect(
      setMemberRole(admin, {
        namespaceId: 'ns-1',
        accountId: 'acct-bob',
        role: 'admin',
      }),
    ).rejects.toThrow('refused');
  });

  it('reports an unreadable mask as "nothing applied", not as success', async () => {
    const { admin } = fakeAdmin({
      getMemberCapabilities: () => Promise.reject(new Error('unreachable')),
    });
    const result = await setMemberRole(admin, {
      namespaceId: 'ns-1',
      accountId: 'acct-bob',
      role: 'admin',
    });
    expect(result.capabilities).toBeNull();
    expect(result.effective).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });
});

describe('myCapabilities', () => {
  it('answers null rather than 0 when the node cannot be asked', async () => {
    // 0 would read as "definitely no permissions" and is indistinguishable
    // from a real answer; null lets the UI say "unknown" and keep its gates
    // closed without asserting the member has nothing.
    const { admin } = fakeAdmin({
      getMemberCapabilities: () => Promise.reject(new Error('offline')),
    });
    expect(await myCapabilities(admin, 'ns-1', 'acct-a')).toBeNull();
  });
});

// ── The personal vault ──────────────────────────────────────────────────────
//
// These assert the four properties that make a vault private, INDIVIDUALLY.
// A single "it is private" test passes as long as one of them holds, and the
// failure mode here is silent: a personal vault built like a team looks
// identical on screen and is readable by anyone who joins the namespace.

describe('createPersonalVault', () => {
  it('never opens the namespace root, the way a team does', async () => {
    const { admin, calls } = fakeAdmin();
    await createPersonalVault(admin as unknown as AdminLike, {
      applicationId: 'app-1',
    });

    // `createTeam` calls this with the NAMESPACE id to let invitees reach its
    // vaults by inheritance. Its absence is what leaves nobody a way in.
    const visibilityTargets = calls
      .filter((c) => c.method === 'setSubgroupVisibility')
      .map((c) => c.args[0]);
    expect(visibilityTargets).not.toContain('ns-1');
  });

  it('makes the subgroup restricted, explicitly', async () => {
    const { admin, calls } = fakeAdmin();
    await createPersonalVault(admin as unknown as AdminLike, {
      applicationId: 'app-1',
    });
    expect(argsOf(calls, 'setSubgroupVisibility')).toEqual([
      'sub-1',
      { subgroupVisibility: 'restricted' },
    ]);
  });

  it('grants an arriving member nothing', async () => {
    const { admin, calls } = fakeAdmin();
    await createPersonalVault(admin as unknown as AdminLike, {
      applicationId: 'app-1',
    });
    expect(argsOf(calls, 'setDefaultCapabilities')).toEqual([
      'ns-1',
      { defaultCapabilities: 0 },
    ]);
  });

  it('writes the marker and the name in ONE record', async () => {
    const { admin, calls } = fakeAdmin();
    await createPersonalVault(admin as unknown as AdminLike, {
      applicationId: 'app-1',
      name: 'Personal',
    });
    // Metadata writes REPLACE the record, so a name written without the marker
    // (or a marker written without the name) loses the other one. The first
    // write is the namespace's and must carry both.
    const first = calls.find(
      (c) => c.method === 'setGroupMetadata' && c.args[0] === 'ns-1',
    );
    expect(first?.args[1]).toEqual({
      name: 'Personal',
      data: { kind: 'personal' },
    });
  });

  it('fails rather than shipping a vault that is not private', async () => {
    const { admin } = fakeAdmin({
      setSubgroupVisibility: () => Promise.reject(new Error('nope')),
    });
    await expect(
      createPersonalVault(admin as unknown as AdminLike, {
        applicationId: 'app-1',
      }),
    ).rejects.toThrow('nope');
  });
});

describe('a personal vault cannot be invited into', () => {
  const personal = { name: 'Personal', data: { kind: 'personal' } };

  it('refuses a team invite', async () => {
    const { admin, calls } = fakeAdmin({
      getGroupMetadata: () => Promise.resolve(personal),
    });
    await expect(
      mintTeamInvite(admin as unknown as AdminLike, { namespaceId: 'ns-1' }),
    ).rejects.toThrow('private vault');
    // The point is that nothing was MINTED, not merely that it threw.
    expect(methodsOf(calls)).not.toContain('createNamespaceInvitation');
  });

  it('refuses a vault invite', async () => {
    const { admin, calls } = fakeAdmin({
      getGroupMetadata: () => Promise.resolve(personal),
    });
    await expect(
      mintVaultInvite(admin as unknown as AdminLike, {
        namespaceId: 'ns-1',
        vaultId: 'sub-1',
      }),
    ).rejects.toThrow('private vault');
    expect(methodsOf(calls)).not.toContain('createNamespaceInvitation');
  });

  it('refuses when it cannot tell, rather than minting anyway', async () => {
    const { admin, calls } = fakeAdmin({
      getGroupMetadata: () => Promise.reject(new Error('node down')),
    });
    await expect(
      mintTeamInvite(admin as unknown as AdminLike, { namespaceId: 'ns-1' }),
    ).rejects.toThrow('Could not confirm');
    expect(methodsOf(calls)).not.toContain('createNamespaceInvitation');
  });

  it('still mints for an ordinary team', async () => {
    const { admin } = fakeAdmin({
      getGroupMetadata: () => Promise.resolve({ name: 'Acme', data: {} }),
    });
    await expect(
      mintTeamInvite(admin as unknown as AdminLike, { namespaceId: 'ns-1' }),
    ).resolves.toBeTruthy();
  });
});

describe('isPersonalRecord', () => {
  it('is false for a team, a bare record and nothing at all', () => {
    expect(isPersonalRecord(null)).toBe(false);
    expect(isPersonalRecord({ data: {} })).toBe(false);
    expect(isPersonalRecord({ data: { kind: 'team' } })).toBe(false);
  });

  it('is true only for the exact marker', () => {
    expect(isPersonalRecord({ data: { kind: 'personal' } })).toBe(true);
  });
});

describe('listTeams', () => {
  it('reports a namespace as personal from its record, not its size', async () => {
    const { admin } = fakeAdmin({
      listNamespacesForApplication: () =>
        Promise.resolve([
          { namespaceId: 'ns-p', name: 'Personal', memberCount: 1 },
          { namespaceId: 'ns-t', name: 'Acme', memberCount: 1 },
        ]),
      getGroupMetadata: (id: string) =>
        Promise.resolve(
          id === 'ns-p'
            ? { name: 'Personal', data: { kind: 'personal' } }
            : { name: 'Acme', data: {} },
        ),
    });
    const rows = await listTeams(admin as unknown as AdminLike, 'app-1');
    // Both have ONE member. Only the marked one is private.
    expect(rows.map((r) => [r.namespaceId, r.personal])).toEqual([
      ['ns-p', true],
      ['ns-t', false],
    ]);
  });
});

// ── The creator is an Admin of the team they just made ──────────────────────
//
// The bug: `createTeam` set the team's DEFAULT capabilities to Member and
// granted the creator nothing, so `getMemberCapabilities(ns, me)` — which every
// gate in this app asks — returned the Member mask. You made a team and it told
// you only an Admin could put a vault in it, with no Admin in existence.

describe('createTeam grants the creator Admin', () => {
  it('sets the creator mask to ADMIN_CAPABILITIES', async () => {
    const { admin, calls } = fakeAdmin({
      getMemberCapabilities: () =>
        Promise.resolve({ capabilities: ADMIN_CAPABILITIES }),
    });
    await createTeam(admin as unknown as AdminLike, {
      applicationId: 'app-1',
      name: 'Acme',
      accountId: 'a'.repeat(64),
    });
    expect(argsOf(calls, 'setMemberCapabilities')).toEqual([
      'ns-1',
      'a'.repeat(64),
      { capabilities: ADMIN_CAPABILITIES },
    ]);
  });

  it('grants the creator MORE than the team default, or they cannot make a vault', async () => {
    const { admin, calls } = fakeAdmin({
      getMemberCapabilities: () =>
        Promise.resolve({ capabilities: ADMIN_CAPABILITIES }),
    });
    await createTeam(admin as unknown as AdminLike, {
      applicationId: 'app-1',
      name: 'Acme',
      accountId: 'a'.repeat(64),
    });
    const mine = (
      argsOf(calls, 'setMemberCapabilities') as [
        string,
        string,
        { capabilities: number },
      ]
    )[2].capabilities;
    const theirs = (
      argsOf(calls, 'setDefaultCapabilities') as [
        string,
        { defaultCapabilities: number },
      ]
    )[1].defaultCapabilities;
    // This is the assertion that names the bug: the creator's mask and the
    // invited-member default were the SAME value, and that value cannot create
    // a vault.
    expect(mine).not.toBe(theirs);
    expect(canCreateVault(mine)).toBe(true);
    expect(canCreateVault(theirs)).toBe(false);
  });

  it('fails when the node reports the grant did not land', async () => {
    // 200 on the write, old mask on the read — the exact shape `lib/roles`
    // warns about, and one a write-only assertion cannot see.
    const { admin } = fakeAdmin({
      getMemberCapabilities: () =>
        Promise.resolve({ capabilities: MEMBER_CAPABILITIES }),
    });
    await expect(
      createTeam(admin as unknown as AdminLike, {
        applicationId: 'app-1',
        name: 'Acme',
        accountId: 'a'.repeat(64),
      }),
    ).rejects.toThrow('did not apply it');
  });
});

describe('repairCreatorAdmin', () => {
  const CREATOR = 'a'.repeat(64);
  const MEMBER = 'b'.repeat(64);
  /** The roster the node answers with: the creator is Admin BY ROLE. */
  const roster = {
    members: [
      { identity: CREATOR, role: 'Admin' },
      { identity: MEMBER, role: 'Member' },
    ],
  };

  it('raises a stranded creator and reports the new mask', async () => {
    const { admin, calls } = fakeAdmin({
      listGroupMembers: () => Promise.resolve(roster),
      getMemberCapabilities: () =>
        Promise.resolve({ capabilities: ADMIN_CAPABILITIES }),
    });
    const after = await repairCreatorAdmin(
      admin as unknown as AdminLike,
      'ns-1',
      CREATOR,
      MEMBER_CAPABILITIES,
    );
    expect(after).toBe(ADMIN_CAPABILITIES);
    expect(methodsOf(calls)).toContain('setMemberCapabilities');
  });

  // ⚠️ THE REPORTED BUG. This ran on every team-page load for every member,
  // and an invited member's mask is Member by design and never rises — so the
  // write could never succeed and was retried forever. The node refused it
  // correctly, with an HTTP 403 naming the account and the group, and the
  // catch swallowed it: the UI said nothing while the network tab filled with
  // 403s that read as a broken app.
  //
  // ROLE is the deciding question because role is what core's
  // `require_namespace_admin` checks; the mask is a different field, which is
  // exactly why a creator can be Admin-by-role and Member-by-mask at once.
  it('asks NOTHING of the node for a plain Member', async () => {
    const { admin, calls } = fakeAdmin({
      listGroupMembers: () => Promise.resolve(roster),
    });
    const after = await repairCreatorAdmin(
      admin as unknown as AdminLike,
      'ns-1',
      MEMBER,
      MEMBER_CAPABILITIES,
    );
    expect(after).toBeNull();
    expect(methodsOf(calls)).not.toContain('setMemberCapabilities');
  });

  it('asks nothing when the roster cannot be read, rather than guessing', async () => {
    const { admin, calls } = fakeAdmin({
      listGroupMembers: () => Promise.reject(new Error('not synced yet')),
    });
    const after = await repairCreatorAdmin(
      admin as unknown as AdminLike,
      'ns-1',
      CREATOR,
      MEMBER_CAPABILITIES,
    );
    expect(after).toBeNull();
    expect(methodsOf(calls)).not.toContain('setMemberCapabilities');
  });

  it('does nothing when the caller is already an Admin', async () => {
    const { admin, calls } = fakeAdmin();
    const after = await repairCreatorAdmin(
      admin as unknown as AdminLike,
      'ns-1',
      'a'.repeat(64),
      ADMIN_CAPABILITIES,
    );
    expect(after).toBeNull();
    // No pointless write on every visit to every team.
    expect(methodsOf(calls)).not.toContain('setMemberCapabilities');
  });

  it('still swallows a refusal, for the Admin whose write races a demotion', async () => {
    // Narrower than it was: the roster says Admin, so the attempt is
    // legitimate — but authority can change between the read and the write,
    // and a refusal there is not an error worth a toast on a screen the
    // person can legitimately open.
    const { admin } = fakeAdmin({
      listGroupMembers: () => Promise.resolve(roster),
      setMemberCapabilities: () => Promise.reject(new Error('403 forbidden')),
    });
    await expect(
      repairCreatorAdmin(
        admin as unknown as AdminLike,
        'ns-1',
        CREATOR,
        MEMBER_CAPABILITIES,
      ),
    ).resolves.toBeNull();
  });
});

// ── rc.41: the namespace default mask is load-bearing ───────────────────────
//
// 0.11.0-rc.41 seeds a new namespace root with
// `CAN_JOIN_OPEN_SUBGROUPS | CAN_AUTHOR_ON_BEHALF` (core's
// `initial_default_capabilities`, #3969) and publishes it as a governance op so
// it replicates to every peer (#3974). `CAN_AUTHOR_ON_BEHALF` is "write as
// somebody else, under a warrant they signed" — and `lib/roles` lists it in
// DELIBERATELY_UNGRANTED, because a password manager must not hand out the
// capability to publish writes attributed to another person.
//
// This app overwrites that seed immediately. These assert the two halves of
// that being TRUE rather than merely attempted.

describe('the rc.41 default mask', () => {
  it('a team never hands an invitee CAN_AUTHOR_ON_BEHALF', async () => {
    const { admin, calls } = fakeAdmin({
      getMemberCapabilities: () =>
        Promise.resolve({ capabilities: ADMIN_CAPABILITIES }),
    });
    await createTeam(admin as unknown as AdminLike, {
      applicationId: 'app-1',
      name: 'Acme',
      accountId: 'a'.repeat(64),
    });
    const sent = (
      argsOf(calls, 'setDefaultCapabilities') as [
        string,
        { defaultCapabilities: number },
      ]
    )[1].defaultCapabilities;
    expect(sent & CAPABILITIES.CAN_AUTHOR_ON_BEHALF).toBe(0);
    expect(sent).toBe(MEMBER_CAPABILITIES);
  });

  it('a private vault grants an arriving member nothing at all', async () => {
    const { admin, calls } = fakeAdmin();
    await createPersonalVault(admin as unknown as AdminLike, {
      applicationId: 'app-1',
    });
    const sent = (
      argsOf(calls, 'setDefaultCapabilities') as [
        string,
        { defaultCapabilities: number },
      ]
    )[1].defaultCapabilities;
    expect(sent).toBe(0);
  });

  it('a node that refuses the write fails createTeam', async () => {
    // Was `.catch(() => {})`. At rc.41 swallowing it leaves every invited
    // member holding CAN_AUTHOR_ON_BEHALF, reported nowhere.
    const { admin } = fakeAdmin({
      setDefaultCapabilities: () => Promise.reject(new Error('503')),
    });
    await expect(
      createTeam(admin as unknown as AdminLike, {
        applicationId: 'app-1',
        name: 'Acme',
        accountId: 'a'.repeat(64),
      }),
    ).rejects.toThrow('503');
  });

  it('a node that refuses the write fails createPersonalVault', async () => {
    const { admin } = fakeAdmin({
      setDefaultCapabilities: () => Promise.reject(new Error('503')),
    });
    await expect(
      createPersonalVault(admin as unknown as AdminLike, {
        applicationId: 'app-1',
      }),
    ).rejects.toThrow('503');
  });
});

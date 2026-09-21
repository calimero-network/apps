import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAPABILITIES } from '@calimero-network/mero-js';

import {
  ADMIN_CAPABILITIES,
  MEMBER_CAPABILITIES,
  PERSONAL_KIND,
  createAgreement,
  createPersonalContext,
  createWorkspace,
  displayName,
  ensurePersonalWorkspace,
  initParamsFor,
  isPersonalRecord,
  listAgreements,
  listWorkspaces,
  pickInvitedAgreement,
  type AdminLike,
} from './agreements';

/** Records every admin call, so order and arguments can be asserted. */
function fakeAdmin(over: Record<string, (...a: never[]) => unknown> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const rec =
    (method: string, impl?: (...a: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      const run = (over[method] ?? impl) as
        | ((...a: unknown[]) => unknown)
        | undefined;
      // `.then` rather than a direct call, so an override that throws produces
      // a REJECTED PROMISE. A synchronous throw skips `.catch()` at the call
      // site, which would make a "this must be fatal" test pass against code
      // that swallows.
      return Promise.resolve().then(() => (run ? run(...args) : undefined));
    };
  return {
    calls,
    admin: {
      createNamespace: rec('createNamespace', () => ({ namespaceId: 'ns-1' })),
      setGroupMetadata: rec('setGroupMetadata'),
      setDefaultCapabilities: rec('setDefaultCapabilities'),
      setMemberCapabilities: rec('setMemberCapabilities'),
      getMemberCapabilities: rec('getMemberCapabilities', () => ({
        capabilities: ADMIN_CAPABILITIES,
      })),
      setSubgroupVisibility: rec('setSubgroupVisibility'),
      createGroupInNamespace: rec('createGroupInNamespace', () => ({
        groupId: 'sg-1',
      })),
      createContext: rec('createContext', () => ({
        contextId: 'ctx-1',
        memberPublicKey: 'pk-1',
      })),
      listNamespacesForApplication: rec(
        'listNamespacesForApplication',
        () => [],
      ),
      listNamespaceGroups: rec('listNamespaceGroups', () => []),
      listGroupContexts: rec('listGroupContexts', () => []),
      listGroupMembers: rec('listGroupMembers', () => ({ members: [] })),
      getGroupMetadata: rec('getGroupMetadata', () => null),
      getContextIdentitiesOwned: rec('getContextIdentitiesOwned', () => ({
        identities: [],
      })),
    } as unknown as AdminLike,
  };
}

const argsOf = (calls: { method: string; args: unknown[] }[], m: string) =>
  calls.find((c) => c.method === m)?.args;
const methodsOf = (calls: { method: string }[]) => calls.map((c) => c.method);

// ── `init`'s arity, read off the COMMITTED ABI ──────────────────────────────
//
// This fleet has shipped `init: takes no arguments, but the call sent unknown
// field(s): ["name"]` to production twice — a guest PANIC surfacing as HTTP
// 400, because `initializationParams` is opaque bytes the node forwards
// without inspecting. Nothing between the frontend and the guest checks the
// shape, so the ABI is the only source of truth and this test is the only
// place that reads it.

describe("init's parameters match the contract", () => {
  const abi = JSON.parse(
    readFileSync(resolve(process.cwd(), '../logic/res/abi.json'), 'utf8'),
  ) as { methods: { name: string; params?: { name: string }[] }[] };

  it('the ABI really is loaded (guard against a vacuous pass)', () => {
    // Without this, a renamed file or an empty read makes every assertion
    // below pass against nothing.
    expect(abi.methods.length).toBeGreaterThan(5);
    expect(abi.methods.map((m) => m.name)).toContain('sign_document');
  });

  it('sends exactly the parameters init declares, by name', () => {
    const init = abi.methods.find((m) => m.name === 'init');
    expect(init).toBeDefined();
    const declared = (init!.params ?? []).map((p) => p.name);
    const sent = Object.keys(
      JSON.parse(
        new TextDecoder().decode(new Uint8Array(initParamsFor('Q3 NDA'))),
      ),
    );
    // The KEY SET, not "contains" — a surplus key is as fatal as a missing one.
    expect(sent.sort()).toEqual(declared.sort());
  });

  it('carries the name the creator typed, and defaults to shared', () => {
    const sent = JSON.parse(
      new TextDecoder().decode(new Uint8Array(initParamsFor('Q3 NDA'))),
    );
    expect(sent.context_name).toBe('Q3 NDA');
    expect(sent.is_private).toBe(false);
  });
});

describe('createWorkspace', () => {
  it('names the workspace on the wire, not just locally', async () => {
    const { admin, calls } = fakeAdmin();
    await createWorkspace(admin, { applicationId: 'app-1', name: 'Acme' });
    expect(argsOf(calls, 'createNamespace')).toEqual([
      { applicationId: 'app-1', name: 'Acme' },
    ]);
  });

  it('never hands an invited signer CAN_AUTHOR_ON_BEHALF', async () => {
    const { admin, calls } = fakeAdmin();
    await createWorkspace(admin, { applicationId: 'app-1', name: 'Acme' });
    const sent = (
      argsOf(calls, 'setDefaultCapabilities') as [
        string,
        { defaultCapabilities: number },
      ]
    )[1].defaultCapabilities;
    // rc.41 seeds the namespace with this bit. In a signing app it is the one
    // capability that must never arrive by default.
    expect(sent & CAPABILITIES.CAN_AUTHOR_ON_BEHALF).toBe(0);
    expect(sent).toBe(MEMBER_CAPABILITIES);
  });

  it('fails when the node refuses to lower the default mask', async () => {
    const { admin } = fakeAdmin({
      setDefaultCapabilities: () => Promise.reject(new Error('503')),
    });
    await expect(
      createWorkspace(admin, { applicationId: 'app-1', name: 'Acme' }),
    ).rejects.toThrow('503');
  });

  it('makes the creator an admin, and verifies it landed', async () => {
    const { admin, calls } = fakeAdmin();
    await createWorkspace(admin, {
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

  it('fails when the node reports the grant did not apply', async () => {
    // 200 on the write, old mask on the read — a role and a capability mask are
    // different server fields, and a write-only assertion cannot see this.
    const { admin } = fakeAdmin({
      getMemberCapabilities: () =>
        Promise.resolve({ capabilities: MEMBER_CAPABILITIES }),
    });
    await expect(
      createWorkspace(admin, {
        applicationId: 'app-1',
        name: 'Acme',
        accountId: 'a'.repeat(64),
      }),
    ).rejects.toThrow('did not apply it');
  });
});

describe('createAgreement', () => {
  it('binds the context to the SUBGROUP — the binding rc.41 requires', async () => {
    const { admin, calls } = fakeAdmin();
    await createAgreement(admin, {
      applicationId: 'app-1',
      namespaceId: 'ns-1',
      name: 'Q3 NDA',
    });
    const [req] = argsOf(calls, 'createContext') as [
      {
        applicationId: string;
        groupId: string;
        initializationParams: number[];
      },
    ];
    // The whole reason this file exists: the old path sent no group at all and
    // core's CreateContextRequest declares `group_id` with no Option.
    expect(req.groupId).toBe('sg-1');
    expect(req.applicationId).toBe('app-1');
  });

  it('sends the agreement name into the contract', async () => {
    const { admin, calls } = fakeAdmin();
    await createAgreement(admin, {
      applicationId: 'app-1',
      namespaceId: 'ns-1',
      name: 'Q3 NDA',
    });
    const [req] = argsOf(calls, 'createContext') as [
      { initializationParams: number[] },
    ];
    const sent = JSON.parse(
      new TextDecoder().decode(new Uint8Array(req.initializationParams)),
    );
    expect(sent.context_name).toBe('Q3 NDA');
  });

  it('uses groupName, the spelling the node accepts', async () => {
    const { admin, calls } = fakeAdmin();
    await createAgreement(admin, {
      applicationId: 'app-1',
      namespaceId: 'ns-1',
      name: 'Q3 NDA',
    });
    // `name` here is a 400 for the whole call — the bodies are closed sets.
    // `visibility` goes with it: a subgroup created without one is born
    // RESTRICTED, and until the `setSubgroupVisibility` below lands an invited
    // signer who tries to enter is refused.
    expect(argsOf(calls, 'createGroupInNamespace')).toEqual([
      'ns-1',
      { groupName: 'Q3 NDA', visibility: 'open' },
    ]);
  });

  it('opens the agreement, lowercase, before creating its context', async () => {
    const { admin, calls } = fakeAdmin();
    await createAgreement(admin, {
      applicationId: 'app-1',
      namespaceId: 'ns-1',
      name: 'Q3 NDA',
    });
    expect(argsOf(calls, 'setSubgroupVisibility')).toEqual([
      'sg-1',
      { subgroupVisibility: 'open' },
    ]);
    const order = methodsOf(calls);
    // Order matters: a context created under a still-restricted subgroup is
    // reachable by nobody who was invited.
    expect(order.indexOf('setSubgroupVisibility')).toBeLessThan(
      order.indexOf('createContext'),
    );
  });

  it('fails rather than shipping an agreement nobody invited can open', async () => {
    const { admin } = fakeAdmin({
      setSubgroupVisibility: () => Promise.reject(new Error('nope')),
    });
    await expect(
      createAgreement(admin, {
        applicationId: 'app-1',
        namespaceId: 'ns-1',
        name: 'Q3 NDA',
      }),
    ).rejects.toThrow('nope');
  });
});

describe('listing', () => {
  it('falls back to the metadata name, then to a short id', async () => {
    const { admin } = fakeAdmin({
      listNamespacesForApplication: () =>
        Promise.resolve([
          { namespaceId: 'n'.repeat(44), memberCount: 2, subgroupCount: 1 },
        ]),
      getGroupMetadata: () => Promise.resolve({ name: 'From metadata' }),
    });
    const rows = await listWorkspaces(admin, 'app-1');
    expect(rows[0].name).toBe('From metadata');
  });

  it('marks an agreement whose context has not replicated yet', async () => {
    const { admin } = fakeAdmin({
      listNamespaceGroups: () => Promise.resolve([{ groupId: 'sg-1' }]),
      listGroupContexts: () => Promise.resolve([]),
    });
    const [row] = await listAgreements(admin, 'ns-1');
    // The normal state right after joining — not an error, and the UI must be
    // able to tell it apart from "you are not a member".
    expect(row.contextId).toBeNull();
    expect(row.joined).toBe(false);
  });
});

describe('displayName', () => {
  it('never returns an empty label', () => {
    expect(displayName([null, '  '], 'abcdef1234', 'Agreement')).toBe(
      'Agreement abcdef12…',
    );
  });
});

// ── The personal workspace ──────────────────────────────────────────────────
//
// The private context is the signature library. rc.41 needs a group for it
// like any other context, and getting that wrong is not loud: a second
// personal namespace means a second, EMPTY signature library, and the app
// reports nothing at all.

describe('ensurePersonalWorkspace', () => {
  it('reuses the namespace carrying the marker', async () => {
    const { admin, calls } = fakeAdmin({
      listNamespacesForApplication: () => [
        { namespaceId: 'ns-work', memberCount: 3, subgroupCount: 2 },
        { namespaceId: 'ns-mine', memberCount: 1, subgroupCount: 1 },
      ],
      getGroupMetadata: (id: unknown) =>
        id === 'ns-mine'
          ? { name: 'Personal', data: { kind: PERSONAL_KIND } }
          : { name: 'Acme', data: {} },
    });

    expect(await ensurePersonalWorkspace(admin, 'app-1')).toBe('ns-mine');
    // The point of the marker: no second namespace, ever.
    expect(methodsOf(calls)).not.toContain('createNamespace');
  });

  it('does not mistake a workspace NAMED "Personal" for the marked one', async () => {
    // A user can name a workspace anything. If identity turned on the name,
    // this workspace would become the private store and its members would be
    // handed somebody's signature library.
    const { admin, calls } = fakeAdmin({
      listNamespacesForApplication: () => [
        { namespaceId: 'ns-decoy', memberCount: 4, subgroupCount: 1 },
      ],
      getGroupMetadata: () => ({ name: 'Personal', data: {} }),
      createNamespace: () => ({ namespaceId: 'ns-new' }),
    });

    expect(await ensurePersonalWorkspace(admin, 'app-1')).toBe('ns-new');
    expect(methodsOf(calls)).toContain('createNamespace');
  });

  it('writes name and marker in ONE record, because the write replaces it', async () => {
    const { admin, calls } = fakeAdmin({
      createNamespace: () => ({ namespaceId: 'ns-new' }),
    });
    await ensurePersonalWorkspace(admin, 'app-1');
    // `setGroupMetadata` REPLACES the stored record — sending the name alone
    // would drop the marker that makes this namespace findable.
    expect(argsOf(calls, 'setGroupMetadata')).toEqual([
      'ns-new',
      { name: 'Personal', data: { kind: PERSONAL_KIND } },
    ]);
  });

  it('fails loudly when the marker cannot be written', async () => {
    // Swallowed, this returns a namespace nothing can find again: the next
    // call creates another, and the node grows a new empty signature library
    // on every boot.
    const { admin } = fakeAdmin({
      createNamespace: () => ({ namespaceId: 'ns-new' }),
      setGroupMetadata: () => {
        throw new Error('metadata refused');
      },
    });
    await expect(ensurePersonalWorkspace(admin, 'app-1')).rejects.toThrow(
      'metadata refused',
    );
  });
});

describe('isPersonalRecord', () => {
  it('is false for no record, an empty record and a workspace', () => {
    expect(isPersonalRecord(null)).toBe(false);
    expect(isPersonalRecord(undefined)).toBe(false);
    expect(isPersonalRecord({ data: {} })).toBe(false);
    expect(isPersonalRecord({ data: { kind: 'something-else' } })).toBe(false);
  });

  it('is true only for the marker', () => {
    expect(isPersonalRecord({ data: { kind: PERSONAL_KIND } })).toBe(true);
  });
});

describe('createPersonalContext', () => {
  it('leaves the subgroup RESTRICTED', async () => {
    // The one place in this app where restricted is the wanted answer: opening
    // it would make a node's private signature library reachable by anybody
    // admitted to the namespace.
    const { admin, calls } = fakeAdmin();
    await createPersonalContext(admin, {
      applicationId: 'app-1',
      namespaceId: 'ns-mine',
    });
    expect(methodsOf(calls)).not.toContain('setSubgroupVisibility');
    expect(argsOf(calls, 'createGroupInNamespace')).toEqual([
      'ns-mine',
      { groupName: 'Private' },
    ]);
  });

  it('binds the context to that subgroup and marks it private', async () => {
    const { admin, calls } = fakeAdmin();
    await createPersonalContext(admin, {
      applicationId: 'app-1',
      namespaceId: 'ns-mine',
      name: 'default',
    });
    const req = argsOf(calls, 'createContext')?.[0] as {
      groupId: string;
      applicationId: string;
      initializationParams: number[];
    };
    // ⚠️ `group_id` is what rc.41 added and has no default — this is the
    // binding the old path had nothing to put in.
    expect(req.groupId).toBe('sg-1');
    expect(req.applicationId).toBe('app-1');
    const init = JSON.parse(
      new TextDecoder().decode(new Uint8Array(req.initializationParams)),
    );
    expect(init).toEqual({ is_private: true, context_name: 'default' });
  });
});

describe('listWorkspaces', () => {
  it('hides the personal namespace, which is not a workspace', async () => {
    // It would otherwise appear as something to invite people into — and
    // inviting somebody into it shares the signature library.
    const { admin } = fakeAdmin({
      listNamespacesForApplication: () => [
        {
          namespaceId: 'ns-work',
          name: 'Acme',
          memberCount: 2,
          subgroupCount: 1,
        },
        {
          namespaceId: 'ns-mine',
          name: 'Personal',
          memberCount: 1,
          subgroupCount: 1,
        },
      ],
      getGroupMetadata: (id: unknown) =>
        id === 'ns-mine'
          ? { name: 'Personal', data: { kind: PERSONAL_KIND } }
          : null,
    });
    const rows = await listWorkspaces(admin, 'app-1');
    expect(rows.map((r) => r.namespaceId)).toEqual(['ns-work']);
  });
});

// ── Which agreement an invitation lands you in ──────────────────────────────
//
// An invitation grants the WORKSPACE. Landing somewhere sensible inside it is
// a separate decision, and the wrong answers are both bad: opening whichever
// agreement replicated first is arbitrary, and honouring an unverified hint
// lets an edited envelope choose.

describe('pickInvitedAgreement', () => {
  const a = { contextId: 'ctx-a' };
  const b = { contextId: 'ctx-b' };

  it('opens the only agreement there is', () => {
    expect(pickInvitedAgreement([a], undefined)).toBe(a);
  });

  it('returns null for an empty workspace, which is a normal thing to join', () => {
    // Invite the people first, draw up the document second.
    expect(pickInvitedAgreement([], undefined)).toBeNull();
  });

  it('refuses to guess between several', () => {
    expect(pickInvitedAgreement([a, b], undefined)).toBeNull();
  });

  it('honours a hint that names one of them', () => {
    expect(pickInvitedAgreement([a, b], 'ctx-b')).toBe(b);
  });

  it('IGNORES a hint naming an agreement outside the workspace', () => {
    // The hint rides outside the signature. Checking it against what the
    // workspace actually holds means an edited envelope can only ever choose
    // among agreements the invitation already granted.
    expect(pickInvitedAgreement([a, b], 'ctx-somewhere-else')).toBeNull();
  });

  it('skips an agreement that has not replicated a context yet', () => {
    const pending = { contextId: null };
    expect(pickInvitedAgreement([pending, a], undefined)).toBe(a);
  });
});

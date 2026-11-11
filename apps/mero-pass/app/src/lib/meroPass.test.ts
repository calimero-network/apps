import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CALLS, VIEWS, meroPass } from './meroPass';
import { vaultApiFor } from './vaultApi';
import { withRoutes } from '@calimero-apps/connect/testing';

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(
  readFileSync(resolve(__dirname, '../../../logic/res/abi.json'), 'utf8'),
) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

describe('the client covers the contract', () => {
  it('calls exactly the contract calls, and views exactly its views', () => {
    expect([...CALLS].sort()).toEqual(byKind('call'));
    expect([...VIEWS].sort()).toEqual(byKind('view'));
    expect(byKind('init')).toEqual(['init']);
  });

  it('sends each method the parameter names the ABI declares', async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      return Promise.resolve({ index: 1, result: null, events: [] });
    };
    const p = meroPass(
      withRoutes({ call: vi.fn(record), view: vi.fn(record) }),
      'app-1',
    );
    await Promise.all([
      p.vaultInfo(),
      p.vaultName(),
      p.renameVault('n'),
      p.listMembers(),
      p.setRole('a', 'editor'),
      p.removeMember('a'),
      p.setDefaultRole('viewer'),
      p.registerDevice('f', 'pk', 'l', 'browser'),
      p.listDevices(),
      p.revokeDevice('f'),
      p.addKeyWraps([]),
      p.keyWrapsFor('f'),
      p.wrappedPairs(),
      p.rotateKey('k'),
      p.addSecret('s', 'login', 'n', 't', {}),
      p.updateSecret('s', null, null, {}, false),
      p.secretHistory('s'),
      p.trashSecret('s'),
      p.restoreSecret('s'),
      p.purgeSecret('s'),
      p.getSecret('s'),
      p.listSecrets(),
      p.getAuditLogs(),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === 'init') continue;
      expect(sent.get(name), name).toEqual(
        method.params.map(([param]) => param).sort(),
      );
    }
  });
});

describe('vaultApiFor', () => {
  it('turns camelCase answers with decimal-string times into the vault core records', async () => {
    const view = vi.fn(async (_app: string, method: string) => {
      const results: Record<string, unknown> = {
        listSecrets: [
          {
            id: 'secret_1',
            kind: 'login',
            name: 'n',
            tags: 't',
            fields: { password: 'p' },
            createdAt: '1700000000000',
            createdBy: 'acct',
            updatedAt: '1700000000001',
            updatedBy: 'acct',
            trashed: false,
            trashedAt: '0',
          },
        ],
        vaultInfo: {
          name: 'V',
          currentKey: 'k1',
          defaultRole: 'editor',
          myAccount: 'acct',
          myRole: 'admin',
        },
        listDevices: [
          {
            fingerprint: 'f',
            publicKey: 'pk',
            label: 'l',
            kind: 'browser',
            account: 'acct',
            addedAt: '5',
            revoked: false,
          },
        ],
      };
      return { index: 1, result: results[method] };
    });
    const call = vi.fn(async () => ({ index: 1, result: 2, events: [] }));
    const api = vaultApiFor(meroPass(withRoutes({ call, view }), 'app'));

    expect(await api.listSecrets()).toEqual([
      {
        id: 'secret_1',
        kind: 'login',
        name: 'n',
        tags: 't',
        fields: { password: 'p' },
        created_at: 1700000000000,
        created_by: 'acct',
        updated_at: 1700000000001,
        updated_by: 'acct',
        trashed: false,
        trashed_at: 0,
      },
    ]);
    expect(await api.vaultInfo()).toEqual({
      name: 'V',
      current_key: 'k1',
      default_role: 'editor',
      my_account: 'acct',
      my_role: 'admin',
    });
    expect((await api.listDevices())[0]).toMatchObject({
      public_key: 'pk',
      added_at: 5,
    });

    expect(
      await api.addKeyWraps([
        { key_id: 'k', recipient: 'r', wrapper: 'w', envelope: 'e' },
      ]),
    ).toBe(2);
    expect(call).toHaveBeenCalledWith('app', 'addKeyWraps', {
      wraps: [{ keyId: 'k', recipient: 'r', wrapper: 'w', envelope: 'e' }],
    });
  });
});

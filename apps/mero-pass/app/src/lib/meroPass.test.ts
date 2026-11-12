import { describe, expect, it, vi } from 'vitest';

import { MeroPassClient } from '../generated/client';
import { vaultApiFor } from './vaultApi';
import { withRoutes } from '@calimero-apps/connect/testing';

describe('vaultApiFor, over the generated client', () => {
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
    const api = vaultApiFor(new MeroPassClient(withRoutes({ call, view }), 'app'));

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

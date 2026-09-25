// The generated client, adapted to the narrow `VaultApi` the session needs.
// Kept separate so `vaultSession.ts` stays testable without a node.

import type { MeroPassClient } from '../generated/MeroPassClient';
import type { Role, VaultApi } from './vaultSession';

export function vaultApiFor(client: MeroPassClient): VaultApi {
  return {
    async vaultInfo() {
      const i = await client.vaultInfo();
      return { ...i, my_role: i.my_role as Role };
    },
    registerDevice: (fingerprint, public_key, label) =>
      client.registerDevice({ fingerprint, public_key, label }),
    listDevices: () => client.listDevices(),
    async listMembers() {
      return (await client.listMembers()).map((m) => ({
        ...m,
        role: m.role as Role,
      }));
    },
    keyWrapsFor: (recipient) => client.keyWrapsFor({ recipient }),
    wrappedPairs: () => client.wrappedPairs(),
    addKeyWraps: (wraps) => client.addKeyWraps({ wraps }),
    rotateKey: (key_id) => client.rotateKey({ key_id }),
    setRole: (account, role) => client.setRole({ account, role }),
    removeMember: (account) => client.removeMember({ account }),
    listSecrets: () => client.listSecrets(),
    addSecret: (id, kind, name, tags, fields) =>
      client.addSecret({ id, kind, name, tags, fields }),
    updateSecret: (id, name, tags, fields, rekey) =>
      client.updateSecret({ id, name, tags, fields, rekey }),
    secretHistory: (id) => client.secretHistory({ id }),
  };
}

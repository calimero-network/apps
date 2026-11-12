// The one adapter between the component contract's answers and the shapes
// the vault core (`@calimero-network/mero-pass`) and the screens use: v1's
// snake_case records with numeric times. The contract now answers camelCase
// with u64 times as decimal strings; converting here keeps the npm package's
// public `VaultApi` unchanged and the screens untouched.

import type {
  DeviceRecord,
  MemberRecord,
  RevisionRecord,
  Role,
  SecretRecord,
  VaultApi,
  VaultInfo,
  WrapRecord,
} from '@calimero-network/mero-pass';

import type {
  AuditWire,
  DeviceWire,
  KeyWrapWire,
  MemberWire,
  RevisionWire,
  SecretWire,
  VaultInfoWire,
} from './meroPass';
import type { MeroPassClient } from '../generated/client';

/** A decimal-string u64 (or a number) as a number; 0 for anything else. */
export function num(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export const toVaultInfo = (i: VaultInfoWire): VaultInfo => ({
  name: i.name,
  current_key: i.currentKey,
  default_role: i.defaultRole,
  my_account: i.myAccount,
  my_role: i.myRole as Role,
});

export const toMember = (m: MemberWire): MemberRecord => ({
  account: m.account,
  role: m.role as Role,
  devices: num(m.devices),
});

export const toDevice = (d: DeviceWire): DeviceRecord => ({
  fingerprint: d.fingerprint,
  public_key: d.publicKey,
  label: d.label,
  kind: d.kind,
  account: d.account,
  added_at: num(d.addedAt),
  revoked: d.revoked,
});

export const toWrap = (
  w: KeyWrapWire,
): WrapRecord & { wrapped_by: string } => ({
  key_id: w.keyId,
  recipient: w.recipient,
  wrapper: w.wrapper,
  envelope: w.envelope,
  wrapped_by: w.wrappedBy,
});

export const toSecret = (s: SecretWire): SecretRecord => ({
  id: s.id,
  kind: s.kind,
  name: s.name,
  tags: s.tags,
  fields: s.fields ?? {},
  created_at: num(s.createdAt),
  created_by: s.createdBy,
  updated_at: num(s.updatedAt),
  updated_by: s.updatedBy,
  trashed: s.trashed,
  trashed_at: num(s.trashedAt),
});

export const toRevision = (r: RevisionWire): RevisionRecord => ({
  field: r.field,
  previous: r.previous,
  replaced_at: num(r.replacedAt),
  replaced_by: r.replacedBy,
});

/** An audit line as the screens read it (v1's `AuditView`). */
export interface AuditView {
  action: string;
  target: string;
  account: string;
  device: string;
  timestamp: number;
  redacted: boolean;
}

export const toAudit = (a: AuditWire): AuditView => ({
  ...a,
  timestamp: num(a.timestamp),
});

/**
 * The narrow `VaultApi` the vault session needs, over one vault's contract:
 * `MeroPassClient`, generated from logic/res/abi.json, which types its record
 * answers from the ABI.
 */
export function vaultApiFor(api: MeroPassClient): VaultApi {
  return {
    vaultInfo: async () => toVaultInfo(await api.vaultInfo()),
    registerDevice: async (fingerprint, publicKey, label, kind) => {
      await api.registerDevice({ fingerprint, publicKey, label, kind });
    },
    revokeDevice: async (fingerprint) => {
      await api.revokeDevice({ fingerprint });
    },
    listDevices: async () => (await api.listDevices()).map(toDevice),
    listMembers: async () => (await api.listMembers()).map(toMember),
    keyWrapsFor: async (recipient) =>
      (await api.keyWrapsFor({ recipient })).map(toWrap),
    wrappedPairs: () => api.wrappedPairs(),
    addKeyWraps: async (wraps) =>
      num(
        await api.addKeyWraps({
          wraps: wraps.map((w) => ({
            keyId: w.key_id,
            recipient: w.recipient,
            wrapper: w.wrapper,
            envelope: w.envelope,
          })),
        }),
      ),
    rotateKey: async (keyId) => {
      await api.rotateKey({ keyId });
    },
    setRole: async (account, role) => {
      await api.setRole({ account, role });
    },
    removeMember: async (account) => {
      await api.removeMember({ account });
    },
    listSecrets: async () => (await api.listSecrets()).map(toSecret),
    addSecret: (id, kind, name, tags, fields) =>
      api.addSecret({ id, kind, name, tags, fields }),
    updateSecret: async (id, name, tags, fields, rekey) => {
      await api.updateSecret({ id, name, tags, fields, rekey });
    },
    secretHistory: async (id) => (await api.secretHistory({ id })).map(toRevision),
  };
}

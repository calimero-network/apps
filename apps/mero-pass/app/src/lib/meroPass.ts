import type { CalimeroClient } from '@calimero-network/mero-js';

/** The package a production vault is created from (`[package.metadata.calimero]`). */
export const PACKAGE = 'com.calimero.mero-pass';

/**
 * The contract's methods by their ABI names (camelCase), split the way the
 * node runs them: a call goes through the app's log, a view is answered by a
 * node without writing. `meroPass.test.ts` asserts these lists, and the
 * parameter names each method sends, are exactly the committed
 * `logic/res/abi.json`'s.
 */
export const CALLS = [
  'renameVault',
  'setRole',
  'removeMember',
  'setDefaultRole',
  'registerDevice',
  'revokeDevice',
  'addKeyWraps',
  'rotateKey',
  'addSecret',
  'updateSecret',
  'trashSecret',
  'restoreSecret',
  'purgeSecret',
] as const;
export const VIEWS = [
  'vaultInfo',
  'vaultName',
  'listMembers',
  'listDevices',
  'keyWrapsFor',
  'wrappedPairs',
  'secretHistory',
  'getSecret',
  'listSecrets',
  'getAuditLogs',
] as const;

// ── What the contract answers (u64 fields are decimal strings) ──────────────

export interface VaultInfoWire {
  name: string;
  currentKey: string;
  defaultRole: string;
  myAccount: string;
  myRole: string;
}
export interface MemberWire {
  account: string;
  role: string;
  devices: number;
}
export interface DeviceWire {
  fingerprint: string;
  publicKey: string;
  label: string;
  kind: string;
  account: string;
  addedAt: string;
  revoked: boolean;
}
export interface KeyWrapWire {
  keyId: string;
  recipient: string;
  wrapper: string;
  envelope: string;
  wrappedBy: string;
}
export interface KeyWrapInputWire {
  keyId: string;
  recipient: string;
  wrapper: string;
  envelope: string;
}
export interface SecretWire {
  id: string;
  kind: string;
  name: string;
  tags: string;
  fields: Record<string, string>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  trashed: boolean;
  trashedAt: string;
}
export interface RevisionWire {
  field: string;
  previous: string;
  replacedAt: string;
  replacedBy: string;
}
export interface AuditWire {
  action: string;
  target: string;
  account: string;
  device: string;
  timestamp: string;
  redacted: boolean;
}

/** One vault's contract, typed (no client is generated from a component ABI yet). */
export interface MeroPass {
  vaultInfo(): Promise<VaultInfoWire>;
  vaultName(): Promise<string>;
  renameVault(name: string): Promise<null>;
  listMembers(): Promise<MemberWire[]>;
  setRole(account: string, role: string): Promise<null>;
  removeMember(account: string): Promise<null>;
  setDefaultRole(role: string): Promise<null>;
  registerDevice(
    fingerprint: string,
    publicKey: string,
    label: string,
    kind: string,
  ): Promise<null>;
  listDevices(): Promise<DeviceWire[]>;
  revokeDevice(fingerprint: string): Promise<null>;
  addKeyWraps(wraps: KeyWrapInputWire[]): Promise<number>;
  keyWrapsFor(recipient: string): Promise<KeyWrapWire[]>;
  wrappedPairs(): Promise<string[]>;
  rotateKey(keyId: string): Promise<null>;
  addSecret(
    id: string,
    kind: string,
    name: string,
    tags: string,
    fields: Record<string, string>,
  ): Promise<string>;
  updateSecret(
    id: string,
    name: string | null,
    tags: string | null,
    fields: Record<string, string>,
    rekey: boolean,
  ): Promise<null>;
  secretHistory(id: string): Promise<RevisionWire[]>;
  trashSecret(id: string): Promise<null>;
  restoreSecret(id: string): Promise<null>;
  purgeSecret(id: string): Promise<null>;
  getSecret(id: string): Promise<SecretWire | null>;
  listSecrets(): Promise<SecretWire[]>;
  getAuditLogs(): Promise<AuditWire[]>;
}

export type Transport = Pick<CalimeroClient, 'call' | 'view'>;

/**
 * The vault at app instance `app` through `client`. `after` runs after every
 * request (the session store syncs a refreshed session there).
 */
export function meroPass(
  client: Transport,
  app: string,
  after: () => void = () => {},
): MeroPass {
  const call = async <T>(
    method: (typeof CALLS)[number],
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    try {
      return (await client.call(app, method, args)).result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(
    method: (typeof VIEWS)[number],
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    try {
      return (await client.view(app, method, args)).result as T;
    } finally {
      after();
    }
  };
  return {
    vaultInfo: () => view('vaultInfo'),
    vaultName: () => view('vaultName'),
    renameVault: (name) => call('renameVault', { name }),
    listMembers: () => view('listMembers'),
    setRole: (account, role) => call('setRole', { account, role }),
    removeMember: (account) => call('removeMember', { account }),
    setDefaultRole: (role) => call('setDefaultRole', { role }),
    registerDevice: (fingerprint, publicKey, label, kind) =>
      call('registerDevice', { fingerprint, publicKey, label, kind }),
    listDevices: () => view('listDevices'),
    revokeDevice: (fingerprint) => call('revokeDevice', { fingerprint }),
    addKeyWraps: (wraps) => call('addKeyWraps', { wraps }),
    keyWrapsFor: (recipient) => view('keyWrapsFor', { recipient }),
    wrappedPairs: () => view('wrappedPairs'),
    rotateKey: (keyId) => call('rotateKey', { keyId }),
    addSecret: (id, kind, name, tags, fields) =>
      call('addSecret', { id, kind, name, tags, fields }),
    updateSecret: (id, name, tags, fields, rekey) =>
      call('updateSecret', { id, name, tags, fields, rekey }),
    secretHistory: (id) => view('secretHistory', { id }),
    trashSecret: (id) => call('trashSecret', { id }),
    restoreSecret: (id) => call('restoreSecret', { id }),
    purgeSecret: (id) => call('purgeSecret', { id }),
    getSecret: (id) => view('getSecret', { id }),
    listSecrets: () => view('listSecrets'),
    getAuditLogs: () => view('getAuditLogs'),
  };
}

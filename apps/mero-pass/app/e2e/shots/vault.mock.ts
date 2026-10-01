// Aliased over src/lib/vault — the per-context typed client and the vault name.
import { VARIANT } from './fixtures';

const ME = 'a'.repeat(64);
const ANA = 'b'.repeat(64);
const MARKO = 'c'.repeat(64);
const T = (days: number) => (1_758_000_000_000 - days * 86_400_000) * 1_000_000;

// The v2 audit trail: an action, the id it touched, who and from which device.
const EVENTS = [
  {
    action: 'secret_updated',
    target: 's1',
    account: ANA,
    device: 'd2',
    timestamp: T(1),
    redacted: false,
  },
  {
    action: 'device_registered',
    target: 'f00d',
    account: MARKO,
    device: 'd3',
    timestamp: T(2),
    redacted: false,
  },
  {
    action: 'key_rotated',
    target: 'k2',
    account: ME,
    device: 'd1',
    timestamp: T(3),
    redacted: false,
  },
  {
    action: 'secret_added',
    target: 's5',
    account: ANA,
    device: 'd2',
    timestamp: T(4),
    redacted: false,
  },
  {
    action: 'member_admitted',
    target: MARKO,
    account: ME,
    device: 'd1',
    timestamp: T(6),
    redacted: false,
  },
];

const MEMBERS = [
  { account: ME, role: 'admin', devices: 2 },
  { account: ANA, role: 'editor', devices: 1 },
  { account: MARKO, role: 'viewer', devices: 1 },
];

const DEVICES = [
  {
    fingerprint: '1a2b' + '0'.repeat(60),
    public_key: '',
    label: 'Chrome on macOS',
    kind: 'browser',
    account: ME,
    added_at: T(30),
    revoked: false,
  },
  {
    fingerprint: '9e8d' + '0'.repeat(60),
    public_key: '',
    label: 'Recovery key',
    kind: 'recovery',
    account: ME,
    added_at: T(29),
    revoked: false,
  },
  {
    fingerprint: '5c6d' + '0'.repeat(60),
    public_key: '',
    label: 'Firefox on Linux',
    kind: 'browser',
    account: ANA,
    added_at: T(20),
    revoked: false,
  },
  {
    fingerprint: '3f4e' + '0'.repeat(60),
    public_key: '',
    label: 'Safari on iOS',
    kind: 'browser',
    account: MARKO,
    added_at: T(6),
    revoked: false,
  },
  {
    fingerprint: '7a7a' + '0'.repeat(60),
    public_key: '',
    label: 'Chrome on Windows',
    kind: 'browser',
    account: ANA,
    added_at: T(40),
    revoked: true,
  },
];

const client = {
  getAuditLogs: async () => (VARIANT === 'empty' ? [] : EVENTS),
  listMembers: async () => MEMBERS,
  listDevices: async () => DEVICES,
  setRole: async () => {},
  removeMember: async () => {},
  revokeDevice: async () => {},
  setDefaultRole: async () => {},
  vaultName: async () => 'Bank logins',
};

export function useVaultClient() {
  // The state where this node is in the team but holds no identity in the
  // vault's context yet — a real, common state right after joining.
  return VARIANT === 'noIdentity' ? null : (client as never);
}

export function useVaultName() {
  return 'Bank logins';
}

export async function clientForContext() {
  return client as never;
}

export function vaultLabel(contextId: string) {
  return `Vault ${contextId.slice(0, 8)}…`;
}

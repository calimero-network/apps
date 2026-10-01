// Aliased over src/hooks/useVaultSession — an unlocked vault, already
// decrypted. The real hook needs a node, a device key and wraps; the pages
// only need what it returns.
import { VARIANT } from './fixtures';
import type { DeviceRecord, Secret } from '../../src/lib/vaultSession';

const ME = 'a'.repeat(64);
const ANA = 'b'.repeat(64);

// ⚠️ NANOseconds, as `env::time_now()` emits and as `asDate` divides down.
const T = (days: number) => (1_758_000_000_000 - days * 86_400_000) * 1_000_000;

const SECRETS: Secret[] = [
  {
    id: 's1',
    kind: 'login',
    name: 'GitHub',
    tags: ['work', 'infra'],
    fields: {
      username: 'ada@acme.example',
      password: 'correct-horse-battery-staple',
      url: 'https://github.com',
      notes: 'Org owner account. 2FA on the shared authenticator.',
    },
    createdAt: T(30),
    createdBy: ME,
    updatedAt: T(1),
    updatedBy: ANA,
    trashed: false,
    trashedAt: 0,
    unreadable: false,
  },
  {
    id: 's2',
    kind: 'totp',
    name: 'Stripe',
    tags: ['billing'],
    fields: { issuer: 'Stripe', secret: 'JBSWY3DPEHPK3PXP' },
    createdAt: T(20),
    createdBy: ME,
    updatedAt: T(20),
    updatedBy: ME,
    trashed: false,
    trashedAt: 0,
    unreadable: false,
  },
  {
    id: 's3',
    kind: 'ssh_key',
    name: 'Deploy key',
    tags: ['infra'],
    fields: { private_key: '-----BEGIN OPENSSH PRIVATE KEY-----' },
    createdAt: T(14),
    createdBy: ANA,
    updatedAt: T(14),
    updatedBy: ANA,
    trashed: false,
    trashedAt: 0,
    unreadable: false,
  },
  {
    id: 's4',
    kind: 'secure_note',
    name: 'Office wifi',
    tags: [],
    fields: { note: 'SSID acme-5g · password on the fridge' },
    createdAt: T(9),
    createdBy: ME,
    updatedAt: T(9),
    updatedBy: ME,
    trashed: false,
    trashedAt: 0,
    unreadable: false,
  },
  {
    id: 's5',
    kind: 'payment_card',
    name: 'Company card',
    tags: ['billing'],
    fields: { cardholder: 'Acme Ltd', number: '4242 4242 4242 4242' },
    createdAt: T(4),
    createdBy: ANA,
    updatedAt: T(4),
    updatedBy: ANA,
    trashed: false,
    trashedAt: 0,
    unreadable: false,
  },
  {
    id: 's6',
    kind: 'login',
    name: 'Old staging admin',
    tags: [],
    fields: { username: 'admin', password: 'x' },
    createdAt: T(60),
    createdBy: ME,
    updatedAt: T(8),
    updatedBy: ME,
    trashed: true,
    trashedAt: T(8),
    unreadable: false,
  },
];

const REQUEST: DeviceRecord = {
  fingerprint: '7f3a9c21' + 'e'.repeat(56),
  public_key: '',
  label: 'Firefox on Linux',
  kind: 'browser',
  account: ANA,
  added_at: T(0),
  revoked: false,
};

const session = {
  info: {
    name: 'Bank logins',
    current_key: 'k1',
    default_role: 'editor',
    my_account: ME,
    my_role: 'admin',
  },
  state: 'ready',
  isAdmin: true,
  canWrite: true,
  update: async () => {},
  add: async () => 's-new',
  history: async () => [],
  approve: async () => 1,
  deny: async () => {},
  rotate: async () => 0,
};

// Built ONCE. The real hook keeps these in state, so they are stable across
// renders; a fresh array per call makes every effect that lists them re-run on
// every render, which froze the page the first time a secret was expanded.
const waiting = VARIANT === 'waiting';
const empty = VARIANT === 'empty';
// No identity in the vault's context yet: the real hook has no client, so no
// session and no secrets.
const noIdentity = VARIANT === 'noIdentity';
const VIEW = {
  session: (noIdentity ? null : session) as never,
  state: noIdentity ? 'no-identity' : waiting ? 'waiting' : 'ready',
  secrets: empty || waiting || noIdentity ? [] : SECRETS,
  error: null,
  approvals: VARIANT === 'approval' ? [REQUEST] : [],
  awaitingApproval: waiting,
  holders:
    VARIANT === 'personal'
      ? { browsers: 1, recovery: 0 }
      : { browsers: 3, recovery: 1 },
  reload: async () => {},
};

export function useVaultSession() {
  return VIEW;
}

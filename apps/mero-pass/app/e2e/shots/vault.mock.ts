// Aliased over src/lib/vault — the per-context typed client and the vault name.
import { VARIANT } from './fixtures';

// ⚠️ NANOseconds, as `env::time_now()` emits and as `asDate` divides down.
// These were milliseconds at first and every date in the screenshots read
// 1/1/1970 — the fixture was wrong, not the app.
const SECRETS = [
  {
    id: 's1',
    name: 'GitHub',
    secret_type: 'login',
    data: JSON.stringify({
      username: 'ada@acme.example',
      password: 'correct-horse-battery-staple',
      url: 'https://github.com',
      notes: 'Org owner account. 2FA on the shared authenticator.',
    }),
    tags: ['work', 'infra'],
    created_at: 1_757_000_000_000_000_000,
    updated_at: 1_757_900_000_000_000_000,
    version: 3,
    created_by: 'a'.repeat(64),
  },
  {
    id: 's2',
    name: 'Stripe live key',
    secret_type: 'ssh_key',
    data: JSON.stringify({
      private_key: 'sk_live_51H8xQ2KZvNmPqR4tYuIoP',
      public_key: 'pk_live_51H8xQ2KZvNmPqR4tYuIoP',
    }),
    tags: ['billing'],
    created_at: 1_756_100_000_000_000_000,
    updated_at: 1_756_100_000_000_000_000,
    version: 1,
    created_by: 'b'.repeat(64),
  },
  {
    id: 's3',
    name: 'Office wifi',
    secret_type: 'secure_note',
    data: JSON.stringify({ content: 'SSID acme-5g — ask Tom to rotate in May.' }),
    tags: [],
    created_at: 1_755_000_000_000_000_000,
    updated_at: 1_755_000_000_000_000_000,
    version: 1,
    created_by: 'c'.repeat(64),
  },
  {
    id: 's4',
    name: 'Company card',
    secret_type: 'payment_card',
    data: JSON.stringify({
      cardholder_name: 'Acme Ltd',
      card_number: '4242424242424242',
      expiry_date: '04/29',
      cvv: '123',
    }),
    tags: ['billing', 'finance'],
    created_at: 1_754_000_000_000_000_000,
    updated_at: 1_754_000_000_000_000_000,
    version: 2,
    created_by: 'a'.repeat(64),
  },
];

const EVENTS = [
  {
    id: 'l1',
    action: 'secret_updated',
    details: "Secret 'GitHub' updated",
    user_public_key: 'b'.repeat(64),
    timestamp: 1_757_900_000_000_000_000,
  },
  {
    id: 'l2',
    action: 'secret_added',
    details: "Secret 'Stripe live key' added",
    user_public_key: 'a'.repeat(64),
    timestamp: 1_756_100_000_000_000_000,
  },
  {
    id: 'l3',
    action: 'vault_renamed',
    details: "Vault renamed from 'Vault 1' to 'Bank logins'",
    user_public_key: 'a'.repeat(64),
    timestamp: 1_755_500_000_000_000_000,
  },
];

const client = {
  listSecrets: async () => (VARIANT === 'empty' ? [] : SECRETS),
  getAuditLogs: async () => (VARIANT === 'empty' ? [] : EVENTS),
  deleteSecret: async () => {},
  addSecret: async () => 'new',
  updateSecret: async () => {},
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

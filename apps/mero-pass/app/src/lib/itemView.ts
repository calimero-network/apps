// How a decrypted secret presents in the item list: the line under its name,
// the letter on its tile, and whether a search matches it. Pure, so the list
// and its tests agree without rendering anything.

import { KINDS, type Kind } from './secretKinds';
import type { Secret } from './vaultSession';

/** The list's categories: every kind, in the order the sidebar shows them. */
export const CATEGORIES: { id: Kind; label: string }[] = [
  { id: 'login', label: 'Logins' },
  { id: 'secure_note', label: 'Secure notes' },
  { id: 'payment_card', label: 'Payment cards' },
  { id: 'identity', label: 'Identities' },
  { id: 'totp', label: 'Authenticators' },
  { id: 'ssh_key', label: 'SSH keys' },
];

export function kindLabel(kind: string): string {
  return KINDS.find((k) => k.id === kind)?.label ?? kind.replace(/_/g, ' ');
}

/** The host of a stored website, without scheme or `www.`; '' when none. */
export function hostOf(url: string | undefined): string {
  const raw = (url ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A stored website as a link a browser can open, or null. */
export function openableUrl(url: string | undefined): string | null {
  const raw = (url ?? '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return hostOf(raw) ? `https://${raw}` : null;
}

/**
 * The line under an item's name. Never a secret value: the last four digits
 * of a card are the one exception, and every card statement prints them.
 */
export function subtitleOf(s: Secret): string {
  const f = s.fields;
  switch (s.kind) {
    case 'login':
      return f.username || hostOf(f.url) || 'Login';
    case 'payment_card': {
      const digits = (f.card_number ?? '').replace(/\D/g, '');
      return digits.length >= 4
        ? `•••• ${digits.slice(-4)}`
        : f.cardholder_name || 'Payment card';
    }
    case 'identity':
      return f.full_name || f.email || 'Identity';
    case 'totp':
      return (
        [f.issuer, f.account].filter(Boolean).join(' · ') || 'Authenticator'
      );
    case 'ssh_key':
      return 'SSH key';
    default:
      return kindLabel(s.kind);
  }
}

/** The letter on the item's tile. */
export function monogramOf(name: string): string {
  const ch = name.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return ch ? ch.toUpperCase() : '•';
}

/**
 * Search runs here, over decrypted text, because the node holds only
 * ciphertext. Names, tags, usernames and sites match; secret values never do,
 * so a search box over someone's shoulder cannot confirm a password.
 */
export function matches(s: Secret, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const f = s.fields;
  return [
    s.name,
    ...s.tags,
    f.username,
    f.url,
    f.email,
    f.issuer,
    f.account,
    f.full_name,
  ]
    .filter((v): v is string => !!v)
    .some((v) => v.toLowerCase().includes(q));
}

/** Alphabetical, ignoring case and accents. */
export function byName(a: Secret, b: Secret): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** Calimero stamps in nanoseconds; anything that large is not milliseconds. */
export function asDate(stamp: number): Date {
  return new Date(stamp > 1e12 ? Math.floor(stamp / 1e6) : stamp);
}

export function who(account: string, me?: string): string {
  return account && account === me ? 'you' : `${account.slice(0, 10)}…`;
}

// ── Password health ──────────────────────────────────────────────────────────
//
// Computed in the browser over already-decrypted secrets. The breach check is
// the only part that touches the network, it is opt-in, and it uses the
// k-anonymity range API: only the first five hex characters of the SHA-1 of a
// password leave the browser, and the match happens here.

import type { Secret } from './vaultSession';

export type Issue = 'weak' | 'reused' | 'old' | 'breached';

export interface HealthRow {
  id: string;
  name: string;
  issues: Issue[];
  /** 0–4, a rough zxcvbn-style score from length and character variety. */
  strength: number;
}

const OLD_AFTER_MS = 365 * 24 * 60 * 60 * 1000;

const COMMON = new Set([
  'password',
  '123456',
  '12345678',
  'qwerty',
  'letmein',
  'admin',
  'welcome',
  'iloveyou',
  'monkey',
  'dragon',
  'hunter2',
  'password1',
  'abc123',
]);

/** A deliberately simple estimate: length, classes, and a common-word check. */
export function strengthOf(pw: string): number {
  if (!pw) return 0;
  if (COMMON.has(pw.toLowerCase())) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) =>
    r.test(pw),
  ).length;
  const repeated = /^(.)\1+$/.test(pw);
  if (repeated) return 0;
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16) score += 1;
  if (classes >= 3) score += 1;
  if (pw.length < 8) score = Math.min(score, 1);
  return Math.min(score, 4);
}

export function analyse(
  secrets: Secret[],
  breached: Set<string> = new Set(),
  now = Date.now(),
): HealthRow[] {
  const live = secrets.filter(
    (s) => !s.trashed && !s.unreadable && s.fields.password,
  );
  const count = new Map<string, number>();
  for (const s of live)
    count.set(s.fields.password, (count.get(s.fields.password) ?? 0) + 1);
  return live
    .map((s) => {
      const pw = s.fields.password;
      const strength = strengthOf(pw);
      const issues: Issue[] = [];
      if (strength <= 1) issues.push('weak');
      if ((count.get(pw) ?? 0) > 1) issues.push('reused');
      // `updated_at` is nanoseconds from the host; accept ms too.
      const updatedMs = s.updatedAt > 1e14 ? s.updatedAt / 1e6 : s.updatedAt;
      if (updatedMs && now - updatedMs > OLD_AFTER_MS) issues.push('old');
      if (breached.has(s.id)) issues.push('breached');
      return { id: s.id, name: s.name, issues, strength };
    })
    .sort(
      (a, b) => b.issues.length - a.issues.length || a.strength - b.strength,
    );
}

async function sha1Hex(text: string): Promise<string> {
  const d = new Uint8Array(
    await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)),
  );
  return Array.from(d, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Which secrets' passwords appear in a known breach. `fetchRange` is injected
 * so tests (and a future self-hosted mirror) need not hit the public API.
 */
export async function breachedIds(
  secrets: Secret[],
  fetchRange: (prefix: string) => Promise<string> = async (prefix) => {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) throw new Error(`Breach check failed: ${res.status}`);
    return res.text();
  },
): Promise<Set<string>> {
  const out = new Set<string>();
  const byPrefix = new Map<string, { id: string; suffix: string }[]>();
  for (const s of secrets) {
    const pw = s.fields.password;
    if (!pw || s.unreadable || s.trashed) continue;
    const h = await sha1Hex(pw);
    const list = byPrefix.get(h.slice(0, 5)) ?? [];
    list.push({ id: s.id, suffix: h.slice(5) });
    byPrefix.set(h.slice(0, 5), list);
  }
  for (const [prefix, items] of byPrefix) {
    const body = await fetchRange(prefix);
    const hits = new Set(
      body
        .split(/\r?\n/)
        .map((l) => l.split(':'))
        .filter(([, n]) => Number(n) > 0)
        .map(([suffix]) => suffix.trim().toUpperCase()),
    );
    for (const it of items) if (hits.has(it.suffix)) out.add(it.id);
  }
  return out;
}

/** A strong random password from a URL- and shell-safe alphabet. */
export function generatePassword(length = 20): string {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
  const out: string[] = [];
  const limit = 256 - (256 % alphabet.length);
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && out.length < length)
        out.push(alphabet[b % alphabet.length]);
    }
  }
  return out.join('');
}

import { describe, expect, it } from 'vitest';

import {
  hostOf,
  matches,
  monogramOf,
  openableUrl,
  subtitleOf,
} from './itemView';
import type { Secret } from './vaultSession';

function secret(
  kind: string,
  fields: Record<string, string>,
  extra: Partial<Secret> = {},
): Secret {
  return {
    id: 'secret_x',
    kind,
    name: 'GitHub',
    tags: ['work'],
    fields,
    createdAt: 0,
    createdBy: '',
    updatedAt: 0,
    updatedBy: '',
    trashed: false,
    trashedAt: 0,
    unreadable: false,
    ...extra,
  } as Secret;
}

describe('itemView', () => {
  it('reads a host from a bare domain or a full URL', () => {
    expect(hostOf('https://www.github.com/login')).toBe('github.com');
    expect(hostOf('github.com')).toBe('github.com');
    expect(hostOf('')).toBe('');
    expect(openableUrl('github.com')).toBe('https://github.com');
    expect(openableUrl('javascript:alert(1)')).toBeNull();
  });

  it('subtitles a login with its username, else its site', () => {
    expect(subtitleOf(secret('login', { username: 'ada', url: 'x.com' }))).toBe(
      'ada',
    );
    expect(subtitleOf(secret('login', { url: 'https://x.com' }))).toBe('x.com');
  });

  it('shows only the last four digits of a card', () => {
    const s = secret('payment_card', { card_number: '4242 4242 4242 1234' });
    expect(subtitleOf(s)).toBe('•••• 1234');
  });

  it('never matches a search against a password', () => {
    const s = secret('login', { username: 'ada', password: 'hunter2' });
    expect(matches(s, 'ada')).toBe(true);
    expect(matches(s, 'work')).toBe(true);
    expect(matches(s, 'hunter')).toBe(false);
  });

  it('draws a letter from the first letter or digit', () => {
    expect(monogramOf('  github')).toBe('G');
    expect(monogramOf('🔑 1password')).toBe('1');
    expect(monogramOf('')).toBe('•');
  });
});

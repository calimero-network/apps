import { describe, expect, it } from 'vitest';

import {
  hostOf,
  hueOf,
  matches,
  monogramOf,
  openableUrl,
  subtitleOf,
  who,
} from './itemView';
import type { Secret } from '@calimero-apps/pass-core';

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

  it('subtitles an agent credential by its service, never its token', () => {
    expect(
      subtitleOf(
        secret('oauth2', {
          provider: 'Gmail',
          account: 'ops@example.com',
          refresh_token: '1//secret',
        }),
      ),
    ).toBe('Gmail · ops@example.com');
    expect(
      subtitleOf(
        secret('api_key', { base_url: 'https://api.x.com/2', api_key: 'k' }),
      ),
    ).toBe('api.x.com');
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

  it('gives a name the same tile hue every time, whatever its case or padding', () => {
    expect(hueOf('Acme Ltd')).toBe(hueOf('  acme ltd '));
    expect(hueOf('Acme Ltd')).not.toBe(hueOf('Home'));
    for (const n of ['', 'a', 'Ops on-call', '🔑 keys']) {
      expect(hueOf(n)).toBeGreaterThanOrEqual(0);
      expect(hueOf(n)).toBeLessThan(360);
    }
  });

  it('says who changed an item by name, else a short id, never a raw slice', () => {
    const acct =
      '5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334';
    expect(who(acct, acct)).toBe('you');
    expect(who(acct, undefined, () => 'Sandi')).toBe('Sandi');
    expect(who(acct, undefined, () => undefined)).toBe('5926f2…1334');
  });
});

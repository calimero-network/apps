// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { analyse, breachedIds, generatePassword, strengthOf } from './health';
import {
  decryptExport,
  encryptExport,
  importCsv,
  parseCsv,
} from './portability';
import {
  createShareFragment,
  needsPassphrase,
  openShareFragment,
} from './shareLink';
import type { Secret } from './vaultSession';

function secret(
  id: string,
  password: string,
  extra: Partial<Secret> = {},
): Secret {
  return {
    id,
    kind: 'login',
    name: id,
    tags: [],
    fields: { password },
    createdAt: 0,
    createdBy: '',
    updatedAt: Date.now(),
    updatedBy: '',
    trashed: false,
    trashedAt: 0,
    unreadable: false,
    ...extra,
  };
}

describe('csv import', () => {
  it('parses quotes, doubled quotes and embedded newlines', () => {
    expect(parseCsv('a,"b,c","d ""e""\nf"\r\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'd "e"\nf'],
      ['1', '2', '3'],
    ]);
  });

  it('reads a Bitwarden export', () => {
    const csv =
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n' +
      'Work,,login,GitHub,,,,https://github.com,alice,s3cret,JBSWY3DPEHPK3PXP\n' +
      ',,note,Wifi,"door code 1234",,,,,,\n' +
      ',,card,Visa,,,,,,,\n';
    const { source, drafts } = importCsv(csv);
    expect(source).toBe('bitwarden');
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toEqual({
      kind: 'login',
      name: 'GitHub',
      tags: ['Work'],
      fields: {
        username: 'alice',
        password: 's3cret',
        url: 'https://github.com',
        totp: 'JBSWY3DPEHPK3PXP',
      },
    });
    expect(drafts[1]).toMatchObject({
      kind: 'secure_note',
      fields: { notes: 'door code 1234' },
    });
  });

  it('reads Chrome and 1Password exports', () => {
    const chrome = importCsv(
      'name,url,username,password,note\nMail,https://m,u,p,\n',
    );
    expect(chrome.source).toBe('chrome');
    expect(chrome.drafts[0].fields).toEqual({
      url: 'https://m',
      username: 'u',
      password: 'p',
    });
    const op = importCsv(
      'Title,Url,Username,Password,Notes,OTPAuth\nBank,https://b,me,pw,,\n',
    );
    expect(op.source).toBe('1password');
    expect(op.drafts[0].name).toBe('Bank');
  });
});

describe('encrypted export', () => {
  it('round-trips and refuses the wrong passphrase', async () => {
    const file = await encryptExport([secret('a', 'pw-a')], 'correct horse');
    expect(file).not.toContain('pw-a');
    const back = await decryptExport(file, 'correct horse');
    expect(back[0].fields.password).toBe('pw-a');
    await expect(decryptExport(file, 'wrong horse')).rejects.toThrow(
      /Wrong passphrase/,
    );
  }, 20_000);

  it('refuses a short passphrase', async () => {
    await expect(encryptExport([], 'short')).rejects.toThrow();
  });
});

describe('health', () => {
  it('flags weak and reused passwords', () => {
    const rows = analyse([
      secret('a', 'password'),
      secret('b', 'Tr0ub4dor&3-long-enough'),
      secret('c', 'Tr0ub4dor&3-long-enough'),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r.issues]));
    expect(by.a).toContain('weak');
    expect(by.b).toContain('reused');
    expect(by.c).toContain('reused');
    expect(by.b).not.toContain('weak');
  });

  it('flags old passwords and ignores trashed ones', () => {
    const yearsAgo = Date.now() - 2 * 365 * 24 * 3600 * 1000;
    const rows = analyse([
      secret('old', 'Ok-Password-123!', { updatedAt: yearsAgo }),
      secret('gone', 'password', { trashed: true }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['old']);
    expect(rows[0].issues).toContain('old');
  });

  it('scores strength roughly', () => {
    expect(strengthOf('')).toBe(0);
    expect(strengthOf('aaaaaaaaaaaa')).toBe(0);
    expect(strengthOf('abc')).toBeLessThanOrEqual(1);
    expect(strengthOf(generatePassword())).toBeGreaterThanOrEqual(3);
  });

  it('checks breaches by 5-character prefix only', async () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const asked: string[] = [];
    const hits = await breachedIds(
      [secret('a', 'password'), secret('b', 'x9!unique-pw')],
      async (p) => {
        asked.push(p);
        return p === '5BAA6'
          ? '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\nFFFF:0'
          : '';
      },
    );
    expect(asked.every((p) => p.length === 5)).toBe(true);
    expect([...hits]).toEqual(['a']);
  });

  it('generates passwords of the requested length', () => {
    expect(generatePassword(32)).toHaveLength(32);
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe('share links', () => {
  const payload = {
    name: 'Wifi',
    kind: 'login',
    fields: { password: 'guest-pass' },
    expiresAt: Date.now() + 60_000,
  };

  it('opens with the key in the link', async () => {
    const frag = await createShareFragment(payload);
    expect(frag).not.toContain('guest-pass');
    expect(needsPassphrase(frag)).toBe(false);
    expect((await openShareFragment(frag)).fields.password).toBe('guest-pass');
  });

  it('needs the passphrase when one was set', async () => {
    const frag = await createShareFragment(payload, 'tell-them-by-phone');
    expect(needsPassphrase(frag)).toBe(true);
    expect(frag).not.toContain('k=');
    await expect(openShareFragment(frag)).rejects.toThrow(/passphrase/);
    await expect(openShareFragment(frag, 'wrong')).rejects.toThrow();
    expect((await openShareFragment(frag, 'tell-them-by-phone')).name).toBe(
      'Wifi',
    );
  }, 20_000);

  it('refuses an expired or tampered link', async () => {
    const frag = await createShareFragment(payload);
    await expect(
      openShareFragment(frag, undefined, payload.expiresAt + 1),
    ).rejects.toThrow(/expired/);
    const tampered = frag.replace(
      /d=([A-Za-z0-9_-])/,
      (_, c) => `d=${c === 'A' ? 'B' : 'A'}`,
    );
    await expect(openShareFragment(tampered)).rejects.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { buildInviteLink, invitationFromRaw } from '@calimero-apps/cloud';
import { APP_SLUG, invitationUrl, urlWithoutInvitation } from './inviteLink';

const CODE = '3vQB7B6MrGQZaxCuFg4oh';

describe('invitationUrl', () => {
  it('is an HTTPS platform link addressed by this app package', () => {
    const url = invitationUrl(CODE);
    expect(url.startsWith('https://links.calimero.network/')).toBe(true);
    expect(url).toContain(`/${APP_SLUG}/join`);
    expect(new URL(url).searchParams.get('invitation')).toBe(CODE);
  });

  it('is not derived from the current origin', () => {
    // The whole point: minted inside the desktop shell the old version produced
    // a `tauri://…` URL, which nobody else can open.
    expect(invitationUrl(CODE)).not.toContain('localhost');
  });

  it('honours a host override', () => {
    expect(invitationUrl(CODE, 'https://links.example.test')).toContain(
      'https://links.example.test',
    );
  });

  it('refuses to build a link for an empty code', () => {
    expect(() => invitationUrl('   ')).toThrow();
  });
});

describe('the shared capture', () => {
  it('builds the same link every app shares', () => {
    expect(invitationUrl(CODE)).toBe(buildInviteLink(APP_SLUG, CODE));
  });

  it('reads the token back out of the link this app shares', () => {
    expect(invitationFromRaw(invitationUrl(CODE))).toBe(CODE);
  });
});

describe('urlWithoutInvitation', () => {
  it('drops the invitation parameter', () => {
    expect(urlWithoutInvitation('https://app.test/?invitation=abc')).toBe(
      'https://app.test/',
    );
  });

  it('keeps the other query parameters', () => {
    expect(
      urlWithoutInvitation('https://app.test/x?a=1&invitation=abc&b=2'),
    ).toBe('https://app.test/x?a=1&b=2');
  });

  // The fragment carries the SSO session on the desktop hand-off. The previous
  // implementation replaced the URL with `location.pathname`, which dropped it —
  // accepting an invitation signed you out.
  it('PRESERVES the hash', () => {
    expect(
      urlWithoutInvitation(
        'https://app.test/?invitation=abc#access_token=t&node_url=http://n',
      ),
    ).toBe('https://app.test/#access_token=t&node_url=http://n');
  });

  it('leaves a URL with no query alone', () => {
    expect(urlWithoutInvitation('https://app.test/x#y')).toBe(
      'https://app.test/x#y',
    );
  });
});

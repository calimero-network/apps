import { describe, expect, it } from 'vitest';
import { buildInviteLink, invitationFromRaw } from '@calimero-apps/invite';
import {
  APP_SLUG,
  INVITATION_PARAM,
  JOIN_ACTION,
  invitationUrl,
  urlWithoutInvitation,
} from './inviteLink';

/** A realistic payload: base58, one long line, no URL-hostile characters. */
const CODE = '3vQm8xLpZ2kR7nT9pZbA4aYcWeUf6gJd3NsSvXhKrM8tBzQ7Hs2Wk9vLxTnR4mZ';

describe('APP_SLUG', () => {
  it('is the package id from the contract manifest, not a friendly name', () => {
    // The desktop launcher resolves a deep link by `Application.package`, so the
    // slug and the package must be the same string. A mismatch produces links
    // that resolve to nothing, with no error anywhere.
    expect(APP_SLUG).toBe('com.calimero.mero-sheets');
  });
});

describe('invitationUrl', () => {
  it('builds the platform link shape the other mero apps build', () => {
    expect(invitationUrl(CODE)).toBe(
      `https://links.calimero.network/${APP_SLUG}/${JOIN_ACTION}?${INVITATION_PARAM}=${CODE}`,
    );
  });

  it('is the link every app shares', () => {
    expect(invitationUrl(CODE)).toBe(buildInviteLink(APP_SLUG, CODE));
  });

  it('round-trips back to the code through the shared capture', () => {
    expect(invitationFromRaw(invitationUrl(CODE))).toBe(CODE);
  });

  it('is HTTPS, never the custom scheme', () => {
    // An HTTPS link opens the web app, the installed PWA, or hands off to the
    // launcher. `calimero://` does none of that from a chat window.
    expect(invitationUrl(CODE).startsWith('https://')).toBe(true);
  });

  it('carries the invitation in a QUERY parameter, never the hash', () => {
    // The hash belongs to SSO. An invitation there would have to survive the
    // desktop token hand-off, and stripping it after reading would sign the user
    // out to accept an invitation.
    const url = invitationUrl(CODE);
    expect(url).not.toContain('#');
    expect(new URL(url).searchParams.get(INVITATION_PARAM)).toBe(CODE);
  });

  it('honours a host override, for a dev link host', () => {
    const url = invitationUrl(CODE, 'https://links.example.test');
    expect(url.startsWith('https://links.example.test/')).toBe(true);
    expect(invitationFromRaw(url)).toBe(CODE);
  });

  it('refuses an empty code instead of minting a useless link', () => {
    expect(() => invitationUrl('   ')).toThrow();
  });

  it('does not depend on where the app is currently mounted', () => {
    // A link built from `location.origin + location.pathname` points at whatever
    // route the Invite button happened to be on. This one addresses the APP by
    // slug and the intent by verb, so the app decides where to handle it.
    const url = invitationUrl(CODE);
    expect(url).not.toContain('/mero-sheets?');
    expect(url).toContain(`/${APP_SLUG}/${JOIN_ACTION}`);
  });
});

describe('urlWithoutInvitation', () => {
  it('removes the invitation parameter', () => {
    expect(urlWithoutInvitation(`https://x.dev/?${INVITATION_PARAM}=${CODE}`)).toBe(
      'https://x.dev/',
    );
  });

  it('keeps the other parameters', () => {
    expect(
      urlWithoutInvitation(`https://x.dev/?a=1&${INVITATION_PARAM}=${CODE}&b=2`),
    ).toBe('https://x.dev/?a=1&b=2');
  });

  it('PRESERVES the hash, which carries the SSO session', () => {
    // Dropping it would sign the user out in order to accept an invitation.
    expect(
      urlWithoutInvitation(
        `https://x.dev/?${INVITATION_PARAM}=${CODE}#access_token=xyz`,
      ),
    ).toBe('https://x.dev/#access_token=xyz');
  });

  it('preserves a hash containing its own # and ?', () => {
    expect(
      urlWithoutInvitation(`https://x.dev/?${INVITATION_PARAM}=${CODE}#a?b#c`),
    ).toBe('https://x.dev/#a?b#c');
  });

  it('is a no-op on a URL with no query', () => {
    expect(urlWithoutInvitation('https://x.dev/mero-sheets#tok')).toBe(
      'https://x.dev/mero-sheets#tok',
    );
  });
});

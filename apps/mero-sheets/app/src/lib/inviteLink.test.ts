import { describe, expect, it } from 'vitest';
import {
  APP_SLUG,
  INVITATION_PARAM,
  JOIN_ACTION,
  invitationDeepLink,
  invitationFromRaw,
  invitationUrl,
  shareableInvitation,
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

  it('round-trips back to the code', () => {
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

describe('invitationDeepLink', () => {
  it('addresses the app by slug on the custom scheme', () => {
    expect(invitationDeepLink(CODE)).toBe(
      `calimero://${APP_SLUG}/${JOIN_ACTION}?${INVITATION_PARAM}=${CODE}`,
    );
  });

  it('round-trips, and a DOTTED slug survives parsing', () => {
    // Parsing goes through the SDK because `new URL().hostname` mangles a dotted
    // host on a non-special scheme, so `com.calimero.mero-sheets` would come back
    // reshaped or empty.
    expect(invitationFromRaw(invitationDeepLink(CODE))).toBe(CODE);
  });

  it('refuses an empty code', () => {
    expect(() => invitationDeepLink('')).toThrow();
  });
});

describe('invitationFromRaw', () => {
  it('reads a platform link, a deep link, a bare query, and a bare code', () => {
    expect(invitationFromRaw(invitationUrl(CODE))).toBe(CODE);
    expect(invitationFromRaw(invitationDeepLink(CODE))).toBe(CODE);
    expect(invitationFromRaw(`?${INVITATION_PARAM}=${CODE}`)).toBe(CODE);
  });

  it('reads an invitation appended to the app’s own URL', () => {
    // What the launcher does: append `?invitation=…` to the app's frontend URL,
    // which parses to a null slug and action with the params intact.
    expect(invitationFromRaw(`/?${INVITATION_PARAM}=${CODE}`)).toBe(CODE);
    expect(
      invitationFromRaw(
        `https://mero-sheets.vercel.app/mero-sheets?${INVITATION_PARAM}=${CODE}`,
      ),
    ).toBe(CODE);
  });

  it('REFUSES another app’s invitation', () => {
    // Not ours to redeem. Accepting it would push a mero-chat invitation into
    // this app's join flow, to fail somewhere much less obvious.
    expect(
      invitationFromRaw(
        `https://links.calimero.network/com.calimero.chat/join?${INVITATION_PARAM}=${CODE}`,
      ),
    ).toBeNull();
    expect(
      invitationFromRaw(
        `calimero://com.calimero.chat/join?${INVITATION_PARAM}=${CODE}`,
      ),
    ).toBeNull();
  });

  it('does not mistake a PATH SEGMENT for another app’s slug', () => {
    // `parseIntent` reports the first path segment as the slug whatever it is,
    // so this app's own `/mero-sheets?invitation=…` arrives as
    // `{slug: "mero-sheets", action: null}`. Rejecting on the slug alone would
    // throw away exactly the links the launcher produces.
    expect(
      invitationFromRaw(`https://x.dev/mero-sheets?${INVITATION_PARAM}=${CODE}`),
    ).toBe(CODE);
  });

  it('returns null when there is no invitation in it', () => {
    expect(invitationFromRaw('')).toBeNull();
    expect(invitationFromRaw('   ')).toBeNull();
    expect(invitationFromRaw('https://x.dev/mero-sheets')).toBeNull();
    expect(invitationFromRaw('https://x.dev/?other=1')).toBeNull();
  });

  it('treats a blank value as absent', () => {
    expect(invitationFromRaw(`?${INVITATION_PARAM}=`)).toBeNull();
    expect(invitationFromRaw(`?${INVITATION_PARAM}=%20%20`)).toBeNull();
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

describe('shareableInvitation', () => {
  it('always offers a link — there is no origin left to fail on', () => {
    // An origin-derived link has nothing usable to offer inside the desktop
    // shell, where the origin is `tauri://`. The platform host is a constant.
    const s = shareableInvitation(CODE);
    expect(s.link.startsWith('https://')).toBe(true);
    expect(s.deepLink.startsWith('calimero://')).toBe(true);
    expect(s.code).toBe(CODE);
  });
});

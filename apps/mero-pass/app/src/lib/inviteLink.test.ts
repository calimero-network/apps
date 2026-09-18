import { describe, expect, it } from 'vitest';

import {
  APP_SLUG,
  INVITATION_PARAM,
  invitationDeepLink,
  invitationFromRaw,
  invitationUrl,
  shareableInvitation,
  urlWithoutInvitation,
} from './inviteLink';

const CODE = '3mJr7AoUCHxNqd';

describe('invitationUrl', () => {
  it('addresses this app by slug and the join intent by verb', () => {
    const url = invitationUrl(CODE);
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain(`/${APP_SLUG}/join`);
    expect(url).toContain(`${INVITATION_PARAM}=${CODE}`);
  });

  it('keeps the invitation in the QUERY, never the hash', () => {
    // The hash belongs to the desktop SSO hand-off — MeroProvider parses
    // `#node_url=…&access_token=…` on first render and strips it. An
    // invitation there would race the session out of the URL.
    const url = invitationUrl(CODE);
    expect(url).not.toContain('#');
    expect(new URL(url).searchParams.get(INVITATION_PARAM)).toBe(CODE);
  });

  it('refuses to build a link for an empty code', () => {
    // A link to nothing is worse than no link: it looks shareable.
    expect(() => invitationUrl('')).toThrow();
    expect(() => invitationUrl('   ')).toThrow();
    expect(() => invitationDeepLink('')).toThrow();
  });
});

describe('invitationFromRaw', () => {
  it('reads a platform link', () => {
    expect(invitationFromRaw(invitationUrl(CODE))).toBe(CODE);
  });

  it("reads this app's own deep link", () => {
    expect(invitationFromRaw(invitationDeepLink(CODE))).toBe(CODE);
  });

  it('reads a bare app URL the launcher appended the parameter to', () => {
    // `parseIntent` reports the first path segment as the slug whatever it is,
    // so `/home` comes back as a slug with a null action. Rejecting on the slug
    // alone would throw away the app's own links.
    expect(
      invitationFromRaw(`https://mero-pass.vercel.app/home?invitation=${CODE}`),
    ).toBe(CODE);
  });

  it("refuses another app's invitation", () => {
    expect(
      invitationFromRaw(
        `https://links.calimero.network/com.calimero.mero-stream/join?invitation=${CODE}`,
      ),
    ).toBeNull();
  });

  it('returns null when there is no invitation in it', () => {
    expect(invitationFromRaw('')).toBeNull();
    expect(invitationFromRaw('   ')).toBeNull();
    expect(invitationFromRaw('https://mero-pass.vercel.app/home')).toBeNull();
  });
});

describe('urlWithoutInvitation', () => {
  it('removes the invitation and keeps every other parameter', () => {
    expect(
      urlWithoutInvitation(
        `https://app.test/home?keep=1&${INVITATION_PARAM}=${CODE}&also=2`,
      ),
    ).toBe('https://app.test/home?keep=1&also=2');
  });

  it('drops the whole query when the invitation was all of it', () => {
    expect(
      urlWithoutInvitation(`https://app.test/home?${INVITATION_PARAM}=${CODE}`),
    ).toBe('https://app.test/home');
  });

  it('PRESERVES the hash', () => {
    // The hash carries the SSO session on a desktop hand-off. Dropping it would
    // sign the user out in order to accept an invitation.
    expect(
      urlWithoutInvitation(
        `https://app.test/home?${INVITATION_PARAM}=${CODE}#node_url=http://n1&access_token=t`,
      ),
    ).toBe('https://app.test/home#node_url=http://n1&access_token=t');
  });

  it('leaves a URL with no query untouched', () => {
    expect(urlWithoutInvitation('https://app.test/home#x=1')).toBe(
      'https://app.test/home#x=1',
    );
  });
});

describe('shareableInvitation', () => {
  it('offers the HTTPS link first, with the deep link and raw code beside it', () => {
    const share = shareableInvitation(`  ${CODE}  `);
    expect(share.code).toBe(CODE);
    expect(share.link.startsWith('https://')).toBe(true);
    expect(share.deepLink.startsWith(`calimero://${APP_SLUG}/join?`)).toBe(
      true,
    );
  });

  it('round-trips through the parser', () => {
    const share = shareableInvitation(CODE);
    expect(invitationFromRaw(share.link)).toBe(CODE);
    expect(invitationFromRaw(share.deepLink)).toBe(CODE);
  });
});

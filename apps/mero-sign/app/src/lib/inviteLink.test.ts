import { describe, expect, it } from 'vitest';
import {
  APP_SLUG,
  invitationDeepLink,
  invitationFromRaw,
  invitationUrl,
  shareableInvitation,
  urlWithoutInvitation,
} from './inviteLink';

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

describe('invitationDeepLink', () => {
  it('addresses the app by its dotted slug', () => {
    expect(invitationDeepLink(CODE)).toBe(
      `calimero://${APP_SLUG}/join?invitation=${CODE}`,
    );
  });
});

describe('invitationFromRaw', () => {
  it('reads a platform link', () => {
    expect(invitationFromRaw(invitationUrl(CODE))).toBe(CODE);
  });

  it('reads a calimero:// deep link with a dotted slug', () => {
    expect(invitationFromRaw(invitationDeepLink(CODE))).toBe(CODE);
  });

  it("still reads this app's older origin link", () => {
    // Links already sent to people carry the raw JSON in `?invitation=`.
    const json = '{"invitation":{"contextId":"aa"},"inviterSignature":"bb"}';
    const legacy = `https://mero-sign.vercel.app/?invitation=${encodeURIComponent(json)}`;
    expect(invitationFromRaw(legacy)).toBe(json);
  });

  it('reads a bare code', () => {
    expect(invitationFromRaw(`  ${CODE}  `)).toBe(CODE);
  });

  it('reads pasted JSON', () => {
    expect(invitationFromRaw('{"a":1}')).toBe('{"a":1}');
  });

  it("refuses another app's invitation link", () => {
    const other = `https://links.calimero.network/com.calimero.mero-chat/join?invitation=${CODE}`;
    expect(invitationFromRaw(other)).toBeNull();
  });

  it('returns null for something that is not an invitation at all', () => {
    expect(invitationFromRaw('')).toBeNull();
    expect(invitationFromRaw('https://example.com/nothing-here')).toBeNull();
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

describe('shareableInvitation', () => {
  it('offers the link, the desktop link and the bare code', () => {
    const share = shareableInvitation(` ${CODE} `);
    expect(share.code).toBe(CODE);
    expect(share.link).toBe(invitationUrl(CODE));
    expect(share.deepLink).toBe(invitationDeepLink(CODE));
  });
});

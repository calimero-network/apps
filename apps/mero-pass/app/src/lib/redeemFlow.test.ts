import { describe, expect, it } from 'vitest';

import { destinationFor, parseInvitation } from './redeemFlow';
import { encodeInvite } from './inviteCodec';
import { invitationUrl, invitationDeepLink } from './inviteLink';
import type { PassInvitePayload } from './inviteCodec';
import type { Redeemed } from './vaults';

const payload: PassInvitePayload = {
  kind: 'namespace',
  invitation: {
    invitation: { group_id: [1, 2, 3], invited_role: 0 },
    inviter_signature: 'ff'.repeat(64),
  },
  groupAlias: 'Acme',
} as PassInvitePayload;

describe('destinationFor', () => {
  // ⚠️ THE REGRESSION THIS FILE EXISTS FOR. `InvitationPrompt` navigated to
  // `/team/<id>` — singular. `App.tsx` declares `/teams/:teamId` and no
  // `/team/:teamId`, so that fell through to the catch-all, which redirects to
  // `/teams`. Accepting a team invitation "worked": you landed on the teams
  // list, not in the team, and nothing anywhere said why.
  it('sends a joined team to /teams/<id>, plural', () => {
    const landed: Redeemed = { kind: 'team', namespaceId: 'ns-1' };
    expect(destinationFor(landed)).toBe('/teams/ns-1');
  });

  it('sends a joined vault to its context', () => {
    const landed: Redeemed = {
      kind: 'vault',
      contextId: 'ctx-1',
      identity: 'id-1',
    };
    expect(destinationFor(landed)).toBe('/vault/ctx-1');
  });

  it('falls back to the teams list when the node cannot place it yet', () => {
    expect(destinationFor({ kind: 'joined' })).toBe('/teams');
  });
});

describe('parseInvitation', () => {
  const code = encodeInvite(payload);

  it('reads an https invitation link', () => {
    expect(parseInvitation(invitationUrl(code))).not.toBeNull();
  });

  it('reads a calimero:// deep link', () => {
    expect(parseInvitation(invitationDeepLink(code))).not.toBeNull();
  });

  it('reads the BARE CODE, which is what people paste', () => {
    // The invite dialog offers "Copy code" as well as "Copy link", so the
    // string a sender forwards is routinely not a URL at all. Before the paste
    // field existed every caller had a URL and this could not come up.
    expect(parseInvitation(code)).not.toBeNull();
  });

  it('tolerates the whitespace a paste brings with it', () => {
    expect(parseInvitation(`  ${code}\n`)).not.toBeNull();
  });

  it('refuses another app’s invitation link', () => {
    expect(
      parseInvitation(
        `https://links.calimero.network/com.calimero.mero-sign/join?invitation=${code}`,
      ),
    ).toBeNull();
  });

  it('refuses noise rather than reporting a broken invitation', () => {
    for (const junk of ['', '   ', 'hello there', 'https://example.com/x']) {
      expect(parseInvitation(junk)).toBeNull();
    }
  });
});

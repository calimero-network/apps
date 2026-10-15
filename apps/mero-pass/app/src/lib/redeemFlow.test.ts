import { describe, expect, it } from 'vitest';

import { destinationFor } from './redeemFlow';
import type { Redeemed } from './vaults';

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

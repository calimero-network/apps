import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── An invitation has to be able to say "viewer" ───────────────────────────
//
// `mintTargeted` hardcoded `PermissionLevel.Sign`, so every person ever
// invited to an agreement became a signer. `PermissionLevel.Read` existed in
// the contract, was enforced by `require_permission`, and had help text in
// `lib/participants` that no user could ever see — because nothing in the
// product could produce a reader.
//
// A SOURCE test because this app's vitest runs in `node` with no
// testing-library, so the page cannot be rendered here — same approach as
// `AgreementPage.viewer.test.ts` and `routes.test.ts`.

const page = readFileSync(resolve(__dirname, 'AgreementPage.tsx'), 'utf8');

describe('inviting one person', () => {
  it('does not hardcode the level it seats them at', () => {
    // The original bug, in one line: the literal passed straight to
    // addParticipant.
    expect(page).not.toMatch(
      /addParticipant\([\s\S]{0,120}?PermissionLevel\.Sign,/,
    );
  });

  it('passes the level the sender chose', () => {
    expect(page).toMatch(/addParticipant\([\s\S]{0,120}?inviteeLevel,/);
  });

  it('offers the choice in the invite form', () => {
    expect(page).toMatch(/data-testid="invitee-level"/);
    expect(page).toMatch(/INVITABLE_LEVELS\.map/);
  });

  it('says what the choice means for completion, and that it is one-way', () => {
    expect(page).toMatch(/viewers\s*\n?\s*are never waited on/);
    expect(page).toMatch(/signer cannot be made a viewer/);
  });
});

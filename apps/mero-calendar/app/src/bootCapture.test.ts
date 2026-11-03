import { describe, expect, it } from 'vitest';
import indexSrc from './index.tsx?raw';

// The invitation token has to be taken off the address bar before React mounts:
// the router replaces the URL on its first navigation, and a new person signs
// up with a passkey before the token can be redeemed. Asserted against the
// source: rendering the entry point would mean booting the whole app.
describe('invitation capture at boot', () => {
  it('runs before the app renders', () => {
    const capture = indexSrc.indexOf('captureInvite();');
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(indexSrc.indexOf('root.render('));
  });
});

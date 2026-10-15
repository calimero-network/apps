import { describe, expect, it } from 'vitest';
import indexSrc from './index.tsx?raw';

// Without the slug, a link addressed to another app — opened inside this one,
// or a misrouted desktop event — is offered here, and accepting it puts this
// node into a namespace of an app it cannot run. Asserted against the source:
// rendering the entry point would mean booting the whole app.
describe('invitation capture at boot', () => {
  it("is primed for this app's slug only", () => {
    expect(indexSrc).toMatch(
      /primeInvitationCapture\(\s*"mero-calendar",\s*\{\s*slug:\s*APP_SLUG\s*\}\s*\)/,
    );
  });
});

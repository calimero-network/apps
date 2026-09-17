import { describe, expect, it } from "vitest";
import inviteModalSrc from "../components/InviteModal.tsx?raw";
import projectsPageSrc from "../pages/ProjectsPage.tsx?raw";

// ── Invite surfaces share LINKS, never bare tokens ───────────────────────────
//
// ProjectsPage shipped `clipboard.writeText(invitation)` — the bare token —
// while InviteModal, two files away, wrote `invitationLink(invitation)`. Both
// rendered fine, both passed the whole unit and e2e suite, and the only symptom
// was a recipient holding an opaque base58 blob with nothing to open. The codec
// layer was never the problem; the call site was. mero-design had the identical
// defect in the identical pair of files.
//
// No behavioural test catches this: it is a one-argument wiring mistake inside a
// component with no test of its own, and rendering ProjectsPage would mean
// standing up mero-react, the router and the admin API to assert one string. So
// assert it against the source, which is where the bug lives. Sources arrive
// through Vite's `?raw` (typed by vite/client) — this app has no @types/node.

const INVITE_SURFACES: ReadonlyArray<readonly [string, string]> = [
  ["components/InviteModal.tsx", inviteModalSrc],
  ["pages/ProjectsPage.tsx", projectsPageSrc],
];

describe("invite surfaces", () => {
  it.each(INVITE_SURFACES)("%s copies a link, not a bare token", (_name, src) => {
    const writes = [...src.matchAll(/clipboard\.writeText\(([^)]*\)?[^)]*)\)/g)]
      .map((m) => m[1].trim())
      // Other clipboard writes in a surface (a node URL, exported data) are not
      // invitations; only look at the ones carrying the invitation state.
      .filter((arg) => /invitation/i.test(arg));

    expect(writes.length).toBeGreaterThan(0);
    for (const arg of writes) {
      expect(arg).toMatch(/^invitationLink\(/);
    }
  });

  it.each(INVITE_SURFACES)("%s shows the link it will copy", (_name, src) => {
    // The displayed value and the copied value have to agree, or the box reads
    // as a token while the button hands over a link.
    expect(src).toMatch(/data-testid="invite-token"[\s\S]{0,200}invitationLink\(/);
  });

  it.each(INVITE_SURFACES)("%s calls its share surface a link", (_name, src) => {
    expect(src).toMatch(/invitation link/i);
  });
});

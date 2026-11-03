import { describe, expect, it } from "vitest";
import inviteModalSrc from "../components/InviteModal.tsx?raw";
import mainSrc from "../main.tsx?raw";

// ── Invite surfaces share LINKS, never bare tokens ───────────────────────────
//
// ProjectsPage shipped `clipboard.writeText(invitation)` — the bare token —
// while InviteModal, two files away, wrote `invitationLink(invitation)`. Both
// rendered fine, both passed the whole unit and e2e suite, and the only symptom
// was a recipient holding an opaque base58 blob with nothing to open. The codec
// layer was never the problem; the call site was.
//
// No behavioural test catches this: it is a one-argument wiring mistake, and
// rendering every surface would mean standing up the session, the router and the
// client to assert one string. So assert it against the source, which is
// where the bug lives. Sources arrive through Vite's `?raw` (typed by
// vite/client) — this app has no @types/node.
//
// There is one surface now: the shell's Invite button opens InviteModal (the
// Invitations tab that was the second copy is gone). The guard below keeps it
// one — a second place minting invitations has to be added here, and pass.

const INVITE_SURFACES: ReadonlyArray<readonly [string, string]> = [
  ["components/InviteModal.tsx", inviteModalSrc],
];

const SOURCES = import.meta.glob<string>(["../**/*.tsx", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("where invitations are minted", () => {
  it("is only the invite surfaces listed above", () => {
    const minting = Object.entries(SOURCES)
      .filter(([, src]) => /createTeamInvitation\(/.test(src))
      .map(([path]) => path.replace(/^\.\.\//, ""));
    expect(minting.sort()).toEqual(INVITE_SURFACES.map(([name]) => name).sort());
  });
});

describe("invite surfaces", () => {
  it.each(INVITE_SURFACES)("%s copies a link, not a bare token", (_name, src) => {
    const writes = [...src.matchAll(/clipboard\.writeText\(([^)]*\)?[^)]*)\)/g)]
      .map((m) => m[1].trim())
      // Other clipboard writes in a surface (exported HTML, a node URL) are not
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

describe("invitation capture at boot", () => {
  // The router replaces the URL on its first navigation, and a person opening
  // a link is usually not signed in yet: the token is taken into storage
  // before React mounts, or it is lost.
  it("captures ?invite= before the app renders", () => {
    expect(mainSrc.indexOf("captureInvite()")).toBeGreaterThan(-1);
    expect(mainSrc.indexOf("captureInvite()")).toBeLessThan(mainSrc.indexOf("createRoot("));
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  onInvitation,
  resetInvitationCaptureForTests,
  type CapturedInvitation,
} from "./invitationIntents";
import { APP_SLUG, invitationLink } from "./invitation";

/** Point `window.location` at a URL the controller will read on construction. */
function openAt(href: string): void {
  window.history.replaceState(null, "", href);
}

describe("invitation capture", () => {
  beforeEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    openAt("/teams");
  });

  afterEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
  });

  it("captures an invitation the launcher appended to our own URL", () => {
    openAt("/teams?invitation=TOKEN123");
    const seen: CapturedInvitation[] = [];
    onInvitation((i) => seen.push(i));

    expect(seen).toHaveLength(1);
    expect(seen[0].token).toBe("TOKEN123");
  });

  it("replays to a listener that subscribes after the link was opened", () => {
    openAt("/teams?invitation=LATE");
    // Force capture with no listener attached yet, the cold-open case: the link
    // arrives before the component that redeems it has mounted.
    onInvitation(() => {})();
    resetInvitationCaptureForTests();

    openAt("/teams?invitation=LATE");
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.token));
    expect(seen).toEqual(["LATE"]);
  });

  it("strips the invitation from the address bar once captured", () => {
    openAt("/teams?invitation=TIDY&keep=1");
    onInvitation(() => {});

    expect(window.location.search).not.toContain("invitation");
    expect(window.location.search).toContain("keep=1");
  });

  it("reads a canonical platform link for this app", () => {
    const link = invitationLink("PLATFORM");
    expect(link).toContain(APP_SLUG);

    openAt(`/teams?invitation=${encodeURIComponent("PLATFORM")}`);
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.token));
    expect(seen).toEqual(["PLATFORM"]);
  });

  it("does not deliver anything when there is no invitation", () => {
    openAt("/teams");
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.token));
    expect(seen).toEqual([]);
  });

  it("survives localStorage throwing on access", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    try {
      openAt("/teams?invitation=NOSTORE");
      const seen: string[] = [];
      // Must not throw: an invitation still works this session, it just does
      // not survive a reload.
      expect(() => onInvitation((i) => seen.push(i.token))).not.toThrow();
      expect(seen).toEqual(["NOSTORE"]);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});

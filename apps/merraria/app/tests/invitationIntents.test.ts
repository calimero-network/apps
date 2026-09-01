import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  onInvite,
  resetInviteCaptureForTests,
  type CapturedInvite,
} from "../src/net/invitationIntents";
import { APP_SLUG, inviteLink } from "../src/net/inviteLink";

/** Point `window.location` at a URL the controller will read on construction. */
function openAt(href: string): void {
  window.history.replaceState(null, "", href);
}

describe("invitation capture", () => {
  beforeEach(() => {
    resetInviteCaptureForTests();
    localStorage.clear();
    openAt("/play");
  });

  afterEach(() => {
    resetInviteCaptureForTests();
    localStorage.clear();
  });

  it("captures an invitation the launcher appended to our own URL", () => {
    openAt("/play?invitation=TOKEN123");
    const seen: CapturedInvite[] = [];
    onInvite((i) => seen.push(i));

    expect(seen).toHaveLength(1);
    expect(seen[0].token).toBe("TOKEN123");
  });

  it("replays to a listener that subscribes after the link was opened", () => {
    openAt("/play?invitation=LATE");
    // Force capture with no listener attached yet, the cold-open case: the link
    // arrives before the component that redeems it has mounted.
    onInvite(() => {})();
    resetInviteCaptureForTests();

    openAt("/play?invitation=LATE");
    const seen: string[] = [];
    onInvite((i) => seen.push(i.token));
    expect(seen).toEqual(["LATE"]);
  });

  it("strips the invitation from the address bar once captured", () => {
    openAt("/play?invitation=TIDY&keep=1");
    onInvite(() => {});

    expect(window.location.search).not.toContain("invitation");
    expect(window.location.search).toContain("keep=1");
  });

  it("reads a canonical platform link for this app", () => {
    const link = inviteLink("PLATFORM");
    expect(link).toContain(APP_SLUG);

    openAt(`/play?invitation=${encodeURIComponent("PLATFORM")}`);
    const seen: string[] = [];
    onInvite((i) => seen.push(i.token));
    expect(seen).toEqual(["PLATFORM"]);
  });

  it("does not deliver anything when there is no invitation", () => {
    openAt("/play");
    const seen: string[] = [];
    onInvite((i) => seen.push(i.token));
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
      openAt("/play?invitation=NOSTORE");
      const seen: string[] = [];
      // Must not throw: an invitation still works this session, it just does
      // not survive a reload.
      expect(() => onInvite((i) => seen.push(i.token))).not.toThrow();
      expect(seen).toEqual(["NOSTORE"]);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});

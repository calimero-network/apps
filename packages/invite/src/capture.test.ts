import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_AUTO_JOIN_ATTEMPTS,
  onInvitation,
  primeInvitationCapture,
  resetInvitationCaptureForTests,
  type CapturedInvitation,
} from "./capture";

function openAt(href: string): void {
  window.history.replaceState(null, "", href);
}

/** One cold open of an app carrying `token`, returning what was delivered. */
function openWith(token: string, appKey?: string): CapturedInvitation[] {
  resetInvitationCaptureForTests();
  openAt(`/?invitation=${token}`);
  const seen: CapturedInvitation[] = [];
  if (appKey) primeInvitationCapture(appKey);
  onInvitation((i) => seen.push(i));
  return seen;
}

describe("invitation capture", () => {
  beforeEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    openAt("/");
  });
  afterEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
  });

  it("captures an invitation the launcher appended to the app's own URL", () => {
    const seen = openWith("TOKEN123");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.token).toBe("TOKEN123");
  });

  it("replays to a listener that subscribes after the link was opened", () => {
    openAt("/?invitation=LATE");
    primeInvitationCapture(); // capture before any listener exists
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.token));
    expect(seen).toEqual(["LATE"]);
  });

  it("strips the invitation from the address bar once captured", () => {
    openAt("/?invitation=TIDY&keep=1");
    onInvitation(() => {});
    expect(window.location.search).not.toContain("invitation");
    expect(window.location.search).toContain("keep=1");
  });

  it("delivers nothing when there is no invitation", () => {
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.token));
    expect(seen).toEqual([]);
  });

  // An unacked intent replays on every load by design, so a transient failure is
  // retried. Without a ceiling a permanent one is retried forever, and every
  // node restart re-fires a link that was already used.
  it("stops auto-joining an invitation that has spent its attempts", () => {
    for (let i = 0; i < MAX_AUTO_JOIN_ATTEMPTS; i++) {
      expect(openWith("LOOPY")[0]!.autoJoin).toBe(true);
    }
    const exhausted = openWith("LOOPY")[0]!;
    expect(exhausted.autoJoin).toBe(false);
    // Still handed over, so a field prefills and one click retries it.
    expect(exhausted.token).toBe("LOOPY");
  });

  it("counts attempts per invitation, not globally", () => {
    for (let i = 0; i < MAX_AUTO_JOIN_ATTEMPTS; i++) openWith("ONE");
    expect(openWith("ONE")[0]!.autoJoin).toBe(false);
    expect(openWith("TWO")[0]!.autoJoin).toBe(true);
  });

  it("forgets the attempts of an invitation once it is acked", () => {
    openWith("USED");
    openWith("USED")[0]!.resolve();
    expect(
      JSON.parse(localStorage.getItem("calimero:invitation-attempts") ?? "{}"),
    ).not.toHaveProperty("USED");
    expect(openWith("USED")[0]!.autoJoin).toBe(true);
  });

  // Two apps served from one origin (dev server, preview deployment) must not
  // spend each other's budget.
  it("keeps each app's attempt ledger separate", () => {
    for (let i = 0; i < MAX_AUTO_JOIN_ATTEMPTS; i++)
      openWith("SHARED", "app-a");
    expect(openWith("SHARED", "app-a")[0]!.autoJoin).toBe(false);
    expect(openWith("SHARED", "app-b")[0]!.autoJoin).toBe(true);
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
      openAt("/?invitation=NOSTORE");
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

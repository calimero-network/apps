// Account login plumbing (src/net/account.ts + the account side of
// src/net/session.ts): where the wallet sends us, which relay we pick, and
// what "signed in" / "can play" mean for an account.

import { beforeEach, describe, expect, it } from "vitest";
import {
  beginAccountEnrolment,
  chooseRelay,
  isReturningFromWallet,
  WALLET_URL,
} from "../src/net/account";
import {
  adoptAccountSession,
  clearSession,
  getSession,
  hasConnection,
  isAuthenticated,
  resetSession,
  sessionKind,
  updateSession,
} from "../src/net/session";

const DELEGATED_KEY = "calimero.delegated.connection";
const CREDENTIAL_KEY = "calimero.delegated.credential";

const delegated = (relayUrl: string | null) =>
  JSON.stringify({ account: "ac".repeat(32), credential: "cred", deviceSecret: "00".repeat(32), relayUrl });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetSession();
});

describe("chooseRelay", () => {
  const relay = (p: { relayUrl: string | null; fresh: boolean; executorAccount?: string | null }) => ({
    peerId: "p",
    assigned: true,
    relayUrl: p.relayUrl,
    fresh: p.fresh,
    executorAccount: p.executorAccount ?? null,
  });

  it("prefers a fresh relay with an address and carries its executor account", () => {
    const chosen = chooseRelay([
      relay({ relayUrl: "https://stale", fresh: false }),
      relay({ relayUrl: "https://fresh", fresh: true, executorAccount: "ef".repeat(32) }),
    ]);
    expect(chosen).toEqual({ relayUrl: "https://fresh", executorAccount: "ef".repeat(32), note: null });
  });

  it("falls back to a stale relay, with a note", () => {
    const chosen = chooseRelay([relay({ relayUrl: "https://stale", fresh: false })]);
    expect(chosen.relayUrl).toBe("https://stale");
    expect(chosen.note).toMatch(/lapsed/);
  });

  it("explains a brand-new account (no relay) as the normal first step, not an error", () => {
    const chosen = chooseRelay([]);
    expect(chosen.relayUrl).toBeNull();
    expect(chosen.note).toMatch(/invite/);
  });

  it("ignores a malformed executor account", () => {
    expect(chooseRelay([relay({ relayUrl: "https://r", fresh: true, executorAccount: "nope" })]).executorAccount).toBeNull();
  });
});

describe("enrolment redirect", () => {
  it("sends the browser's device keys to the hosted wallet with a one-shot state and returns here", async () => {
    let target = "";
    await beginAccountEnrolment((url) => {
      target = url;
    });
    const url = new URL(target);
    expect(url.origin + url.pathname).toBe(WALLET_URL);
    expect(url.searchParams.get("enrol-device")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("enrol-kem")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("callback-url")).toBe(window.location.origin + window.location.pathname);
    const state = url.searchParams.get("state");
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(sessionStorage.getItem("calimero.enrol.state")).toBe(state);
    // the device key is kept, so the callback can be checked against it
    const keys = JSON.parse(localStorage.getItem("calimero.device")!);
    expect(keys.signPk).toBe(url.searchParams.get("enrol-device"));
  });

  it("recognises the wallet's answer in the hash", () => {
    expect(isReturningFromWallet({ hash: "#credential=c&account=a&device=d&state=s" })).toBe(true);
    expect(isReturningFromWallet({ hash: "#error=denied" })).toBe(true);
    expect(isReturningFromWallet({ hash: "#access_token=t&node_url=u" })).toBe(false); // a node login
    expect(isReturningFromWallet({ hash: "" })).toBe(false);
  });
});

describe("account session state", () => {
  it("adoptAccountSession switches the tab to the account kind and drops the node login", () => {
    updateSession({ nodeUrl: "http://node:2428", contextId: "ctx-old", executorPublicKey: "pk" });
    localStorage.setItem("mero-tokens", JSON.stringify({ access_token: "t" }));
    adoptAccountSession();
    expect(sessionKind()).toBe("account");
    expect(getSession()).toMatchObject({ nodeUrl: null, contextId: null, executorPublicKey: null });
    expect(localStorage.getItem("mero-tokens")).toBeNull();
    expect(JSON.parse(localStorage.getItem("mb-session")!).kind).toBe("account");
  });

  it("is authenticated while mero-js holds the delegated session, playable once it has a relay and a world", () => {
    adoptAccountSession();
    expect(isAuthenticated()).toBe(false); // no delegated session in this tab
    sessionStorage.setItem(DELEGATED_KEY, delegated(null));
    expect(isAuthenticated()).toBe(true);
    updateSession({ contextId: "ctx" });
    expect(hasConnection()).toBe(false); // signed in, nowhere to play from yet
    sessionStorage.setItem(DELEGATED_KEY, delegated("https://relay"));
    expect(hasConnection()).toBe(true);
  });

  it("signing out of an account forgets the delegated session AND its device credential", () => {
    adoptAccountSession();
    sessionStorage.setItem(DELEGATED_KEY, delegated("https://relay"));
    sessionStorage.setItem(CREDENTIAL_KEY, "{}");
    clearSession();
    expect(sessionKind()).toBe("node");
    expect(sessionStorage.getItem(DELEGATED_KEY)).toBeNull();
    expect(sessionStorage.getItem(CREDENTIAL_KEY)).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  it("a node login hash replaces an account session (one kind at a time)", async () => {
    const { captureSessionFromHash } = await import("../src/net/session");
    adoptAccountSession();
    sessionStorage.setItem(DELEGATED_KEY, delegated("https://relay"));
    window.location.hash = "#node_url=http://node:2428&access_token=at&refresh_token=rt&context_id=ctx-1";
    expect(captureSessionFromHash()).toBe("full");
    expect(sessionKind()).toBe("node");
    expect(sessionStorage.getItem(DELEGATED_KEY)).toBeNull();
    window.history.replaceState({}, "", "/");
  });
});

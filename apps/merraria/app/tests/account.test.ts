// Enrolment: the wallet round trip, the state check, which relay to adopt,
// and that the session comes back as an ACCOUNT one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  readEnrolmentCallback: vi.fn(),
  completeDeviceEnrolment: vi.fn(),
}));

vi.mock("@calimero-network/mero-js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@calimero-network/mero-js")>();
  return {
    ...real,
    readEnrolmentCallback: fakes.readEnrolmentCallback,
    completeDeviceEnrolment: fakes.completeDeviceEnrolment,
  };
});

import { readDelegatedSession, type CloudAccountRelay, type CloudClient } from "@calimero-network/mero-js";
import { chooseRelay, completeEnrolment, goToWallet, HOSTED_WALLET, isReturningFromWallet } from "../src/net/account";
import { getSession, resetSession, sessionKind, updateSession } from "../src/net/session";

const ACCOUNT = "a".repeat(64);
const relay = (p: Partial<CloudAccountRelay>): CloudAccountRelay => ({
  peerId: "p",
  relayUrl: null,
  fresh: false,
  executorAccount: null,
  assigned: false,
  ...p,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetSession();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("chooseRelay (the mero-react rule)", () => {
  it("takes a fresh relay with an address, silently", () => {
    const r = chooseRelay([relay({ relayUrl: "https://stale" }), relay({ relayUrl: "https://fresh", fresh: true, executorAccount: "b".repeat(64) })]);
    expect(r).toEqual({ relayUrl: "https://fresh", executorAccount: "b".repeat(64), note: null });
  });
  it("takes a stale one and says so", () => {
    const r = chooseRelay([relay({ relayUrl: "https://stale" })]);
    expect(r.relayUrl).toBe("https://stale");
    expect(r.note).toMatch(/lapsed/);
  });
  it("connects with no relay when none has an address yet, or none is assigned", () => {
    expect(chooseRelay([relay({})]).relayUrl).toBeNull();
    expect(chooseRelay([relay({})]).note).toMatch(/knows no address/);
    expect(chooseRelay([]).relayUrl).toBeNull();
    expect(chooseRelay([]).note).toMatch(/invite/);
  });
  it("drops an executor account that is not 64 hex", () => {
    expect(chooseRelay([relay({ relayUrl: "https://r", fresh: true, executorAccount: "nope" })]).executorAccount).toBeNull();
  });
});

describe("isReturningFromWallet", () => {
  it("recognises a credential fragment and a refusal, without consuming either", () => {
    expect(isReturningFromWallet({ hash: "" })).toBe(false);
    expect(isReturningFromWallet({ hash: "#access_token=at" })).toBe(false);
    expect(isReturningFromWallet({ hash: "#credential=c&account=a&device=d" })).toBe(true);
    expect(isReturningFromWallet({ hash: "#error=cancelled" })).toBe(true);
  });
});

describe("goToWallet", () => {
  it("leaves for the hosted wallet with this browser's device keys and a remembered state", async () => {
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
      origin: "http://localhost:5184",
      pathname: "/",
    } as unknown as Location);
    await goToWallet();
    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(HOSTED_WALLET);
    const keys = JSON.parse(localStorage.getItem("calimero.device")!);
    expect(url.searchParams.get("enrol-device")).toBe(keys.signPk);
    expect(url.searchParams.get("enrol-kem")).toBe(keys.kemPk);
    expect(url.searchParams.get("callback-url")).toBe("http://localhost:5184/");
    expect(url.searchParams.get("state")).toBe(sessionStorage.getItem("calimero.enrol.state"));
    // the keys are reused on the way back — a regenerated key would not match the certificate
    await goToWallet();
    expect(JSON.parse(localStorage.getItem("calimero.device")!).signPk).toBe(keys.signPk);
  });
});

describe("completeEnrolment", () => {
  const cloud = (relays: CloudAccountRelay[]) =>
    ({ getAccountRelays: vi.fn(async () => relays) }) as unknown as CloudClient;

  it("is a no-op on an ordinary page load", async () => {
    fakes.readEnrolmentCallback.mockReturnValue(null);
    expect(await completeEnrolment({ cloud: cloud([]) })).toEqual({ status: "none" });
    expect(sessionKind()).toBeNull();
  });

  it("reports a declined approval rather than throwing", async () => {
    fakes.readEnrolmentCallback.mockImplementation(() => {
      throw new Error("the device was not approved at the wallet");
    });
    expect(await completeEnrolment({ cloud: cloud([]) })).toEqual({
      status: "failed",
      note: "the device was not approved at the wallet",
    });
  });

  it("refuses a callback this tab never started (no state remembered)", async () => {
    fakes.readEnrolmentCallback.mockReturnValue({ credential: "c", account: ACCOUNT, device: "d", state: "x" });
    const res = await completeEnrolment({ cloud: cloud([]) });
    expect(res.status).toBe("failed");
    expect((res as { note: string }).note).toMatch(/could not be verified/);
    expect(fakes.completeDeviceEnrolment).not.toHaveBeenCalled();
    expect(sessionKind()).toBeNull();
  });

  it("verifies against the state SENT, saves the credential, adopts the account session with its relay", async () => {
    // a node login from before must not survive the sign-in
    updateSession({ kind: "node", nodeUrl: "http://node:2428", contextId: "ctx-old", applicationId: "app-old" });
    localStorage.setItem("mero-tokens", JSON.stringify({ access_token: "t" }));
    sessionStorage.setItem("calimero.enrol.state", "sent-state");
    localStorage.setItem(
      "calimero.device",
      JSON.stringify({ signPk: "1".repeat(64), signSk: "2".repeat(64), kemPk: "3".repeat(64), kemSk: "4".repeat(64) }),
    );
    fakes.readEnrolmentCallback.mockReturnValue({ credential: "cred-hex", account: ACCOUNT, device: "dev", state: "sent-state" });
    fakes.completeDeviceEnrolment.mockResolvedValue({ credential: "cred-hex", account: ACCOUNT, device: "dev" });
    const c = cloud([relay({ relayUrl: "https://relay.example", fresh: true, executorAccount: "e".repeat(64) })]);

    const res = await completeEnrolment({ cloud: c });

    expect(res).toEqual({ status: "enrolled", account: ACCOUNT, note: null });
    expect(fakes.completeDeviceEnrolment).toHaveBeenCalledWith(
      expect.objectContaining({ devicePublicKey: "1".repeat(64), kemPublicKey: "3".repeat(64), expectState: "sent-state" }),
    );
    expect(sessionStorage.getItem("calimero.enrol.state")).toBeNull(); // single-use
    expect(readDelegatedSession()).toEqual({
      account: ACCOUNT,
      credential: "cred-hex",
      deviceSecret: "2".repeat(64),
      relayUrl: "https://relay.example",
      executorAccount: "e".repeat(64),
    });
    expect(sessionKind()).toBe("account");
    const s = getSession();
    expect(s.nodeUrl).toBeNull();
    expect(s.contextId).toBeNull();
    expect(s.applicationId).toBeNull();
    expect(localStorage.getItem("mero-tokens")).toBeNull();
  });

  it("still signs in an account with no relay — that is how it comes to be invited", async () => {
    sessionStorage.setItem("calimero.enrol.state", "s");
    localStorage.setItem(
      "calimero.device",
      JSON.stringify({ signPk: "1".repeat(64), signSk: "2".repeat(64), kemPk: "3".repeat(64), kemSk: "4".repeat(64) }),
    );
    fakes.readEnrolmentCallback.mockReturnValue({ credential: "c", account: ACCOUNT, device: "d", state: "s" });
    fakes.completeDeviceEnrolment.mockResolvedValue({ credential: "c", account: ACCOUNT, device: "d" });
    const res = await completeEnrolment({ cloud: cloud([]) });
    expect(res.status).toBe("enrolled");
    expect((res as { note: string }).note).toMatch(/invite/);
    expect(readDelegatedSession()?.relayUrl).toBeNull();
    expect(sessionKind()).toBe("account");
  });

  it("a certificate the wallet mismatched is refused and nothing is adopted", async () => {
    sessionStorage.setItem("calimero.enrol.state", "s");
    localStorage.setItem(
      "calimero.device",
      JSON.stringify({ signPk: "1".repeat(64), signSk: "2".repeat(64), kemPk: "3".repeat(64), kemSk: "4".repeat(64) }),
    );
    fakes.readEnrolmentCallback.mockReturnValue({ credential: "c", account: ACCOUNT, device: "d", state: "s" });
    fakes.completeDeviceEnrolment.mockRejectedValue(new Error("this credential certifies device key x, but this app holds y"));
    const res = await completeEnrolment({ cloud: cloud([]) });
    expect(res.status).toBe("failed");
    expect(readDelegatedSession()).toBeNull();
    expect(sessionKind()).toBeNull();
  });
});

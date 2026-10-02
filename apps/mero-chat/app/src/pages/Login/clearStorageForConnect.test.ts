import { describe, it, expect, beforeEach } from "vitest";
import {
  clearStorageForConnect,
  CONNECT_PRESERVE_EXACT,
  PLATFORM_PENDING_INTENTS_KEY,
} from "./index";
import { INVITATION_STORAGE_KEY } from "../../utils/invitation";

describe("clearStorageForConnect", () => {
  beforeEach(() => localStorage.clear());

  it("preserves the SDK pending-intent store across a fresh Connect", () => {
    localStorage.setItem(PLATFORM_PENDING_INTENTS_KEY, '[{"nonce":"n","raw":"r","capturedAt":1}]');
    localStorage.setItem("some-stale-session", "junk");
    localStorage.setItem("mero:node_url", "http://localhost:2528");

    clearStorageForConnect();

    expect(localStorage.getItem(PLATFORM_PENDING_INTENTS_KEY)).toBe(
      '[{"nonce":"n","raw":"r","capturedAt":1}]',
    );
    expect(localStorage.getItem("mero:node_url")).toBe("http://localhost:2528");
    expect(localStorage.getItem("some-stale-session")).toBeNull();
  });

  it("still preserves a legacy hand-rolled pending invitation across a fresh Connect", () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "encoded-invite");

    clearStorageForConnect();

    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("encoded-invite");
  });

  it("keeps both the SDK pending-intent key and the legacy key in the preserve whitelist", () => {
    expect(CONNECT_PRESERVE_EXACT.has(PLATFORM_PENDING_INTENTS_KEY)).toBe(true);
    expect(CONNECT_PRESERVE_EXACT.has(INVITATION_STORAGE_KEY)).toBe(true);
  });

  it("keeps an account's device key, nonces and relay map, and drops its session", () => {
    localStorage.setItem("calimero.device", "device-keys");
    localStorage.setItem("calimero.governance-nonce.r.ns", "7");
    localStorage.setItem("calimero.delegated.relays.acct", "{}");
    sessionStorage.setItem("calimero.delegated.credential", "cred");

    clearStorageForConnect();

    expect(localStorage.getItem("calimero.device")).toBe("device-keys");
    expect(localStorage.getItem("calimero.governance-nonce.r.ns")).toBe("7");
    expect(localStorage.getItem("calimero.delegated.relays.acct")).toBe("{}");
    expect(sessionStorage.getItem("calimero.delegated.credential")).toBeNull();
  });

  it("uses the storage key the platform SDK's PendingIntentStore writes to", () => {
    // Guards against drift from @calimero-network/mero-platform's STORAGE_KEY.
    expect(PLATFORM_PENDING_INTENTS_KEY).toBe("calimero.platform.pendingIntents");
  });
});

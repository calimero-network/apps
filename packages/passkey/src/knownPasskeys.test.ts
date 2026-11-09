import { describe, expect, it } from "vitest";
import type { PasskeyProvider } from "@calimero-network/mero-js";
import { knownPasskeys, thisClusterPasskey } from "./knownPasskeys";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("thisClusterPasskey", () => {
  it("offers only the passkeys seen working on this cluster, keeps each that works, and forgets the list when it fails", async () => {
    const storage = memory();
    const asked: (string[] | undefined)[] = [];
    let fail = false;
    const browser: PasskeyProvider = {
      create: async () => ({ attestationObject: "", clientDataJson: "" }),
      get: async (_c, _rp, allow) => {
        asked.push(allow);
        if (fail) throw Object.assign(new Error("cancelled"), { name: "NotAllowedError" });
        return { credentialId: allow?.[0] ?? "cred-a", authenticatorData: "", clientDataJson: "", signature: "" };
      },
    };
    const here = thisClusterPasskey(browser, "calimero-passkeys:eu-shared-1", storage);
    const c = new Uint8Array(32);

    // First sign-in in this browser: every passkey is offered; the one that worked is kept.
    await here.get(c, "calimero.network");
    expect(asked.pop()).toBeUndefined();
    expect(knownPasskeys("calimero-passkeys:eu-shared-1", storage)).toEqual(["cred-a"]);
    // Next sign-in: only it. Another cluster's key holds nothing.
    await here.get(c, "calimero.network");
    expect(asked.pop()).toEqual(["cred-a"]);
    expect(knownPasskeys("calimero-passkeys:eu-shared-2", storage)).toEqual([]);
    // A step-up's own list (the node's) is used as given, and its passkey kept, newest first.
    await here.get(c, "calimero.network", ["cred-b"]);
    expect(asked.pop()).toEqual(["cred-b"]);
    expect(knownPasskeys("calimero-passkeys:eu-shared-1", storage)).toEqual(["cred-b", "cred-a"]);
    // A sign-in that fails with the list forgets it: the next try offers every passkey.
    fail = true;
    await expect(here.get(c, "calimero.network")).rejects.toThrow("cancelled");
    expect(asked.pop()).toEqual(["cred-b", "cred-a"]);
    expect(knownPasskeys("calimero-passkeys:eu-shared-1", storage)).toEqual([]);
  });
});

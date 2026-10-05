import { describe, expect, it, vi } from "vitest";
import { deviceSigningKeyOf, myIdFor } from "./identity";

// `myId` is what the CONTRACT records as the caller: `env::device_id()`, the
// device. On a node that is the context identity the session executes as. On an
// account it is the certified device's ed25519 signing key — core builds the
// delegated principal from the warrant's `author_device_key` — and NOT the
// account that `identities-owned` reports. Getting this wrong marks nobody as
// "you" in a roster and keeps a caller's own frames in their own tile.

const DEVICE_SIGN_PK = "AB".repeat(32);

vi.mock("@calimero-network/mero-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calimero-network/mero-js")>()),
  parseDeviceCredential: (credential: string) => {
    if (credential !== "good-credential") throw new Error("bad borsh");
    return {
      account: "cc".repeat(32),
      device: "dd".repeat(32),
      signPublicKey: DEVICE_SIGN_PK,
    };
  },
}));

describe("deviceSigningKeyOf", () => {
  it("reads the signing key out of the credential, lowercase hex", () => {
    // Lowercase, because the contract's `member_id` is `hex::encode` and the
    // comparison is a plain string equality.
    expect(deviceSigningKeyOf("good-credential")).toBe("ab".repeat(32));
  });

  it("is null without a credential, or with one that will not decode", () => {
    expect(deviceSigningKeyOf(null)).toBeNull();
    expect(deviceSigningKeyOf(undefined)).toBeNull();
    expect(deviceSigningKeyOf("")).toBeNull();
    // A wrong answer would quietly mislabel a roster; none is the honest one.
    expect(deviceSigningKeyOf("garbage")).toBeNull();
  });
});

describe("myIdFor", () => {
  it("is the context identity on a node login", () => {
    expect(
      myIdFor({ isDelegated: false, credential: null, identity: "pk-node" }),
    ).toBe("pk-node");
  });

  it("is the DEVICE signing key on an account — never the account", () => {
    const out = myIdFor({
      isDelegated: true,
      credential: "good-credential",
      // What identities-owned returns for an account: the account itself.
      identity: "cc".repeat(32),
    });
    expect(out).toBe("ab".repeat(32));
    expect(out).not.toBe("cc".repeat(32));
  });

  it("does not fall back to the executor on an account with no credential", () => {
    // The executor IS the account there, and the account is the wrong id to
    // compare a member row against. Null, so callers treat self as unknown.
    expect(
      myIdFor({
        isDelegated: true,
        credential: null,
        identity: "cc".repeat(32),
      }),
    ).toBeNull();
  });

  it("is null on a node with no identity yet", () => {
    expect(
      myIdFor({ isDelegated: false, credential: null, identity: null }),
    ).toBeNull();
  });
});

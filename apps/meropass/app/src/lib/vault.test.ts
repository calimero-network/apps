import { describe, expect, it } from "vitest";

import { vaultLabel } from "./vault";

describe("vaultLabel", () => {
  it("abbreviates a context id to a readable vault name", () => {
    const id = "3f8a91c2d4e5b6a7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d";
    expect(vaultLabel(id)).toBe("Vault 3f8a91c2…");
  });

  it("does not throw on an id shorter than the slice", () => {
    // Defensive: an id this short should never reach the UI, but a label
    // helper that throws would take the whole vault list down with it.
    expect(() => vaultLabel("abc")).not.toThrow();
    expect(vaultLabel("abc")).toBe("Vault abc…");
  });
});

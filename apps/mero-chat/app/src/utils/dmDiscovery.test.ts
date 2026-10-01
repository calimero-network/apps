import { describe, expect, it } from "vitest";

import { isDmSubgroup, resolveDmCounterpart } from "./dmDiscovery";

// Two accounts, in both encodings the system uses. The admin API speaks hex,
// the contract emits base58, and the same account arrives as either.
const ME_HEX =
  "3ea8785b75ba35fb943a3805f2688c8bf1d2f2692a4e306c63828f458c25d20e";
const THEM_HEX =
  "1cc26bb3d3e07a649a2b1c9b563582345377e1b1a0b916318c82cd7255f8f692";
const THIRD_HEX =
  "95d149056d8ef636acd7e46b0b6c8326163e09c745abfd2b77a1dc43eff277d2";
// The same account as ME_HEX, base58 — the form the contract emits. Verified
// against a live node: THEM_HEX encodes to the `creator` the contract reports
// for a DM that account created.
const ME_BASE58 = "5DbGqkRapbvsSCrSm5sSVEMUTioc8RGnG9Q6zmrAcACd";

describe("resolveDmCounterpart", () => {
  it("names the other member of a two-person group", () => {
    expect(resolveDmCounterpart([ME_HEX, THEM_HEX], ME_HEX)).toBe(THEM_HEX);
  });

  it("does not care which order the members arrive in", () => {
    expect(resolveDmCounterpart([THEM_HEX, ME_HEX], ME_HEX)).toBe(THEM_HEX);
  });

  it("matches me across encodings", () => {
    // The whole reason this goes through `sameAccount`: the members list is hex
    // and the identity we compare against may be base58. A raw === never
    // matches, and the DM would look like it belongs to someone else.
    expect(resolveDmCounterpart([ME_HEX, THEM_HEX], ME_BASE58)).toBe(THEM_HEX);
  });

  it("matches an identity that is not in a form sameAccount recognises", () => {
    // `sameAccount` normalises hex and base58; given anything else — a
    // placeholder, a truncated id, an encoding added later — it answers
    // "different" even for two IDENTICAL strings. Relying on it alone would
    // mean the counterpart silently fails to match and the DM is dropped or
    // attributed to the wrong person. Equal strings are the same account by
    // definition, so that is checked first.
    expect(resolveDmCounterpart(["member-me", "member-you"], "member-me")).toBe(
      "member-you",
    );
  });

  it("is not a DM when I am not in it", () => {
    // Being able to SEE a two-person group does not make it mine.
    expect(resolveDmCounterpart([THEM_HEX, THIRD_HEX], ME_HEX)).toBeNull();
  });

  it("is not a DM with three people", () => {
    expect(
      resolveDmCounterpart([ME_HEX, THEM_HEX, THIRD_HEX], ME_HEX),
    ).toBeNull();
  });

  it("is not a DM with only me", () => {
    expect(resolveDmCounterpart([ME_HEX], ME_HEX)).toBeNull();
  });

  it("is not a DM when empty", () => {
    expect(resolveDmCounterpart([], ME_HEX)).toBeNull();
  });

  it("refuses to guess when the same account is listed twice", () => {
    // Two entries that are both me is a malformed group, not a conversation
    // with myself. Returning me would open a DM whose counterpart is the user.
    expect(resolveDmCounterpart([ME_HEX, ME_BASE58], ME_HEX)).toBeNull();
  });

  it("ignores blank entries rather than treating them as a member", () => {
    expect(resolveDmCounterpart([ME_HEX, THEM_HEX, ""], ME_HEX)).toBe(THEM_HEX);
  });

  it("has no answer without knowing who I am", () => {
    expect(resolveDmCounterpart([ME_HEX, THEM_HEX], "")).toBeNull();
  });
});

describe("isDmSubgroup", () => {
  it("accepts a two-person group the contract calls a Dm", () => {
    expect(
      isDmSubgroup({
        members: [ME_HEX, THEM_HEX],
        myAccount: ME_HEX,
        contextType: "Dm",
      }),
    ).toBe(true);
  });

  it("rejects a two-person CHANNEL", () => {
    // A channel with two members is not a DM. The contract's context_type is
    // the authority; membership count alone cannot tell them apart.
    expect(
      isDmSubgroup({
        members: [ME_HEX, THEM_HEX],
        myAccount: ME_HEX,
        contextType: "Channel",
      }),
    ).toBe(false);
  });

  it("accepts a two-person group whose type is not known yet", () => {
    // `context_type` needs a contract call, which may not have happened when
    // the list first paints. Treating unknown as "not a DM" would make DMs
    // appear late; treating it as a candidate lets the type confirm or drop it.
    expect(
      isDmSubgroup({ members: [ME_HEX, THEM_HEX], myAccount: ME_HEX }),
    ).toBe(true);
  });

  it("rejects a group I am not a member of, whatever its type", () => {
    expect(
      isDmSubgroup({
        members: [THEM_HEX, THIRD_HEX],
        myAccount: ME_HEX,
        contextType: "Dm",
      }),
    ).toBe(false);
  });
});

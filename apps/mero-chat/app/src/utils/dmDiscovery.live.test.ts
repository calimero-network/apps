import { describe, expect, it } from "vitest";

import { isDmSubgroup, resolveDmCounterpart } from "./dmDiscovery";

/**
 * The exact bytes two live nodes returned for a real DM, captured while
 * proving this design works. Fixtures drift from reality; these did not come
 * from imagination.
 *
 * Setup: node-1 (`1cc26bb3…`) created a DM with node-2 (`3ea8785b…`). Node-2
 * then read the subgroup's members and the contract's `get_info`.
 */
const NODE_2_SEES_MEMBERS = [
  "1cc26bb3d3e07a649a2b1c9b563582345377e1b1a0b916318c82cd7255f8f692", // Admin
  "3ea8785b75ba35fb943a3805f2688c8bf1d2f2692a4e306c63828f458c25d20e", // me
];
const NODE_2_ACCOUNT =
  "3ea8785b75ba35fb943a3805f2688c8bf1d2f2692a4e306c63828f458c25d20e";
const NODE_1_ACCOUNT =
  "1cc26bb3d3e07a649a2b1c9b563582345377e1b1a0b916318c82cd7255f8f692";
/** Verbatim from `get_info` on node-2. */
const GET_INFO = {
  name: "DM: Bob",
  context_type: "Dm",
  creator: "2wGN1Sofs5aJ79ReizT6uS2Q5mjFp2bJ5wodLRWG4akh",
};

describe("dm discovery, against what two live nodes actually returned", () => {
  it("the invitee resolves the DM the old design could not", () => {
    // This is the case that was broken: node-2 did not create the DM, and the
    // subgroup name it would have parsed was never stored (140-byte alias in a
    // 64-byte field). From membership it needs nothing that was dropped.
    expect(resolveDmCounterpart(NODE_2_SEES_MEMBERS, NODE_2_ACCOUNT)).toBe(
      NODE_1_ACCOUNT,
    );
    expect(
      isDmSubgroup({
        members: NODE_2_SEES_MEMBERS,
        myAccount: NODE_2_ACCOUNT,
        contextType: GET_INFO.context_type,
      }),
    ).toBe(true);
  });

  it("the creator resolves the same DM, mirrored", () => {
    expect(resolveDmCounterpart(NODE_2_SEES_MEMBERS, NODE_1_ACCOUNT)).toBe(
      NODE_2_ACCOUNT,
    );
  });

  it("resolves for the creator addressed in base58, as the contract reports it", () => {
    // `get_info().creator` is base58 while the members list is hex — the exact
    // mismatch that makes a raw comparison useless here.
    expect(resolveDmCounterpart(NODE_2_SEES_MEMBERS, GET_INFO.creator)).toBe(
      NODE_2_ACCOUNT,
    );
  });
});

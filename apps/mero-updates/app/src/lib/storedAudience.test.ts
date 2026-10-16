import { describe, expect, it } from "vitest";
import { decideStoredAudience } from "./storedAudience";

const A = "http://localhost:2528";
const B = "http://localhost:2529";
const base = {
  stored: "ctx-1",
  storedNode: A,
  node: A,
  confirmed: false,
  listed: null,
};

describe("decideStoredAudience", () => {
  it("has nothing to open when nothing is stored", () => {
    expect(decideStoredAudience({ ...base, stored: null })).toEqual({
      state: "none",
      drop: false,
    });
  });

  it("waits for the node's list before opening", () => {
    expect(decideStoredAudience(base)).toEqual({
      state: "checking",
      drop: false,
    });
  });

  it("opens an audience the node lists", () => {
    expect(decideStoredAudience({ ...base, listed: ["ctx-1"] }).state).toBe(
      "open",
    );
  });

  it("drops an audience the node does not list", () => {
    expect(decideStoredAudience({ ...base, listed: ["ctx-2"] })).toEqual({
      state: "none",
      drop: true,
    });
  });

  it("drops an audience opened on another node without asking this one", () => {
    expect(decideStoredAudience({ ...base, node: B })).toEqual({
      state: "none",
      drop: true,
    });
  });

  it("holds an older node-less entry to the same list check", () => {
    const old = { ...base, storedNode: null };
    expect(decideStoredAudience(old).state).toBe("checking");
    expect(decideStoredAudience({ ...old, listed: [] }).drop).toBe(true);
    expect(decideStoredAudience({ ...old, listed: ["ctx-1"] }).state).toBe(
      "open",
    );
  });

  it("trusts an audience already confirmed on this node during this load", () => {
    expect(decideStoredAudience({ ...base, confirmed: true }).state).toBe(
      "open",
    );
  });
});

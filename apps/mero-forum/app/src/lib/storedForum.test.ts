import { describe, expect, it } from "vitest";
import { decideStoredForum } from "./storedForum";

const A = "http://localhost:2528";
const B = "http://localhost:2529";
const base = {
  stored: "ctx-1",
  storedNode: A,
  node: A,
  confirmed: false,
  listed: null,
};

describe("decideStoredForum", () => {
  it("has nothing to open when nothing is stored", () => {
    expect(decideStoredForum({ ...base, stored: null })).toEqual({
      state: "none",
      drop: false,
    });
  });

  it("waits for the node's list before opening", () => {
    expect(decideStoredForum(base)).toEqual({ state: "checking", drop: false });
  });

  it("opens a forum the node lists", () => {
    expect(decideStoredForum({ ...base, listed: ["ctx-1"] }).state).toBe(
      "open",
    );
  });

  it("drops a forum the node does not list", () => {
    expect(decideStoredForum({ ...base, listed: ["ctx-2"] })).toEqual({
      state: "none",
      drop: true,
    });
  });

  it("drops a forum opened on another node without asking this one", () => {
    expect(decideStoredForum({ ...base, node: B })).toEqual({
      state: "none",
      drop: true,
    });
  });

  it("holds an older node-less entry to the same list check", () => {
    const old = { ...base, storedNode: null };
    expect(decideStoredForum(old).state).toBe("checking");
    expect(decideStoredForum({ ...old, listed: [] }).drop).toBe(true);
    expect(decideStoredForum({ ...old, listed: ["ctx-1"] }).state).toBe("open");
  });

  it("trusts a forum already confirmed on this node during this load", () => {
    expect(decideStoredForum({ ...base, confirmed: true }).state).toBe("open");
  });
});

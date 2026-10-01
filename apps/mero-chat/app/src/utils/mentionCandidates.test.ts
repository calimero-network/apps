import { describe, expect, it, vi } from "vitest";

vi.mock("./selfIdentity", () => ({
  isSelfSender: (id: string) => id === "me",
}));

import { mentionCandidates } from "./mentionCandidates";

describe("mentionCandidates", () => {
  it("leaves you out of your own mention list", () => {
    // You are in the channel — the member list should show you — but
    // "@" is for addressing someone else. Offering yourself is noise in a
    // list that is often only two or three names long.
    const names = mentionCandidates(
      new Map([
        ["me", "Xabi"],
        ["them", "Fran"],
      ]),
      "ctx-1",
    );

    // The broadcasts always lead; the roster part is what is asserted here.
    expect(names.filter((n) => !["everyone", "here"].includes(n))).toEqual([
      "Fran",
    ]);
  });

  it("keeps everyone else", () => {
    const names = mentionCandidates(
      new Map([
        ["a", "TestUser"],
        ["b", "Fran"],
        ["c", "Xabi"],
      ]),
      "ctx-1",
    );

    expect(
      names.filter((n) => !["everyone", "here"].includes(n)).sort(),
    ).toEqual(["Fran", "TestUser", "Xabi"]);
  });

  it("drops blank names rather than offering an empty suggestion", () => {
    const names = mentionCandidates(new Map([["a", ""], ["b", "Fran"]]), "ctx-1");
    expect(names.filter((n) => !["everyone", "here"].includes(n))).toEqual([
      "Fran",
    ]);
  });

  it("survives a missing map", () => {
    // The broadcasts do not depend on the roster, so they survive too.
    expect(mentionCandidates(undefined, "ctx-1")).toEqual(["everyone", "here"]);
  });

  it("offers the broadcast words", () => {
    // They already worked if you knew to type them — the contract counts
    // `everyone`/`here` as mentioning everybody — but nothing ever showed them,
    // so they were undiscoverable.
    const names = mentionCandidates(new Map([["a", "Fran"]]), "ctx-1");
    expect(names).toContain("everyone");
    expect(names).toContain("here");
  });

  it("puts the broadcasts first", () => {
    // Two fixed entries at a stable position stay easy to hit; interleaving
    // them with names would move them as membership changes.
    const names = mentionCandidates(new Map([["a", "Anna"]]), "ctx-1");
    expect(names.slice(0, 2)).toEqual(["everyone", "here"]);
  });

  it("does not offer a broadcast twice when someone is named after one", () => {
    const names = mentionCandidates(new Map([["a", "everyone"]]), "ctx-1");
    expect(names.filter((n) => n === "everyone")).toHaveLength(1);
  });
});

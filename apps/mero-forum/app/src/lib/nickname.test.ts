import { describe, expect, it } from "vitest";

import { authorLabel, shortAccount } from "./nickname";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

describe("shortAccount", () => {
  it("shortens a 64-hex account to something you can still tell apart", () => {
    expect(shortAccount(ALICE)).toBe("aaaaaa…aaaa");
  });

  it("leaves something already short alone", () => {
    expect(shortAccount("abc")).toBe("abc");
  });
});

describe("authorLabel", () => {
  it("prefers the chosen name", () => {
    expect(authorLabel(ALICE, "ana", null).label).toBe("ana");
  });

  it("falls back to a short id, and SAYS it is a fallback", () => {
    // The flag is the point: without it the UI renders an account id in the
    // same style as a name, which is exactly the "brings no value" state.
    const l = authorLabel(ALICE, "", null);
    expect(l.label).toBe(shortAccount(ALICE));
    expect(l.anonymous).toBe(true);
  });

  it("treats a whitespace-only name as unset", () => {
    expect(authorLabel(ALICE, "   ", null).anonymous).toBe(true);
  });

  it("marks you as yourself, by ACCOUNT not by name", () => {
    // Two people can choose the same name; only the account decides who is you.
    expect(authorLabel(ALICE, "ana", ALICE).isSelf).toBe(true);
    expect(authorLabel(BOB, "ana", ALICE).isSelf).toBe(false);
  });

  it("is not self when we do not know who we are", () => {
    expect(authorLabel(ALICE, "ana", null).isSelf).toBe(false);
    expect(authorLabel(ALICE, "ana", "").isSelf).toBe(false);
  });
});

describe("what a byline must show", () => {
  // A nickname is a claim: `set_nickname` lets anyone call themselves anything,
  // including exactly what someone else is already called, and the contract
  // neither prevents that nor could. So a name ALONE is not a byline — two
  // people can be "ana" in one thread and the reader cannot tell them apart.
  // The account id is the part that cannot be changed.
  it("a named author is identified by something unforgeable too", () => {
    const l = authorLabel(ALICE, "ana", null);
    expect(l.label).toBe("ana");
    expect(l.anonymous).toBe(false);
    // The component renders `shortAccount(account)` beside the name whenever
    // the label is NOT already the id; this pins the value it shows.
    expect(shortAccount(ALICE)).toBe("aaaaaa…aaaa");
  });

  it("an unnamed author is not identified twice over", () => {
    // Here the label already IS the short id, so showing it again beside itself
    // is the duplication this guards against.
    const l = authorLabel(ALICE, "", null);
    expect(l.anonymous).toBe(true);
    expect(l.label).toBe(shortAccount(ALICE));
  });

  it("two people choosing the same name stay distinguishable", () => {
    const a = authorLabel(ALICE, "ana", null);
    const b = authorLabel(BOB, "ana", null);
    expect(a.label).toBe(b.label);
    // Same name, different id — which is the whole reason the id is shown.
    expect(shortAccount(ALICE)).not.toBe(shortAccount(BOB));
  });
});

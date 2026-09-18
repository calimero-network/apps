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

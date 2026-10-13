import { describe, expect, it } from "vitest";
import { needsClaim } from "./ClaimPage";
import type { MemberView } from "../backend";

const A = "a".repeat(64);

describe("needsClaim", () => {
  it("asks an account with no member row (the founder) to claim", () => {
    expect(needsClaim([], A)).toBe(true);
    expect(needsClaim([{ account: "b".repeat(64) } as MemberView], A)).toBe(true);
  });

  it("lets a member, or an unknown account, through", () => {
    expect(needsClaim([{ account: A } as MemberView], A)).toBe(false);
    expect(needsClaim([], "")).toBe(false);
  });
});

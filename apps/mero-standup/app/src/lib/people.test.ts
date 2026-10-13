import { describe, expect, it } from "vitest";
import type { MemberView, UpdateView } from "../generated/StandupClient";
import { displayName, notYetPosted, shortAccount } from "./people";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

const member = (account: string, name = "", last_day = ""): MemberView => ({
  account,
  name,
  last_day,
});
const update = (author: string): UpdateView => ({
  day: "2026-10-13",
  author,
  author_name: "",
  done: "x",
  next: "",
  blockers: "",
  created_at: 0,
  edited_at: 0,
});

describe("people", () => {
  it("never renders a blank byline", () => {
    expect(displayName(A, "Ana")).toBe("Ana");
    expect(displayName(A, "   ")).toBe(shortAccount(A));
    expect(displayName(A, null)).toBe("aaaaaa…aaaa");
  });

  it("lists who has not posted, by name", () => {
    const members = [member(C, "Carol"), member(A, "Ana"), member(B)];
    expect(notYetPosted(members, [update(A)]).map((m) => m.account)).toEqual([B, C]);
    expect(notYetPosted(members, [update(A), update(B), update(C)])).toEqual([]);
  });
});

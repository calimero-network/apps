import { describe, expect, it } from "vitest";
import { CalimeroError } from "@calimero-network/mero-js";

import { lostAccess, readsFor } from "./eventReads";

describe("readsFor", () => {
  it("re-reads only what an event changed", () => {
    expect(readsFor("LayerUpdated", { id: "l1" }, "me")).toEqual(["layers"]);
    expect(readsFor("LayersReordered", {}, "me")).toEqual(["layers"]);
    expect(readsFor("MemberJoined", { member: "bob" }, "me")).toEqual(["members"]);
    expect(readsFor("DocumentUpdated", {}, "me")).toEqual(["document"]);
  });

  it("re-reads the role only when it is this account's", () => {
    expect(readsFor("RoleUpdated", { member: "me" }, "me")).toEqual(["role"]);
    expect(readsFor("RoleUpdated", { member: "bob" }, "me")).toEqual([]);
  });

  it("reads nothing for a cursor an older build wrote", () => {
    expect(readsFor("CursorMoved", { identity: "bob" }, "me")).toEqual([]);
  });
});

describe("lostAccess", () => {
  it("is a 403 or 404, also as the cause of the app's own error", () => {
    expect(lostAccess(new CalimeroError(403, "FORBIDDEN", "no"))).toBe(true);
    expect(lostAccess(Object.assign(new Error("gone"), { cause: new CalimeroError(404, "NOT_FOUND", "x") }))).toBe(true);
  });

  it("is not a network failure or a contract refusal", () => {
    expect(lostAccess(new TypeError("fetch failed"))).toBe(false);
    expect(lostAccess(new CalimeroError(500, "INTERNAL", "x"))).toBe(false);
  });
});

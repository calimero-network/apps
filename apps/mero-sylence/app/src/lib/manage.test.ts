import { describe, expect, it } from "vitest";
import { canManage, roleName } from "./manage";
import { inviteUrl } from "./orgs";
import { parseRoute, routeHash } from "../route";

describe("roles", () => {
  it("names each role", () => {
    expect(roleName("owner")).toBe("Owner");
    expect(roleName("admin")).toBe("Admin");
    expect(roleName("guest")).toBe("Guest");
    expect(roleName("member")).toBe("Member");
    expect(roleName(undefined)).toBe("Member");
  });
  it("lets owners and admins manage people", () => {
    expect(canManage("owner")).toBe(true);
    expect(canManage("admin")).toBe(true);
    expect(canManage("member")).toBe(false);
    expect(canManage(undefined)).toBe(false);
  });
});

describe("inviteUrl", () => {
  it("takes a link with an invite in the query or the hash", () => {
    expect(inviteUrl("https://sylence.example/?invite=abc&org=o1")?.searchParams.get("invite")).toBe("abc");
    expect(inviteUrl("  https://sylence.example/#invite=abc  ")).not.toBeNull();
    expect(inviteUrl("http://localhost:5173/#/?invite=abc")).not.toBeNull();
  });
  it("refuses anything else", () => {
    expect(inviteUrl("abc")).toBeNull();
    expect(inviteUrl("https://sylence.example/")).toBeNull();
    expect(inviteUrl("javascript:alert(1)//?invite=x")).toBeNull();
  });
});

describe("routes", () => {
  it("round-trips the new pages", () => {
    for (const page of ["people", "profile", "home"] as const) {
      expect(parseRoute(routeHash({ page }))).toEqual({ page });
    }
  });
});

import { CalimeroError } from "@calimero-network/mero-js";
import { beforeEach, describe, expect, it } from "vitest";
import { SPENT_INVITE, captureInvite, inviteFailure, inviteLink, pendingInvite, routeOf } from "./inviteLink";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const at = (href: string) => {
  window.history.replaceState(null, "", href);
  return window.location;
};

describe("invite links", () => {
  it("name the team, so a member is not offered Join", () => {
    const url = new URL(inviteLink("tok", { origin: "https://x.example" }, "/1.2.0/", "org-1"));
    expect(url.pathname).toBe("/1.2.0/");
    expect(url.searchParams.get("invite")).toBe("tok");
    expect(url.searchParams.get("org")).toBe("org-1");
  });

  it("capture the token, the team and a deep-linked route, and clean the address bar", () => {
    captureInvite(localStorage, at("/boards/b-1?invite=tok&org=org-1&settings=team"));
    expect(pendingInvite()).toEqual({ token: "tok", org: "org-1", returnTo: "/boards/b-1?settings=team" });
    expect(window.location.search).toBe("?settings=team");
  });

  it("name no destination for the front door", () => {
    captureInvite(localStorage, at("/?invite=tok"));
    expect(pendingInvite()).toEqual({ token: "tok", org: null, returnTo: null });
    expect(routeOf("/1.2.0/docs", "/1.2.0/")).toBeNull();
    expect(routeOf("/1.2.0/teams/o/projects", "/1.2.0/")).toBe("/teams/o/projects");
  });

  it("say plainly when a token is refused for good", () => {
    expect(inviteFailure(new CalimeroError(404, "NOT_FOUND", "unknown invite"))).toBe(SPENT_INVITE);
    expect(inviteFailure(new CalimeroError(503, "UNAVAILABLE", "try later"))).toMatch(/could not be accepted/);
  });
});

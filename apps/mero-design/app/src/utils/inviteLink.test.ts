import { CalimeroError } from "@calimero-network/mero-js";
import { beforeEach, describe, expect, it } from "vitest";
import { captureInvite, inviteDestination, inviteFailure, inviteLink, invites, migrateLegacyInvite } from "./inviteLink";

const SPENT = "This invite was already used or has expired. Ask the person who invited you for a new link.";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invites.drop();
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
    captureInvite(at("/boards/b-1?invite=tok&org=org-1&settings=team"));
    expect(invites.pending()).toMatchObject({ token: "tok", org: "org-1", route: "/boards/b-1" });
    expect(inviteDestination(invites.pending(), "org-1")).toBe("/boards/b-1");
    expect(window.location.search).toBe("?settings=team");
  });

  it("name no destination for the front door", () => {
    captureInvite(at("/?invite=tok"));
    expect(invites.pending()).toMatchObject({ token: "tok", org: null, route: null });
    expect(inviteDestination({ route: "/docs" }, "o")).toBe("/teams/o/projects");
    expect(inviteDestination({ route: null }, null)).toBe("/teams");
    expect(inviteDestination({ route: "/teams/o/projects" }, null)).toBe("/teams/o/projects");
  });

  it("move an invite an earlier build stored under its own key into the shared store", () => {
    localStorage.setItem("mero-design:pending-invite", JSON.stringify({ token: "old", org: "o", returnTo: "/boards/b?x=1" }));
    migrateLegacyInvite();
    expect(invites.pending()).toMatchObject({ token: "old", org: "o", route: "/boards/b" });
    expect(localStorage.getItem("mero-design:pending-invite")).toBeNull();
  });

  it("say plainly when a token is refused for good, and keep it otherwise", () => {
    expect(inviteFailure(new CalimeroError(404, "NOT_FOUND", "unknown invite"))).toBe(SPENT);
    expect(inviteFailure(new CalimeroError(503, "UNAVAILABLE", "try later"))).toMatch(/could not be accepted/);
    expect(inviteFailure(new CalimeroError(429, "RATE_LIMITED", "slow"))).toMatch(/invite is kept/);
  });
});

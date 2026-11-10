import { beforeEach, describe, expect, it } from "vitest";

import { APP } from "./session";
import { inviteLink, inviteRoute, invites, migrateLegacyInvite } from "./teams";

beforeEach(() => {
  localStorage.clear();
  invites.drop();
  window.history.replaceState(null, "", "/");
});

describe("invitation links", () => {
  it("name the team beside the token, under the served version root", () => {
    const served = `https://${"a".repeat(52)}.apps.calimero.network`;
    const link = new URL(inviteLink("inv_1", "org-1", { href: `${served}/1.2.0/teams/org-1/projects` }));
    expect(link.pathname).toBe("/1.2.0/");
    expect(link.searchParams.get("invite")).toBe("inv_1");
    expect(link.searchParams.get("org")).toBe("org-1");
  });

  it("keep the token, the team and the route under the node basename, and leave the address bar clean", () => {
    window.history.replaceState(null, "", "/1.2.0/teams/org-1/projects/p-1?invite=inv_1&org=org-1");
    invites.capture(window.location, { basename: "/1.2.0/" });
    expect(invites.token()).toBe("inv_1");
    expect(invites.pending()?.org).toBe("org-1");
    expect(inviteRoute(invites.pending(), "org-1")).toBe("/teams/org-1/projects/p-1");
    expect(window.location.pathname).toBe("/1.2.0/teams/org-1/projects/p-1");
    expect(window.location.search).toBe("");
  });

  it("open the joined team when the link was made outside one", () => {
    window.history.replaceState(null, "", "/?invite=inv_1");
    invites.capture(window.location);
    expect(invites.pending()?.org).toBeNull();
    expect(inviteRoute(invites.pending(), "org-2")).toBe("/teams/org-2/projects");
    expect(inviteRoute(invites.pending(), null)).toBe("/teams");
    invites.drop();
    expect(invites.token()).toBeNull();
  });

  it("move an invite an earlier build stored under its own keys into the shared store", () => {
    localStorage.setItem(`${APP}:pending-invite`, "inv_old");
    localStorage.setItem(`${APP}:pending-invite-org`, "org-1");
    localStorage.setItem(`${APP}:pending-invite-route`, "/teams/org-1/projects");
    migrateLegacyInvite();
    expect(invites.token()).toBe("inv_old");
    expect(invites.pending()?.org).toBe("org-1");
    expect(inviteRoute(invites.pending(), "org-1")).toBe("/teams/org-1/projects");
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
  });
});

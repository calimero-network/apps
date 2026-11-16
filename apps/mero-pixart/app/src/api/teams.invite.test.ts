import { beforeEach, describe, expect, it } from "vitest";

import { APP } from "./session";
import { inviteLinkBase, inviteRoute, invites, migrateLegacyInvite } from "./teams";

beforeEach(() => {
  localStorage.clear();
  invites.drop();
  window.history.replaceState(null, "", "/");
});

describe("invitation links", () => {
  it("name the team, under the served version root, for the dialog to put its token on", () => {
    const served = `https://${"a".repeat(52)}.apps.calimero.network`;
    const link = new URL(inviteLinkBase("org-1", { href: `${served}/1.2.0/teams/org-1/projects` }));
    expect(link.pathname).toBe("/1.2.0/");
    expect(link.searchParams.get("org")).toBe("org-1");
    expect(link.hash).toBe("");
  });

  it("capture a dialog link opened as is, and leave the address bar clean", () => {
    window.history.replaceState(null, "", "/?org=org-1#invite=tok");
    invites.capture(window.location);
    expect(invites.token()).toBe("tok");
    expect(invites.pending()?.org).toBe("org-1");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
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

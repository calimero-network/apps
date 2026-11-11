// @vitest-environment-options { "url": "https://4sqp5m3m4gfnhqq7u55pcoxjhgkvyawhhxmlgjrgw4r5drhlgfqa.apps.calimero.network/1.0.0/teams/team-1" }
/**
 * "Manage people in Calimero Home" sits before Log out on a team's screens,
 * for that team's organization, and nowhere it does not apply.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { HOME_PACKAGE, appLabel } from "@calimero-apps/connect";

const state = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("../../../api/sessionContext", () => ({ useSessionApi: () => ({ api: state.api }) }));

import LogoutButton from "./LogoutButton";
import { withRoutes } from "@calimero-apps/connect/testing";

afterEach(cleanup);

function signedIn(role: string, mode: string, home = true) {
  const client = withRoutes({
    package: vi.fn(async (pkg: string) => {
      if (!home) throw new Error("no such package");
      return { package: pkg, latest: "0.3.0", versions: [{ version: "0.3.0" }] };
    }),
    me: vi.fn(async () => ({ orgs: [{ orgId: "team-1", name: "Acme", role }] })),
    getOrg: vi.fn(async () => ({ orgId: "team-1", mode })),
  }) as unknown as CalimeroClient;
  state.api = {
    session: {
      status: "signed-in",
      client,
      target: { kind: "cloud", cluster: window.location.host, nodes: ["https://n1"], minReleaseVersion: "1" },
      accountId: "acc-1",
    },
    signOut: vi.fn(),
  };
  return client;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/teams" element={<LogoutButton />} />
        <Route path="/teams/:teamId" element={<LogoutButton />} />
        <Route path="/teams/:teamId/calendar/:contextId" element={<LogoutButton />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the calendar's Calimero Home link", () => {
  it("links a team's admin to its organization in Calimero Home, on its calendar", async () => {
    signedIn("admin", "standalone");
    renderAt("/teams/team-1/calendar/cal-1");
    const link = await screen.findByTestId("manage-in-home");
    expect(link.getAttribute("href")).toBe(
      `https://${appLabel(HOME_PACKAGE)}.apps.calimero.network/0.3.0/?org=team-1`,
    );
    expect(link.textContent).toBe("Manage people in Calimero Home →");
  });

  it("shows nothing on the team list, which has no team open", async () => {
    const client = signedIn("owner", "shared");
    renderAt("/teams");
    await new Promise((r) => setTimeout(r, 0));
    expect(client.package).not.toHaveBeenCalled();
    expect(screen.queryByTestId("manage-in-home")).toBeNull();
    expect(screen.getByTestId("logout-btn")).toBeTruthy();
  });

  it("shows nothing on a cluster without Home", async () => {
    const client = signedIn("owner", "shared", false);
    renderAt("/teams/team-1");
    await waitFor(() => expect(client.package).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("manage-in-home")).toBeNull();
  });
});

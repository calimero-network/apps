// @vitest-environment-options { "url": "https://4sqp5m3m4gfnhqq7u55pcoxjhgkvyawhhxmlgjrgw4r5drhlgfqa.apps.calimero.network/1.0.0/teams" }
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { HOME_PACKAGE, appLabel } from "@calimero-apps/connect";

import { ShellContext, type ShellValue } from "./shellContext";

const state = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("../../sessionContext", () => ({ useSessionApi: () => ({ api: state.api }) }));
vi.mock("../../api/names", () => ({ useMyName: () => ({ ready: true, name: "Ada", setName: vi.fn() }) }));

import UserMenu from "./UserMenu";

afterEach(cleanup);

function signedIn(role: string, mode: string, home = true) {
  const client = {
    package: vi.fn(async (pkg: string) => {
      if (!home) throw new Error("no such package");
      return { package: pkg, latest: "0.3.0", versions: [{ version: "0.3.0" }] };
    }),
    me: vi.fn(async () => ({ orgs: [{ orgId: "team-1", name: "Acme", role }] })),
    getOrg: vi.fn(async () => ({ orgId: "team-1", mode })),
  } as unknown as CalimeroClient;
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

function renderMenu() {
  const shell = { teamId: "team-1", openSettings: vi.fn() } as unknown as ShellValue;
  render(
    <ShellContext.Provider value={shell}>
      <UserMenu account="acc-1" onLogout={vi.fn()} />
    </ShellContext.Provider>,
  );
  fireEvent.click(screen.getByTestId("user-menu"));
}

describe("Mero Design's account menu", () => {
  it("links a team's admin to its organization in Calimero Home", async () => {
    signedIn("admin", "standalone");
    renderMenu();
    const link = await screen.findByTestId("manage-in-home");
    expect(link.getAttribute("href")).toBe(
      `https://${appLabel(HOME_PACKAGE)}.apps.calimero.network/0.3.0/?org=team-1`,
    );
    expect(link.getAttribute("role")).toBe("menuitem");
    expect(link.textContent).toBe("Manage people in Calimero Home →");
  });

  it("shows nothing on a cluster without Home", async () => {
    const client = signedIn("owner", "shared", false);
    renderMenu();
    await waitFor(() => expect(client.package).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("manage-in-home")).toBeNull();
    expect(screen.getByTestId("logout-btn")).toBeTruthy();
  });
});

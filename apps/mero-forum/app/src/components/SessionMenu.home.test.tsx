// @vitest-environment-options { "url": "https://4sqp5m3m4gfnhqq7u55pcoxjhgkvyawhhxmlgjrgw4r5drhlgfqa.apps.calimero.network/1.0.0/spaces" }
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { HOME_PACKAGE, appLabel } from "@calimero-apps/connect";

import { bindScope, setActiveForum } from "../lib/session";

const state = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("../sessionContext", () => ({ useSessionApi: () => ({ api: state.api }) }));

import SessionMenu from "./SessionMenu";
import { withRoutes } from "@calimero-apps/connect/testing";

afterEach(cleanup);

function signedIn(role: string, mode: string, home = true) {
  const client = withRoutes({
    package: vi.fn(async (pkg: string) => {
      if (!home) throw new Error("no such package");
      return { package: pkg, latest: "0.3.0", versions: [{ version: "0.3.0" }] };
    }),
    me: vi.fn(async () => ({ orgs: [{ orgId: "space-1", name: "Acme", role }] })),
    getOrg: vi.fn(async () => ({ orgId: "space-1", mode })),
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

describe("the forum's account menu", () => {
  bindScope("test");
  setActiveForum("forum-1", "space-1");

  it("links a space's admin to it in Calimero Home", async () => {
    signedIn("admin", "standalone");
    render(<SessionMenu name="Ada" />);
    const link = await screen.findByTestId("manage-in-home");
    expect(link.getAttribute("href")).toBe(
      `https://${appLabel(HOME_PACKAGE)}.apps.calimero.network/0.3.0/?org=space-1`,
    );
    expect(link.textContent).toBe("Manage people in Calimero Home →");
  });

  it("shows nothing on a cluster without Home", async () => {
    const client = signedIn("owner", "shared", false);
    render(<SessionMenu name="Ada" />);
    await waitFor(() => expect(client.package).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("manage-in-home")).toBeNull();
    expect(screen.getByTestId("logout")).toBeTruthy();
  });
});

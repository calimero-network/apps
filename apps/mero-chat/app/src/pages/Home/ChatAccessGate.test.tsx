// @vitest-environment jsdom
/**
 * Someone taken out of Chat in a workspace (off chat's app team, or left
 * without a row when an admin keeps the org's apps apart) still has the
 * workspace selected. Opening Chat must say they no longer have access to
 * Chat there, not render the workspace shell with nothing in it.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PKG = "com.calimero.chat";
const ME = "acct-me";

const h = vi.hoisted(() => ({
  org: null as Record<string, unknown> | null,
  apps: [] as Array<{ appId: string; org: string | null }>,
  clearWorkspaceSelection: vi.fn(),
}));

vi.mock("../../api/calimero", () => ({
  after: () => {},
  getAccountId: () => "acct-me",
  chatSource: () => ({ package: "com.calimero.chat" }),
  passkey: () => ({}),
  getClient: () => (withRoutes({
    getOrg: async () => {
      if (!h.org) throw Object.assign(new Error("404"), { status: 404 });
      return structuredClone(h.org);
    },
    me: async () => ({ orgs: h.org ? [{ orgId: "org-1", name: "Acme", role: "member" }] : [] }),
    listApps: async () =>
      h.apps.map((a) => ({ ...a, name: "general", owner: "acct-ana", bundle: "b", package: "com.calimero.chat", version: null })),
  })),
}));
vi.mock("../../constants/config", () => ({
  getGroupId: () => "org-1",
  clearWorkspaceSelection: h.clearWorkspaceSelection,
}));
vi.mock("../../utils/session", () => ({ clearNamespaceReady: vi.fn() }));

import { invalidate } from "../../api/platform";
import ChatAccessGate from "./ChatAccessGate";
import { withRoutes } from "@calimero-apps/connect/testing";

const chatTeam = (members: Record<string, boolean>, join: "everyone" | "invite", removed: string[] = []) => ({
  parent: null,
  members,
  join,
  removed,
  metadata: { app: { package: PKG } },
});
const blocksTeam = (join: "everyone" | "invite") => ({
  parent: null,
  members: { [ME]: false },
  join,
  removed: [],
  metadata: { app: { package: "com.calimero.mero-blocks" } },
});

function org(mode: "legacy" | "standalone" | "shared", teams: Record<string, unknown>) {
  return {
    orgId: "org-1",
    name: "Acme",
    members: { "acct-ana": "owner", [ME]: "member" },
    memberMetadata: {},
    defaultCapabilities: 1 | 4 | 32,
    capabilities: {},
    metadata: null,
    teams,
    mode,
  };
}

function renderGate() {
  return render(
    <ChatAccessGate>
      <div data-testid="workspace-shell">shell</div>
    </ChatAccessGate>,
  );
}

beforeEach(() => {
  invalidate();
  h.apps = [];
  h.clearWorkspaceSelection.mockClear();
});
afterEach(() => cleanup());

describe("ChatAccessGate", () => {
  it("apps kept apart and no row on chat's team (core hides the closed team): says so, no shell", async () => {
    h.org = org("shared", { "team-blocks": blocksTeam("invite") });
    renderGate();
    expect(await screen.findByText("You no longer have access to Chat in Acme")).toBeTruthy();
    expect(screen.queryByTestId("workspace-shell")).toBeNull();
  });

  it("taken out of chat's open team (Home's Remove): says so, no shell", async () => {
    h.org = org("standalone", { "team-chat": chatTeam({ "acct-ana": true }, "everyone", [ME]), "team-blocks": blocksTeam("everyone") });
    renderGate();
    expect(await screen.findByText("You no longer have access to Chat in Acme")).toBeTruthy();
    expect(screen.queryByTestId("workspace-shell")).toBeNull();
  });

  it("offers the workspace picker, clearing the selection", async () => {
    h.org = org("shared", { "team-blocks": blocksTeam("invite") });
    renderGate();
    const button = await screen.findByRole("button", { name: "Choose another workspace" });
    const replace = vi.fn();
    vi.stubGlobal("location", { ...window.location, replace });
    button.click();
    expect(h.clearWorkspaceSelection).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/login$/));
    vi.unstubAllGlobals();
  });

  it("on chat's team: the workspace", async () => {
    h.org = org("shared", { "team-chat": chatTeam({ [ME]: false }, "invite"), "team-blocks": blocksTeam("invite") });
    h.apps = [{ appId: "app-1", org: "org-1" }];
    renderGate();
    expect(await screen.findByTestId("workspace-shell")).toBeTruthy();
    expect(screen.queryByText(/no longer have access/)).toBeNull();
  });

  it("a legacy workspace (no app teams): the workspace, as before", async () => {
    h.org = org("legacy", {});
    renderGate();
    expect(await screen.findByTestId("workspace-shell")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/no longer have access/)).toBeNull());
  });

  it("still reaching a chat instance there (a private channel they are listed on): the workspace", async () => {
    h.org = org("shared", { "team-blocks": blocksTeam("invite") });
    h.apps = [{ appId: "app-dm", org: "org-1" }];
    renderGate();
    expect(await screen.findByTestId("workspace-shell")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/no longer have access/)).toBeNull());
  });

  it("an unreadable workspace says nothing about Chat: the workspace (the membership watch handles it)", async () => {
    h.org = null;
    renderGate();
    expect(await screen.findByTestId("workspace-shell")).toBeTruthy();
  });
});

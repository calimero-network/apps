import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withRoutes } from "@calimero-apps/connect/testing";

const PKG = "com.calimero.mero-forms";
const client = withRoutes({ session: { accountId: "acct-me" }, listAppTeams: vi.fn() });
const signedIn = { client, accountId: "acct-me", source: "bundle-hash" as unknown, passkey: () => ({}), after: () => {} };
vi.mock("./sessionContext", () => ({ useSignedIn: () => signedIn }));

// The shared dialog is mero-react's to test: here only what the app hands it.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<object>()),
    InviteDialog: (p: { open: boolean; org: string; teams?: string[]; appName?: string; labels?: { note?: string; title?: string }; linkBase?: string }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "invite-dialog" },
            createElement("h2", { "data-testid": "invite-title" }, p.labels?.title),
            createElement("pre", { "data-testid": "invite-props" }, JSON.stringify({ org: p.org, teams: p.teams, appName: p.appName })),
            createElement("pre", { "data-testid": "invite-base" }, p.linkBase),
            createElement("pre", { "data-testid": "invite-note" }, p.labels?.note ?? ""),
          )
        : null,
  };
});

const { InviteCard } = await import("./TeamCard");
const { appOnlyInviteNote } = await import("@calimero-apps/connect");
const { PRODUCT_NAME } = await import("./lib/orgs");

afterEach(() => {
  cleanup();
  signedIn.source = "bundle-hash";
});

describe("the invite card", () => {
  it("opens the shared dialog for the workspace's org, with a link that lands in the workspace", async () => {
    render(<InviteCard org="org-1" appId="app-1" />);
    expect(screen.queryByTestId("invite-dialog")).toBeNull();
    fireEvent.click(screen.getByText("Create invite link"));
    expect((await screen.findByTestId("invite-title")).textContent).toBe("Invite to this workspace");
    expect(JSON.parse(screen.getByTestId("invite-props").textContent ?? "")).toEqual({ org: "org-1", teams: [], appName: "Hyperfeed Forms" });
    const base = new URL(screen.getByTestId("invite-base").textContent ?? "");
    expect(base.searchParams.get("org")).toBe("org-1");
    expect(base.searchParams.get("workspace")).toBe("app-1");
    expect(screen.getByTestId("invite-note").textContent).toBe("");
  });

  it("names Hyperfeed Forms' own team in an org that has app teams", async () => {
    signedIn.source = { package: PKG };
    client.listAppTeams.mockResolvedValue({ mode: "shared", appTeams: [{ package: PKG, teamId: "team-forms" }] });
    render(<InviteCard org="org-1" appId="app-1" />);
    fireEvent.click(screen.getByText("Create invite link"));
    expect(JSON.parse((await screen.findByTestId("invite-props")).textContent ?? "").teams).toEqual(["team-forms"]);
    expect((await screen.findByTestId("invite-note")).textContent).toBe(appOnlyInviteNote(PRODUCT_NAME));
  });

  it("opens no dialog, and says why, when the org has app teams but none for Hyperfeed Forms", async () => {
    signedIn.source = { package: PKG };
    client.listAppTeams.mockResolvedValue({ mode: "shared", appTeams: [{ package: "com.calimero.other", teamId: "team-x" }] });
    render(<InviteCard org="org-1" appId="app-1" />);
    fireEvent.click(screen.getByText("Create invite link"));
    expect((await screen.findByText(/has not set up/)).textContent).toContain(PKG);
    expect(screen.queryByTestId("invite-dialog")).toBeNull();
  });
});

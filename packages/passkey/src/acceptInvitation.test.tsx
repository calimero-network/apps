import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalimeroClient } from "@calimero-network/mero-js";

// The shared dialog is mero-react's to test: here only what is handed to it and done after.
vi.mock("@calimero-network/mero-react", async () => {
  const { createElement } = await import("react");
  return {
    AcceptInviteDialog: (p: {
      open: boolean;
      token: string;
      appName?: string;
      onClose: () => void;
      onJoined: (j: { org: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "accept-dialog" },
            createElement("p", { "data-testid": "accept-token" }, `${p.token} ${p.appName}`),
            createElement("button", { "data-testid": "accept-close", onClick: p.onClose }, "close"),
            createElement("button", { "data-testid": "accept-done", onClick: () => p.onJoined({ org: "org-joined" }) }, "done"),
          )
        : null,
  };
});

import { AcceptInvitation } from "./Onboarding";

afterEach(cleanup);

const clientIn = (orgs: string[] | "fails") =>
  ({
    auth: { me: vi.fn(() => (orgs === "fails" ? Promise.reject(new Error("down")) : Promise.resolve({ orgs: orgs.map((orgId) => ({ orgId })) }))) },
  }) as unknown as CalimeroClient;

function setup(org: string | null, orgs: string[] | "fails" = []) {
  const props = { drop: vi.fn(), after: vi.fn(), onJoined: vi.fn(), onClose: vi.fn() };
  render(<AcceptInvitation client={clientIn(orgs)} token="tok" org={org} appName="Mero X" joining="the team" {...props} />);
  return props;
}

describe("AcceptInvitation", () => {
  it("opens the shared dialog with the token and app name, at once for a link that names no org", () => {
    setup(null);
    expect(screen.getByTestId("accept-token").textContent).toBe("tok Mero X");
  });

  it("waits for the membership check, then asks a non-member", async () => {
    setup("o", ["other"]);
    expect(screen.queryByTestId("accept-dialog")).toBeNull();
    expect(await screen.findByTestId("accept-dialog")).toBeTruthy();
  });

  it("asks when membership cannot be read", async () => {
    setup("o", "fails");
    expect(await screen.findByTestId("accept-dialog")).toBeTruthy();
  });

  it("tells a member so, drops the invite unredeemed and continues into the org", async () => {
    const p = setup("o", ["o"]);
    fireEvent.click(await screen.findByTestId("invitation-continue"));
    expect(screen.queryByTestId("accept-dialog")).toBeNull();
    expect(p.drop).toHaveBeenCalledTimes(1);
    expect(p.onClose).toHaveBeenCalledWith({ member: "o" });
    expect(p.onJoined).not.toHaveBeenCalled();
  });

  it("drops the invite when the dialog is dismissed", async () => {
    const p = setup(null);
    fireEvent.click(screen.getByTestId("accept-close"));
    expect(p.drop).toHaveBeenCalledTimes(1);
    expect(p.onClose).toHaveBeenCalledWith({ member: null });
  });

  it("drops the invite, syncs the session and reports the org the node named once joined", async () => {
    const p = setup(null);
    fireEvent.click(screen.getByTestId("accept-done"));
    await waitFor(() => expect(p.onJoined).toHaveBeenCalledWith({ org: "org-joined" }));
    expect(p.drop).toHaveBeenCalledTimes(1);
    expect(p.after).toHaveBeenCalledTimes(1);
  });
});

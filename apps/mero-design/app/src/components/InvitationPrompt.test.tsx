// This app's wiring into @calimero-apps/invite: the codec it supplies, the two
// calls it supplies, and what lands on screen.
//
// The redemption decisions themselves are the package's, and tested there. What
// can only be tested here is that this app's invitation shape parses, that it
// asks before joining, that the join body is the one the node wants, and that
// the outcome reaches the user.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const joinNamespace = vi.fn();
const listNamespaces = vi.fn();
const showToast = vi.fn();
const navigate = vi.fn();
const session = { isAuthenticated: true, isLoading: false };

vi.mock("../api/rpc", () => ({
  joinNamespace: (...a: unknown[]) => joinNamespace(...a),
  listNamespaces: (...a: unknown[]) => listNamespaces(...a),
}));
vi.mock("../hooks/useApplicationId", () => ({
  useApplicationId: () => async () => "app-1",
}));
vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => session,
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../contexts/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));

const { encodeInvitationObject } = await import("../utils/invitation");
const { resetInvitationCaptureForTests } = await import(
  "@calimero-apps/invite"
);
const InvitationPrompt = (await import("./InvitationPrompt")).default;

const NS = "7d847b7afeab53bef1899496014ce7dae7cecc6e4fda9901b4bdcc706afcc807";
/** group_id arrives as a byte array in a real invitation. */
const GROUP_BYTES = NS.match(/../g)!.map((h) => parseInt(h, 16));
const INNER = { group_id: GROUP_BYTES };
const OUTER = {
  invitation: INNER,
  inviterSignature: "sig",
  applicationId: "app-1",
};
const TOKEN = encodeInvitationObject({
  invitation: OUTER,
  __teamName: "Design",
});

function openWithInvitation(): void {
  resetInvitationCaptureForTests();
  window.history.replaceState(
    null,
    "",
    `/?invitation=${encodeURIComponent(TOKEN)}`,
  );
}

describe("InvitationPrompt – an invite link opened this app", () => {
  beforeEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    sessionStorage.clear();
    joinNamespace.mockReset();
    listNamespaces.mockReset();
    showToast.mockReset();
    navigate.mockReset();
    session.isAuthenticated = true;
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("names the team and waits to be asked, joining nothing", async () => {
    openWithInvitation();
    render(<InvitationPrompt />);

    expect(await screen.findByText(/invited to “Design”/)).toBeTruthy();
    expect(screen.getByTestId("invite-accept")).toBeTruthy();
    expect(joinNamespace).not.toHaveBeenCalled();
  });

  it("holds the invitation until the session can join", async () => {
    session.isAuthenticated = false;
    openWithInvitation();
    const { rerender } = render(<InvitationPrompt />);
    expect(screen.queryByTestId("invite-accept")).toBeNull();

    session.isAuthenticated = true;
    rerender(<InvitationPrompt />);
    expect(await screen.findByTestId("invite-accept")).toBeTruthy();
  });

  it("joins on accept, says so, and opens the team", async () => {
    joinNamespace.mockResolvedValue(undefined);
    listNamespaces.mockResolvedValue([{ namespaceId: NS, name: "Design" }]);
    openWithInvitation();
    render(<InvitationPrompt />);

    fireEvent.click(await screen.findByTestId("invite-accept"));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(`/teams/${NS}/projects`),
    );
    // The body is the invitation struct, not the whole decoded token.
    expect(joinNamespace).toHaveBeenCalledWith(NS, OUTER);
    // And the post-join sync gate is armed before the navigation.
    expect(sessionStorage.getItem("calimero:justJoinedNamespaces")).toContain(
      NS,
    );
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "Joined team. Syncing projects…",
        "success",
      ),
    );
  });

  it("declining joins nothing and puts the prompt away", async () => {
    openWithInvitation();
    render(<InvitationPrompt />);

    fireEvent.click(await screen.findByTestId("invite-decline"));

    await waitFor(() =>
      expect(screen.queryByTestId("invite-status")).toBeNull(),
    );
    expect(joinNamespace).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  // The 30s-proxy-abort case: the request fails, the join landed.
  it("says you are already in it rather than reporting a failure", async () => {
    joinNamespace.mockRejectedValue(new Error("timed out after 30 seconds"));
    listNamespaces.mockResolvedValue([{ namespaceId: NS, name: "Design" }]);
    openWithInvitation();
    render(<InvitationPrompt />);

    fireEvent.click(await screen.findByTestId("invite-accept"));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "You are already in this team.",
        "success",
      ),
    );
    expect(navigate).toHaveBeenCalledWith(`/teams/${NS}/projects`);
  });

  it("shows the node's own reason when the join really failed", async () => {
    joinNamespace.mockRejectedValue(
      new Error("could not reach any member of this namespace"),
    );
    listNamespaces.mockResolvedValue([]);
    openWithInvitation();
    render(<InvitationPrompt />);

    fireEvent.click(await screen.findByTestId("invite-accept"));

    expect(
      await screen.findByText(/could not reach any member of this namespace/),
    ).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    // Retryable, so the user is offered one.
    expect(screen.getByTestId("invite-retry")).toBeTruthy();
  });
});

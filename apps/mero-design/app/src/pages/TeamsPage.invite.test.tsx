// This app's wiring into @calimero-apps/invite: the codec it supplies, the two
// calls it supplies, and what lands on screen.
//
// The redemption decisions themselves are the package's, and tested there. What
// can only be tested here is that this app's invitation shape parses, that the
// join body is the one the node wants, and that the outcome reaches the user.

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminPost = vi.fn();
const listNamespaces = vi.fn();
const showToast = vi.fn();
const navigate = vi.fn();

vi.mock("../api/rpc", () => ({
  adminPost: (...a: unknown[]) => adminPost(...a),
  adminDelete: vi.fn().mockResolvedValue({}),
  listNamespaces: (...a: unknown[]) => listNamespaces(...a),
}));
vi.mock("../api/appId", () => ({
  resolveApplicationId: vi.fn().mockResolvedValue("app-1"),
}));
vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ applicationId: "app-1", logout: vi.fn() }),
  setApplicationId: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../contexts/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));
vi.mock("../components/SettingsModal", () => ({ default: () => null }));
vi.mock("../components/Logo", () => ({ default: () => null }));

const { encodeInvitationObject } = await import("../utils/invitation");
const { resetInvitationCaptureForTests } = await import(
  "@calimero-apps/invite"
);
const TeamsPage = (await import("./TeamsPage")).default;

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
    `/teams?invitation=${encodeURIComponent(TOKEN)}`,
  );
}

describe("TeamsPage – an invite link opened this app", () => {
  beforeEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    sessionStorage.clear();
    adminPost.mockReset();
    listNamespaces.mockReset();
    showToast.mockReset();
    navigate.mockReset();
    window.history.replaceState(null, "", "/teams");
  });
  afterEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("joins, says so, and opens the team", async () => {
    adminPost.mockResolvedValue({});
    listNamespaces.mockResolvedValue([{ namespaceId: NS, name: "Design" }]);
    openWithInvitation();

    render(<TeamsPage />);

    // The state this page never used to have.
    expect(await screen.findByText(/Joining “Design”…/)).toBeTruthy();

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(`/teams/${NS}/projects`),
    );
    // The body is the invitation struct, not the whole decoded token.
    expect(adminPost).toHaveBeenCalledWith(`/namespaces/${NS}/join`, {
      invitation: OUTER,
    });
    // And the post-join sync gate is armed before the navigation.
    expect(sessionStorage.getItem("calimero:justJoinedNamespaces")).toContain(
      NS,
    );
  });

  // The 30s-proxy-abort case: the request fails, the join landed.
  it("says you are already in it rather than reporting a failure", async () => {
    adminPost.mockRejectedValue(new Error("timed out after 30 seconds"));
    listNamespaces.mockResolvedValue([{ namespaceId: NS, name: "Design" }]);
    openWithInvitation();

    render(<TeamsPage />);

    expect(await screen.findByText(/already in “Design”/)).toBeTruthy();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it("shows the node's own reason when the join really failed", async () => {
    adminPost.mockRejectedValue(
      new Error("could not reach any member of this namespace"),
    );
    listNamespaces.mockResolvedValue([]);
    openWithInvitation();

    render(<TeamsPage />);

    expect(
      await screen.findByText(/could not reach any member of this namespace/),
    ).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    // Retryable, so the user is offered one.
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

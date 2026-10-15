// This app's wiring into @calimero-apps/invite, on a delegated (account)
// session: the codec it supplies, the join it supplies, and what lands on
// screen.
//
// Measured on prod as an account, a join through the raw node route
// (`POST /admin-api/namespaces/{ns}/join` with the node JWT) is a 403. It must
// go through the session-aware `useMero().admin`, which redeems through the
// admitter — and it must not happen before the person has said yes.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NS = "ab".repeat(32);

const stub = vi.hoisted(() => {
  const admin = {
    joinNamespace: vi.fn(),
    listNamespacesForApplication: vi.fn(),
    listNamespaces: vi.fn(async () => []),
    listApplications: vi.fn(),
  };
  const rawAdmin = {
    joinNamespace: vi.fn(),
    listNamespacesForApplication: vi.fn(),
    listNamespaces: vi.fn(),
    listApplications: vi.fn(),
  };
  return {
    admin,
    rawAdmin,
    navigate: vi.fn(),
    showToast: vi.fn(),
    mero: {
      mero: { admin: rawAdmin, rpc: { execute: vi.fn() } },
      admin,
      isDelegated: true,
      applicationId: "app",
      nodeUrl: "https://relay.example",
      isAuthenticated: true,
      isLoading: false,
    },
  };
});

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => stub.mero,
  setApplicationId: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => stub.navigate }));
vi.mock("../contexts/ToastContext", () => ({
  useToast: () => ({ showToast: stub.showToast }),
}));

const { encodeInvitationObject } = await import("../utils/invitation");
const { resetInvitationCaptureForTests } = await import(
  "@calimero-apps/invite"
);
const InvitationPrompt = (await import("./InvitationPrompt")).default;

const INVITATION = {
  invitation: { group_id: NS, inviter: "x" },
  signature: "s",
};
const TOKEN = encodeInvitationObject({
  invitation: INVITATION,
  __teamName: "Acme",
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
    vi.clearAllMocks();
    stub.mero.isAuthenticated = true;
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

    expect(await screen.findByText(/invited to “Acme”/)).toBeTruthy();
    expect(screen.getByTestId("invite-accept")).toBeTruthy();
    expect(stub.admin.joinNamespace).not.toHaveBeenCalled();
  });

  it("holds the invitation until the session can join", async () => {
    stub.mero.isAuthenticated = false;
    openWithInvitation();
    const { rerender } = render(<InvitationPrompt />);
    expect(screen.queryByTestId("invite-accept")).toBeNull();

    stub.mero.isAuthenticated = true;
    rerender(<InvitationPrompt />);
    expect(await screen.findByTestId("invite-accept")).toBeTruthy();
  });

  it("joins on accept through admin.joinNamespace, never the raw client, and opens the team", async () => {
    stub.admin.joinNamespace.mockResolvedValue({ namespaceId: NS });
    stub.admin.listNamespacesForApplication.mockResolvedValue([
      { namespaceId: NS, name: "Acme" },
    ]);
    openWithInvitation();
    render(<InvitationPrompt />);

    fireEvent.click(await screen.findByTestId("invite-accept"));

    await waitFor(() =>
      expect(stub.navigate).toHaveBeenCalledWith(`/teams/${NS}/projects`),
    );
    expect(stub.admin.joinNamespace).toHaveBeenCalledWith(NS, {
      invitation: INVITATION,
    });
    expect(stub.rawAdmin.joinNamespace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(stub.showToast).toHaveBeenCalledWith(
        "Joined team. Syncing artwork…",
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
    expect(stub.admin.joinNamespace).not.toHaveBeenCalled();
    expect(stub.navigate).not.toHaveBeenCalled();
  });

  it("shows why when the join really failed, and stays put", async () => {
    stub.admin.joinNamespace.mockRejectedValue(
      new Error("could not reach any member of this namespace"),
    );
    stub.admin.listNamespacesForApplication.mockResolvedValue([]);
    openWithInvitation();
    render(<InvitationPrompt />);

    fireEvent.click(await screen.findByTestId("invite-accept"));

    await waitFor(() =>
      expect(
        screen.getByTestId("invite-status").getAttribute("data-stage"),
      ).toBe("failed"),
    );
    expect(stub.navigate).not.toHaveBeenCalled();
  });
});

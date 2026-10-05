// The Teams page on a delegated (account) session.
//
// Measured on prod as an account: "Create team" was `POST /admin-api/namespaces`
// and "Join" was `POST /admin-api/namespaces/{ns}/join` through the raw axios
// layer with the node JWT — both 403 ("Token does not carry the permissions this
// route requires"), and the 401 interceptor then looped the session back to `/`.
// Both must go through the session-aware `useMero().admin` — the account admin,
// which founds through the relay and redeems through the admitter — and the raw
// client's admin must never be reached. Founding on an account also reports
// whether the cloud agreed to host the team (`haError`), which is said right
// away rather than failing at invite time.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TeamsPage from "./TeamsPage";
import { ToastProvider } from "../contexts/ToastContext";
import { encodeInvitationObject } from "../utils/invitation";

const NS = "ab".repeat(32);

const stub = vi.hoisted(() => {
  const admin = {
    createNamespace: vi.fn(async () => ({ namespaceId: "ns-new", haEnabled: false, haError: "link this account to your cloud user in the wallet" })),
    joinNamespace: vi.fn(async () => ({ namespaceId: "ab".repeat(32), memberIdentity: "k", memberAccount: "a" })),
    deleteNamespace: vi.fn(),
    listNamespacesForApplication: vi.fn(async () => [{ namespaceId: "ns-existing", name: "Existing" }]),
    listNamespaces: vi.fn(async () => []),
    listApplications: vi.fn(),
  };
  const rawAdmin = {
    createNamespace: vi.fn(),
    joinNamespace: vi.fn(),
    deleteNamespace: vi.fn(),
    listNamespacesForApplication: vi.fn(),
    listNamespaces: vi.fn(),
    listApplications: vi.fn(),
  };
  return {
    admin,
    rawAdmin,
    mero: {
      mero: { admin: rawAdmin, rpc: { execute: vi.fn() } },
      admin,
      isDelegated: true,
      applicationId: "app",
      nodeUrl: "https://relay.example",
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    },
  };
});

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => stub.mero,
  setApplicationId: vi.fn(),
}));

// The invite package's capture/redemption machinery is not under test here;
// `redeemInvitation` is reduced to "call the app's join, then its memberships".
vi.mock("@calimero-apps/invite", () => ({
  InviteStatusBanner: () => null,
  describeInviteFailure: () => undefined,
  useInviteRedemption: () => ({ state: { kind: "idle" }, token: "", retry: () => {}, dismiss: () => {} }),
  redeemInvitation: async (
    parsed: { namespaceId: string; invitation: unknown },
    redeemer: { join: (ns: string, inv: unknown) => Promise<void>; memberships: () => Promise<string[]> },
  ) => {
    await redeemer.join(parsed.namespaceId, parsed.invitation);
    await redeemer.memberships();
    return { status: "joined", namespaceId: parsed.namespaceId };
  },
}));
vi.mock("@calimero-apps/join-sync", () => ({ markNamespaceJustJoined: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <ToastProvider>
        <TeamsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("TeamsPage on a delegated session", () => {
  it("lists teams through the account admin, scoped to the provider's application id", async () => {
    renderPage();
    await screen.findByTestId("team-card-ns-existing");
    expect(stub.admin.listNamespacesForApplication).toHaveBeenCalledWith("app");
    expect(stub.admin.listApplications).not.toHaveBeenCalled();
    expect(stub.rawAdmin.listNamespacesForApplication).not.toHaveBeenCalled();
  });

  it("creates a team through admin.createNamespace, never the raw client, and says when it is not hosted", async () => {
    renderPage();
    await screen.findByTestId("team-card-ns-existing");
    fireEvent.change(screen.getByTestId("new-team-input"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByTestId("create-team-btn"));

    await waitFor(() => expect(stub.admin.createNamespace).toHaveBeenCalledTimes(1));
    expect(stub.admin.createNamespace).toHaveBeenCalledWith({ applicationId: "app", name: "Acme" });
    expect(stub.rawAdmin.createNamespace).not.toHaveBeenCalled();
    await screen.findByTestId("team-card-ns-new");
    await screen.findByText(/not hosted yet: link this account/);
  });

  it("joins a pasted invitation through admin.joinNamespace, never the raw client", async () => {
    renderPage();
    await screen.findByTestId("team-card-ns-existing");
    const invitation = { invitation: { group_id: NS, inviter: "x" }, signature: "s" };
    fireEvent.change(screen.getByTestId("join-code-input"), {
      target: { value: encodeInvitationObject({ invitation, __teamName: "Acme" }) },
    });
    fireEvent.click(screen.getByTestId("join-team-btn"));

    await waitFor(() => expect(stub.admin.joinNamespace).toHaveBeenCalledTimes(1));
    expect(stub.admin.joinNamespace).toHaveBeenCalledWith(NS, { invitation });
    expect(stub.rawAdmin.joinNamespace).not.toHaveBeenCalled();
    await screen.findByText(/Joined team/);
  });

  it("hides the node-only Delete control", async () => {
    renderPage();
    await screen.findByTestId("team-card-ns-existing");
    fireEvent.click(screen.getByTitle("More options"));
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
  });
});

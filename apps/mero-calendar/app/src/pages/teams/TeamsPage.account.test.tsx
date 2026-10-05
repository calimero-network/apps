/**
 * The teams page on a DELEGATED (account) session.
 *
 * ⚠️ The prod reproduction this pins: every admin call went over raw axios to
 * `localStorage`'s node URL with the node JWT — a delegated session has
 * neither, and the relay's node routes answer an account's token with 403
 * (`POST /admin-api/namespaces`, `POST /admin-api/namespaces/{ns}/join`,
 * `POST /admin-api/namespaces/{ns}/invite`). The page must create, join and
 * invite through `useMero().admin` — the session-aware account admin — and
 * never through the raw client's `mero.admin`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NS = "a1".repeat(32);
const SIGNED = { invitation: { group_id: NS, expiration_timestamp: 0 }, signature: "sig" };

const stub = vi.hoisted(() => {
  const admin = {
    createNamespace: vi.fn(),
    listNamespacesForApplication: vi.fn(async () => []),
    listNamespaces: vi.fn(async () => []),
    joinNamespace: vi.fn(async () => ({ namespaceId: "" })),
    createNamespaceInvitation: vi.fn(),
    deleteNamespace: vi.fn(),
    listApplications: vi.fn(),
  };
  // The RAW client's admin: the relay's node route, a 403 for an account.
  // These spies exist to prove the page never reaches it.
  const rawAdmin = {
    createNamespace: vi.fn(),
    joinNamespace: vi.fn(),
    createNamespaceInvitation: vi.fn(),
    listApplications: vi.fn(),
    listNamespaces: vi.fn(),
    listNamespacesForApplication: vi.fn(),
  };
  const showToast = vi.fn();
  return { admin, rawAdmin, showToast };
});

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({
    admin: stub.admin,
    mero: { admin: stub.rawAdmin },
    isDelegated: true,
    applicationId: "app-from-registry",
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
  setApplicationId: vi.fn(),
  getApplicationId: () => "",
}));
vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ showToast: stub.showToast }),
}));
vi.mock("../../components/common/theme-toggle/ThemeToggle", () => ({
  default: () => null,
}));
// The link-capture half of @calimero-apps/invite needs the real window
// history; the redeem engine is exercised for real below (it is mero-js's).
vi.mock("@calimero-apps/invite", async () => {
  const real = await vi.importActual<typeof import("@calimero-apps/invite")>(
    "@calimero-apps/invite",
  );
  return {
    ...real,
    useInviteRedemption: () => ({
      state: { status: "idle" },
      token: "",
      retry: vi.fn(),
      dismiss: vi.fn(),
    }),
    InviteStatusBanner: () => null,
  };
});

import TeamsPage from "./TeamsPage";
import { encodeInvitationObject } from "../../utils/invitation";

function open() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <TeamsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  stub.admin.listNamespacesForApplication.mockResolvedValue([]);
  stub.admin.createNamespace.mockResolvedValue({ namespaceId: NS, haEnabled: true });
  stub.admin.createNamespaceInvitation.mockResolvedValue({ invitation: SIGNED });
});

describe("an account creating a team", () => {
  it("founds the namespace through the account admin, never the raw client", async () => {
    open();
    fireEvent.change(await screen.findByTestId("new-team-input"), {
      target: { value: "Design" },
    });
    fireEvent.click(screen.getByTestId("create-team-btn"));

    await waitFor(() => expect(stub.admin.createNamespace).toHaveBeenCalled());
    expect(stub.admin.createNamespace).toHaveBeenCalledWith({
      applicationId: "app-from-registry",
      name: "Design",
    });
    expect(stub.rawAdmin.createNamespace).not.toHaveBeenCalled();
    await screen.findByTestId(`team-card-${NS}`);
  });

  it("takes the application id from the registry, not from a node listing", async () => {
    // `GET /admin-api/applications` is node-wide; the relay refuses it to an
    // account (403), and an account has no install of its own to find.
    open();
    fireEvent.change(await screen.findByTestId("new-team-input"), {
      target: { value: "Design" },
    });
    fireEvent.click(screen.getByTestId("create-team-btn"));
    await waitFor(() => expect(stub.admin.createNamespace).toHaveBeenCalled());
    expect(stub.admin.listApplications).not.toHaveBeenCalled();
    expect(stub.rawAdmin.listApplications).not.toHaveBeenCalled();
  });

  it("says right away when the cloud refused to host the new team", async () => {
    // The team exists; only HA was refused. Surfaced at creation, where it can
    // be acted on, instead of at the first invite.
    stub.admin.createNamespace.mockResolvedValue({
      namespaceId: NS,
      haEnabled: false,
      haError: "link this account to your cloud user in the wallet",
    });
    open();
    fireEvent.change(await screen.findByTestId("new-team-input"), {
      target: { value: "Design" },
    });
    fireEvent.click(screen.getByTestId("create-team-btn"));
    await waitFor(() => expect(stub.showToast).toHaveBeenCalled());
    expect(String(stub.showToast.mock.calls[0][0])).toMatch(/link this account/);
    await screen.findByTestId(`team-card-${NS}`);
  });
});

describe("an account joining a team from an invitation code", () => {
  it("redeems through the account admin's joinNamespace, never the raw client", async () => {
    // After the join the account's own namespace list has the team.
    stub.admin.listNamespacesForApplication.mockResolvedValue([]);
    stub.admin.joinNamespace.mockImplementation(async () => {
      stub.admin.listNamespacesForApplication.mockResolvedValue([
        { namespaceId: NS, targetApplicationId: "app-from-registry", name: "Design" },
      ]);
      return { namespaceId: NS };
    });

    open();
    // Exactly what `generateInvite` encodes: the admin's `{ invitation }`
    // envelope plus the team name hint.
    const code = encodeInvitationObject({ invitation: SIGNED, __teamName: "Design" });
    fireEvent.change(await screen.findByTestId("join-code-input"), {
      target: { value: code },
    });
    fireEvent.click(screen.getByTestId("join-team-btn"));

    await waitFor(() => expect(stub.admin.joinNamespace).toHaveBeenCalled());
    const [namespaceId, body] = stub.admin.joinNamespace.mock.calls[0] as [
      string,
      { invitation: unknown },
    ];
    expect(namespaceId).toBe(NS);
    // The signed invitation goes through untouched: the signature covers it
    // exactly as minted.
    expect(body.invitation).toEqual(SIGNED);
    expect(stub.rawAdmin.joinNamespace).not.toHaveBeenCalled();
    await screen.findByTestId(`team-card-${NS}`);
  });
});

describe("an account inviting to a team", () => {
  it("mints the invitation through the account admin, never the raw client", async () => {
    stub.admin.listNamespacesForApplication.mockResolvedValue([
      { namespaceId: NS, targetApplicationId: "app-from-registry", name: "Design" },
    ]);
    open();
    fireEvent.click(await screen.findByTestId(`team-menu-${NS}`));
    fireEvent.click(screen.getByText("Invite"));
    await waitFor(() =>
      expect(stub.admin.createNamespaceInvitation).toHaveBeenCalledWith(NS),
    );
    expect(stub.rawAdmin.createNamespaceInvitation).not.toHaveBeenCalled();
    await screen.findByTestId("copy-invite");
  });

  it("does not offer Delete: deleting a namespace is a node's own operation", async () => {
    stub.admin.listNamespacesForApplication.mockResolvedValue([
      { namespaceId: NS, targetApplicationId: "app-from-registry", name: "Design" },
    ]);
    open();
    fireEvent.click(await screen.findByTestId(`team-menu-${NS}`));
    expect(screen.getByText("Invite")).toBeTruthy();
    expect(screen.queryByTestId(`delete-team-${NS}`)).toBeNull();
  });
});

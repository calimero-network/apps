/**
 * The teams page on a DELEGATED (account) session.
 *
 * ⚠️ The prod reproduction this pins: every admin call went over raw axios to
 * `localStorage`'s node URL with the node JWT — a delegated session has
 * neither, and the relay's node routes answer an account's token with 403
 * (`POST /admin-api/namespaces`, `POST /admin-api/namespaces/{ns}/join`,
 * `POST /admin-api/namespaces/{ns}/invite`). The page must create and invite
 * through `useMero().admin` — the session-aware account admin — and never
 * through the raw client's `mero.admin`. (Joining is the invitation prompt's,
 * and tested beside it.)
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccountId } from "../../api/identity";
import { readLastVisit, rememberTeam } from "../../utils/lastVisit";

const NS = "a1".repeat(32);
const ME = "d4".repeat(32);
const SIGNED = { invitation: { group_id: NS, expiration_timestamp: 0 }, signature: "sig" };

const stub = vi.hoisted(() => {
  const admin = {
    createNamespace: vi.fn(),
    listNamespacesForApplication: vi.fn(async () => []),
    listNamespaces: vi.fn(async () => []),
    createNamespaceInvitation: vi.fn(),
    deleteNamespace: vi.fn(),
    leaveNamespace: vi.fn(async () => {}),
    getNodeIdentity: vi.fn(),
    listGroupMembers: vi.fn(),
    listApplications: vi.fn(),
  };
  // The RAW client's admin: the relay's node route, a 403 for an account.
  // These spies exist to prove the page never reaches it.
  const rawAdmin = {
    createNamespace: vi.fn(),
    createNamespaceInvitation: vi.fn(),
    listApplications: vi.fn(),
    listNamespaces: vi.fn(),
    listNamespacesForApplication: vi.fn(),
  };
  const showToast = vi.fn();
  // The registry-derived id lands after sign-in; a test may hold it back.
  const session = { applicationId: "app-from-registry" as string | null };
  return { admin, rawAdmin, showToast, session };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({
    admin: stub.admin,
    mero: { admin: stub.rawAdmin },
    isDelegated: true,
    applicationId: stub.session.applicationId,
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
import TeamsPage from "./TeamsPage";

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
  resetAccountId();
  stub.session.applicationId = "app-from-registry";
  stub.admin.getNodeIdentity.mockResolvedValue({ accountId: ME });
  stub.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: "Admin" }] });
  stub.admin.listNamespacesForApplication.mockResolvedValue([]);
  stub.admin.createNamespace.mockResolvedValue({ namespaceId: NS, haEnabled: true });
  stub.admin.createNamespaceInvitation.mockResolvedValue({ invitation: SIGNED });
});

describe("an account whose application id has not landed yet", () => {
  it("waits for it instead of reading an empty list as no teams", async () => {
    stub.session.applicationId = null;
    rememberTeam(undefined, NS);
    stub.admin.listNamespacesForApplication.mockResolvedValue([
      { namespaceId: NS, targetApplicationId: "app-from-registry", name: "Design" },
    ]);
    const page = () => (
      <MemoryRouter initialEntries={[{ pathname: "/teams", state: { resume: true } }]}>
        <Routes>
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId" element={<p>team page</p>} />
        </Routes>
      </MemoryRouter>
    );
    const view = render(page());
    // Nothing can be listed for no application: no "no teams", and the team
    // you had open is not forgotten.
    await act(async () => {});
    expect(screen.queryByTestId("empty-teams")).toBeNull();
    expect(readLastVisit(undefined).team).toBe(NS);

    stub.session.applicationId = "app-from-registry";
    view.rerender(page());
    // The remembered team, still listed, is the one opened.
    await screen.findByText("team page");
    expect(stub.admin.listNamespacesForApplication).toHaveBeenCalledWith("app-from-registry");
  });

  it("does not found a team without one", async () => {
    stub.session.applicationId = null;
    open();
    fireEvent.change(await screen.findByTestId("new-team-input"), {
      target: { value: "Design" },
    });
    fireEvent.click(screen.getByTestId("create-team-btn"));
    await waitFor(() => expect(stub.showToast).toHaveBeenCalled());
    expect(stub.admin.createNamespace).not.toHaveBeenCalled();
  });
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

  it("shows the link it copies, never the raw code", async () => {
    // A link is opened; a code would have to be pasted somewhere, and there
    // is nowhere to paste one.
    stub.admin.listNamespacesForApplication.mockResolvedValue([
      { namespaceId: NS, targetApplicationId: "app-from-registry", name: "Design" },
    ]);
    open();
    fireEvent.click(await screen.findByTestId(`team-menu-${NS}`));
    fireEvent.click(screen.getByText("Invite"));
    const copy = await screen.findByTestId("copy-invite");
    const shown = copy.parentElement?.querySelector("code");
    expect(shown?.getAttribute("title")).toMatch(
      /^https:\/\/links\.calimero\.network\/com\.calimero\.mero-calendar\/join\?invitation=/,
    );
    expect(shown?.textContent).toMatch(/^https:\/\/links\.calimero\.network\//);
  });

  it("does not offer an admin Delete (a node's own operation), nor Leave", async () => {
    stub.admin.listNamespacesForApplication.mockResolvedValue([
      { namespaceId: NS, targetApplicationId: "app-from-registry", name: "Design" },
    ]);
    open();
    await waitFor(() => expect(stub.admin.listGroupMembers).toHaveBeenCalledWith(NS));
    await act(async () => {}); // let the role land before asserting an absence
    fireEvent.click(await screen.findByTestId(`team-menu-${NS}`));
    expect(screen.getByText("Invite")).toBeTruthy();
    expect(screen.queryByTestId(`delete-team-${NS}`)).toBeNull();
    expect(screen.queryByTestId(`leave-team-${NS}`)).toBeNull();
  });

  it("offers a member Leave through the account admin, and drops the team once left", async () => {
    stub.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: "Member" }] });
    stub.admin.listNamespacesForApplication.mockResolvedValue([
      { namespaceId: NS, targetApplicationId: "app-from-registry", name: "Design" },
    ]);
    open();
    fireEvent.click(await screen.findByTestId(`team-menu-${NS}`));
    fireEvent.click(await screen.findByTestId(`leave-team-${NS}`));
    expect(screen.queryByTestId(`delete-team-${NS}`)).toBeNull();
    await waitFor(() => expect(stub.admin.leaveNamespace).toHaveBeenCalledWith(NS));
    await waitFor(() => expect(screen.queryByTestId(`team-card-${NS}`)).toBeNull());
  });
});

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../contexts/ToastContext";
import { clearHostingState } from "../lib/hosting";
import { clearApplicationIdCache } from "../hooks/useApplicationId";
import { getExecutorPublicKey, getContextId } from "../lib/session";
import StreamsPage from "./StreamsPage";
import RoomsPage from "./RoomsPage";

// ── The transport switch, as a test ──────────────────────────────────────────
//
// On a delegated (ACCOUNT) session `useMero().mero.admin` is the relay's NODE
// route: `POST /admin-api/namespaces`, `/contexts` and `/namespaces/:id/join`
// answer 403 to an account's token, `GET /admin-api/applications` answers 403,
// and `identities-owned` answers `[]`. `useMero().admin` is the account admin,
// which carries the same calls through the relay. These tests render the two
// pages with BOTH clients spied, and with `fetch` spied, and prove the pages
// reach only the account admin — never the raw client, never a raw route.

const ACCOUNT = "cc".repeat(32);
const DEVICE_SIGN_PK = "ab".repeat(32);

/** A spied admin method whose answer any test may override. */
type AdminFn = Mock<(...args: unknown[]) => Promise<unknown>>;
const fn = (impl: () => unknown): AdminFn =>
  vi.fn(async () => impl()) as unknown as AdminFn;

/** The session-aware admin, `useMero().admin`. */
const admin = {
  listNamespacesForApplication: fn(() => [
    { namespaceId: "ns1", name: "Team", memberCount: 1, subgroupCount: 0 },
  ]),
  createNamespace: fn(() => ({
    namespaceId: "ns-new",
    haEnabled: false,
    haError: "link this account to your cloud user in the wallet",
  })),
  setDefaultCapabilities: fn(() => undefined),
  setSubgroupVisibility: fn(() => undefined),
  joinNamespace: fn(() => undefined),
  listNamespaces: fn(() => []),
  getNamespace: fn(() => ({ namespaceId: "ns1", name: "Team" })),
  listNamespaceGroups: fn(() => []),
  listGroupContexts: fn(() => []),
  listGroupMembers: fn(() => ({ members: [] })),
  getGroupMetadata: fn(() => null),
  createGroupInNamespace: fn(() => ({ groupId: "room1" })),
  setGroupMetadata: fn(() => undefined),
  createContext: fn(() => ({
    contextId: "ctx1",
    // What the account admin returns: no node-held key to report.
    memberPublicKey: "",
  })),
  getContextIdentitiesOwned: fn(() => ({ identities: [ACCOUNT] })),
  createNamespaceInvitation: fn(() => ({
    invitation: { invitation: { groupId: "ns1" }, inviter_signature: "sig" },
  })),
  listApplications: fn(() => ({ apps: [] })),
};

/** The RAW client's admin, `useMero().mero.admin` — must never be reached. */
const rawAdmin = Object.fromEntries(
  Object.keys(admin).map((k) => [
    k,
    fn(() => {
      throw Object.assign(new Error(`403 on the node route: ${k}`), {
        status: 403,
      });
    }),
  ]),
) as Record<keyof typeof admin, AdminFn>;

const rpcExecute = fn(() => []);

/** No jest-dom here: the attribute is the fact. */
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;
const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: () => navigate };
});

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({
    isAuthenticated: true,
    isDelegated: true,
    admin,
    mero: { admin: rawAdmin, rpc: { execute: rpcExecute }, events: {} },
    applicationId: "app-from-registry",
    nodeUrl: "https://relay.example",
    logout: vi.fn(),
  }),
  readDelegatedCredential: () => ({
    account: ACCOUNT,
    credential: "good-credential",
    deviceSecret: "11".repeat(32),
  }),
}));

vi.mock("@calimero-network/mero-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calimero-network/mero-js")>()),
  parseDeviceCredential: () => ({
    account: ACCOUNT,
    device: "dd".repeat(32),
    signPublicKey: DEVICE_SIGN_PK.toUpperCase(),
  }),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error("a raw route was fetched");
});

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  proto.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  vi.stubGlobal("fetch", fetchSpy);
});

beforeEach(() => {
  clearHostingState();
  clearApplicationIdCache();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const neverTouchedTheNodeRoute = () => {
  for (const fn of Object.values(rawAdmin)) expect(fn).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
};

function renderStreams() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/streams"]}>
        <Routes>
          <Route path="/streams" element={<StreamsPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

function renderRooms(namespaceId = "ns1") {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/streams/${namespaceId}`]}>
        <Routes>
          <Route path="/streams/:namespaceId" element={<RoomsPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("StreamsPage on an account session", () => {
  it("lists streams by the registry-derived app id, through the account admin", async () => {
    renderStreams();
    await screen.findByText("Team");
    expect(admin.listNamespacesForApplication).toHaveBeenCalledWith(
      "app-from-registry",
    );
    // An account installs nothing: the node's install list is never asked for,
    // and "not installed" is never the verdict.
    expect(admin.listApplications).not.toHaveBeenCalled();
    expect(screen.queryByText(/not installed/i)).toBeNull();
    neverTouchedTheNodeRoute();
  });

  it("creates a stream through the account admin and remembers a hosting refusal", async () => {
    renderStreams();
    await screen.findByText("Team");
    fireEvent.change(screen.getByTestId("stream-name-input"), {
      target: { value: "Launch" },
    });
    fireEvent.click(screen.getByTestId("create-stream"));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/streams/ns-new"),
    );
    expect(admin.createNamespace).toHaveBeenCalledWith({
      applicationId: "app-from-registry",
      name: "Launch",
    });
    expect(admin.setDefaultCapabilities).toHaveBeenCalled();
    neverTouchedTheNodeRoute();

    // The refusal travels with the namespace to the page the create lands on.
    cleanup();
    renderRooms("ns-new");
    const note = await screen.findByTestId("rooms-hosting");
    expect(note.textContent).toContain(
      "link this account to your cloud user in the wallet",
    );
    expect(isDisabled(screen.getByTestId("invite-namespace"))).toBe(true);
  });

  it("redeems a pasted code through the account admin's joinNamespace", async () => {
    const { encodeInvite } = await import("../lib/inviteCodec");
    const code = encodeInvite({
      invitation: {
        invitation: { groupId: "ns-joined" },
        inviter_signature: "sig",
      } as never,
      kind: "namespace",
      groupId: "ns-joined",
    });
    renderStreams();
    await screen.findByText("Team");
    fireEvent.click(screen.getByTestId("open-join"));
    fireEvent.change(screen.getByTestId("join-code-input"), {
      target: { value: code },
    });
    fireEvent.click(screen.getByTestId("join-submit"));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/streams/ns-joined"),
    );
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    expect(admin.joinNamespace.mock.calls[0][0]).toBe("ns-joined");
    neverTouchedTheNodeRoute();
  });
});

describe("RoomsPage on an account session", () => {
  it("creates a room and executes as the identity identities-owned reports", async () => {
    renderRooms();
    // The name is in the breadcrumb and the heading — any match will do.
    await screen.findAllByText("Team");
    fireEvent.change(screen.getByTestId("room-name-input"), {
      target: { value: "Standup" },
    });
    fireEvent.click(screen.getByTestId("create-room"));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/live"));
    expect(admin.createGroupInNamespace).toHaveBeenCalledWith("ns1", {
      groupName: "Standup",
    });
    expect(admin.setSubgroupVisibility).toHaveBeenCalledWith("room1", {
      subgroupVisibility: "open",
    });
    expect(admin.createContext).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-from-registry",
        groupId: "room1",
      }),
    );
    // The executor stored for the call is the ACCOUNT (what the session holds
    // in the context), not the "" the create response carried.
    expect(getContextId()).toBe("ctx1");
    expect(getExecutorPublicKey()).toBe(ACCOUNT);
    neverTouchedTheNodeRoute();
  });

  it("marks the DEVICE key as you in a room's roster, not the account", async () => {
    admin.listNamespaceGroups.mockResolvedValueOnce([{ groupId: "room1" }]);
    admin.listGroupContexts.mockResolvedValueOnce([{ contextId: "ctx1" }]);
    admin.getGroupMetadata.mockResolvedValueOnce({ name: "Standup" });
    rpcExecute.mockResolvedValueOnce([
      { memberId: DEVICE_SIGN_PK, username: "", joinedAt: 1, updatedAt: 1 },
      {
        memberId: "ee".repeat(32),
        username: "Dana",
        joinedAt: 1,
        updatedAt: 1,
      },
    ] as never);

    renderRooms();
    // Self first, and flagged "(you)" in the title — the contract keys members
    // by the certified device key, which `getContextIdentitiesOwned` does not
    // return for an account. Re-queried each time: the row re-renders once the
    // roster lands. `shortId` is the first 8 hex chars plus an ellipsis.
    await waitFor(() =>
      expect(screen.getByTestId("room-roster").title).toBe(
        `${DEVICE_SIGN_PK.slice(0, 8)}… (you), Dana`,
      ),
    );
    expect(screen.getByTestId("room-roster").title).not.toContain(
      ACCOUNT.slice(0, 8),
    );
    neverTouchedTheNodeRoute();
  });

  it("mints a room code through the account admin and gates Invite on a refusal", async () => {
    admin.listNamespaceGroups.mockResolvedValueOnce([{ groupId: "room1" }]);
    admin.createNamespaceInvitation.mockRejectedValueOnce(
      Object.assign(new Error("nobody could claim an invitation to ns1"), {
        name: "InvitationNotClaimableError",
        reason: "not-hosted",
      }),
    );
    renderRooms();
    const invite = await screen.findByTestId("invite-room");
    expect(isDisabled(invite)).toBe(false);
    fireEvent.click(invite);

    await screen.findByTestId("rooms-hosting");
    expect(isDisabled(screen.getByTestId("invite-room"))).toBe(true);
    expect(isDisabled(screen.getByTestId("invite-namespace"))).toBe(true);
    expect(admin.createNamespaceInvitation).toHaveBeenCalledWith("ns1", {});
    neverTouchedTheNodeRoute();
  });
});

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
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
import { encodeInvite } from "../lib/inviteCodec";
import { clearHostingState } from "../lib/hosting";
import { clearApplicationIdCache } from "../hooks/useApplicationId";
import { getExecutorPublicKey } from "../lib/session";
import CompaniesPage from "./CompaniesPage";
import AudiencesPage from "./AudiencesPage";

// ── The three calls that 403 on prod for an account ───────────────────────────
//
// On a delegated (account) session `useMero().mero.admin` is the relay's NODE
// route: `POST /admin-api/namespaces`, `POST /admin-api/contexts` and
// `POST /admin-api/namespaces/:id/join` all answer 403 to an account's token,
// and `identities-owned` answers `[]`. `useMero().admin` is the account admin,
// which carries the same calls through the relay. These tests render the two
// pages with BOTH clients spied and prove the pages reach only the account one.

/** The session-aware admin, `useMero().admin`. */
const admin = {
  listNamespacesForApplication: vi.fn(async () => [
    { namespaceId: "ns1", name: "Acme", memberCount: 1, subgroupCount: 0 },
  ]),
  createNamespace: vi.fn(async () => ({
    namespaceId: "ns-new",
    haEnabled: false,
    haError: "link this account to your cloud user in the wallet",
  })),
  setDefaultCapabilities: vi.fn(async () => undefined),
  setSubgroupVisibility: vi.fn(async () => undefined),
  joinNamespace: vi.fn(async () => undefined),
  listNamespaces: vi.fn(async () => []),
  getNamespace: vi.fn(async () => ({ namespaceId: "ns1", name: "Acme" })),
  listNamespaceGroups: vi.fn(async () => []),
  createGroupInNamespace: vi.fn(async () => ({ groupId: "aud1" })),
  setGroupMetadata: vi.fn(async () => undefined),
  createContext: vi.fn(async () => ({
    contextId: "ctx1",
    memberPublicKey: "",
  })),
  getContextIdentitiesOwned: vi.fn(async () => ({ identities: ["acct-1"] })),
};

/** The RAW client's admin, `useMero().mero.admin` — must never be reached. */
const rawAdmin = Object.fromEntries(
  Object.keys(admin).map((k) => [
    k,
    vi.fn(async () => {
      throw Object.assign(new Error(`403 on the node route: ${k}`), {
        status: 403,
      });
    }),
  ]),
) as Record<keyof typeof admin, ReturnType<typeof vi.fn>>;

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
    mero: { admin: rawAdmin, rpc: {}, events: {} },
    applicationId: "app-from-registry",
    nodeUrl: "https://relay.example",
    logout: vi.fn(),
  }),
}));

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  proto.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
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
};

function renderCompanies() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/companies"]}>
        <Routes>
          <Route path="/companies" element={<CompaniesPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("an account session (delegated) on the companies page", () => {
  it("lists companies by the REGISTRY application id, without asking the node what is installed", async () => {
    renderCompanies();
    await screen.findByTestId("space-row");
    expect(admin.listNamespacesForApplication).toHaveBeenCalledWith(
      "app-from-registry",
    );
    // `listApplications` is not even on the fake: reaching for it would throw.
    neverTouchedTheNodeRoute();
  });

  it("creates a namespace through the account admin and says so when the cloud will not host it", async () => {
    renderCompanies();
    await screen.findByTestId("space-row");
    fireEvent.change(screen.getByTestId("space-name-input"), {
      target: { value: "New Co" },
    });
    fireEvent.click(screen.getByTestId("create-space"));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/companies/ns-new"),
    );
    expect(admin.createNamespace).toHaveBeenCalledWith({
      applicationId: "app-from-registry",
      name: "New Co",
    });
    expect(admin.setDefaultCapabilities).toHaveBeenCalled();
    // The hosting refusal is surfaced right after creation, not at invite time.
    expect(
      await screen.findByText(/link this account to your cloud user/),
    ).toBeInTheDocument();
    neverTouchedTheNodeRoute();
  });

  it("redeems a pasted invitation through the account admin", async () => {
    renderCompanies();
    await screen.findByTestId("space-row");
    const code = encodeInvite({
      invitation: {
        invitation: { groupId: "ns2", nonce: 1 },
        inviter_signature: "sig",
      },
      kind: "namespace",
      groupId: "ns2",
      groupAlias: "Beta",
    } as unknown as Parameters<typeof encodeInvite>[0]);
    fireEvent.change(screen.getByTestId("join-input"), {
      target: { value: code },
    });
    fireEvent.click(screen.getByTestId("join-btn"));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/companies/ns2"),
    );
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    expect(admin.joinNamespace).toHaveBeenCalledWith("ns2", expect.anything());
    neverTouchedTheNodeRoute();
  });

  it("hides Delete — deleting a namespace is a node's own operation", async () => {
    renderCompanies();
    await screen.findByTestId("space-row");
    fireEvent.click(screen.getByTestId("space-menu"));
    expect(screen.getByTestId("invite-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("delete-space")).toBeNull();
  });
});

describe("an account session (delegated) on the audiences page", () => {
  function renderAudiences() {
    return render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/companies/ns1"]}>
          <Routes>
            <Route path="/companies/:namespaceId" element={<AudiencesPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
  }

  it("creates the audience context through the account admin and posts as the ACCOUNT", async () => {
    renderAudiences();
    await screen.findByTestId("audiences-empty");
    fireEvent.change(screen.getByTestId("audience-name-input"), {
      target: { value: "All investors" },
    });
    fireEvent.click(screen.getByTestId("create-audience"));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/a"));
    expect(admin.createContext).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-from-registry",
        groupId: "aud1",
      }),
    );
    // The create response's memberPublicKey was "" — the identity written to the
    // session is the one identities-owned reported, i.e. the account.
    expect(getExecutorPublicKey()).toBe("acct-1");
    neverTouchedTheNodeRoute();
  });

  it("gates Invite on hosting once a refusal is known, and hides Delete", async () => {
    const { markSpaceUnhosted } = await import("../lib/hosting");
    markSpaceUnhosted(
      "ns1",
      "link this account to your cloud user in the wallet",
    );
    renderAudiences();
    await screen.findByTestId("audiences-empty");
    const invite = screen.getByTestId("invite-space") as HTMLButtonElement;
    expect(invite.disabled).toBe(true);
    expect(invite.title).toMatch(/link this account/);
  });
});

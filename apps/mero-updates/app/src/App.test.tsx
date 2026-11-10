import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The screens on a mocked CalimeroClient: what they ask the node, and that the
// new wire (camelCase, u64 as decimal strings) reaches them in the shapes they
// were written against.

const h = vi.hoisted(() => {
  const wire: Record<string, unknown> = {
    getMe: { account: "ana", name: "Ana", firm: "CEO", isAdmin: true, isTeam: true, muted: [] },
    getOverview: {
      companyName: "Acme",
      cadenceDays: 30,
      lastUpdateAt: "1700000000000",
      nextDueAt: "1702592000000",
      updatesTotal: "1",
      unreadUpdates: "0",
      openAsks: "1",
      openQuestions: "0",
      people: "2",
      isTeam: true,
    },
    listCategories: [],
    listDrafts: [],
    listPosts: {
      items: [
        {
          id: "p1",
          kind: "update",
          author: "ana",
          authorName: "Ana",
          authorIsTeam: true,
          title: "June 2026 update",
          summary: "First enterprise customer.",
          categoryId: "",
          status: "published",
          createdAt: "1700000000000",
          editedAt: "1700000000000",
          commentCount: "2",
          askCount: "1",
          openAskCount: "1",
          metricCount: "1",
          readCount: "3",
          readByMe: true,
          reactions: [{ emoji: "👍", count: "1", mine: false }],
        },
      ],
      nextCursor: null,
    },
  };
  const client = {
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: wire[method] ?? null })),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    // A stream that stays open and quiet until aborted.
    events: vi.fn(async function* (_app: string, _from?: number, signal?: AbortSignal) {
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      yield* [] as { id: string; kind: string; data: unknown }[];
    }),
    me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", name: "Acme", role: "owner" }] })),
    listApps: vi.fn(async () => [
      { appId: "app-1", name: "All investors", owner: "ana", org: "org-1", bundle: "b", package: null, version: null },
    ]),
    getOrg: vi.fn(
      async (): Promise<{ name: string; members: Record<string, string>; memberMetadata: Record<string, unknown> }> => ({
        name: "Acme",
        members: { ana: "owner", ben: "member" },
        memberMetadata: {},
      }),
    ),
    createOrg: vi.fn(async () => "org-2"),
    setMemberMetadata: vi.fn(async () => undefined),
    setCapabilities: vi.fn(async () => undefined),
    createApp: vi.fn(async () => "app-2"),
    invite: vi.fn(async () => "token-1"),
  };
  return { wire, client };
});

vi.mock("./lib/sessionContext", () => {
  const signedIn = {
    client: h.client,
    accountId: "ana",
    target: { kind: "local", nodes: ["http://127.0.0.1:2501"] },
    source: "bundle-1",
    passkey: () => ({}),
    after: () => {},
  };
  return {
    useSignedIn: () => signedIn,
    useMaybeSignedIn: () => signedIn,
    useSessionApi: () => ({ api: { session: { status: "signed-in" }, signOut: async () => {} } }),
  };
});

// jsdom has `<dialog>` but not `showModal()`/`close()`.
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  proto.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  });
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("inside an audience", () => {
  it("renders the feed and the shell from the node's answers", async () => {
    const { setActiveAudience, setAudienceName } = await import("./lib/active");
    setActiveAudience("app-1", "org-1");
    setAudienceName("app-1", "All investors");
    const { default: AudienceShell } = await import("./components/AudienceShell");
    const { default: UpdatesPage } = await import("./pages/UpdatesPage");
    const { ToastProvider } = await import("./contexts/ToastContext");
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/a"]}>
          <Routes>
            <Route path="/a" element={<AudienceShell />}>
              <Route index element={<UpdatesPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(await screen.findByText("June 2026 update")).toBeInTheDocument();
    expect((await screen.findAllByText("Acme")).length).toBeGreaterThan(0);
    // Views, by their ABI names, against the open instance.
    const viewed = h.client.view.mock.calls.map(([app, method]) => `${app}:${method}`);
    expect(viewed).toEqual(expect.arrayContaining(["app-1:getMe", "app-1:getOverview", "app-1:listCategories"]));
    expect(h.client.view).toHaveBeenCalledWith("app-1", "listPosts", {
      kind: "update",
      categoryId: null,
      cursor: null,
      limit: 100,
    });
    // The live stream of this instance is open.
    expect(h.client.events).toHaveBeenCalledWith("app-1", undefined, expect.any(AbortSignal));
  });
});

describe("your name in an audience", () => {
  const ME = h.wire.getMe as Record<string, unknown>;
  afterEach(() => {
    h.wire.getMe = ME;
  });

  async function openAudience(org: string) {
    const { setActiveAudience } = await import("./lib/active");
    setActiveAudience("app-1", org);
    const { default: AudienceShell } = await import("./components/AudienceShell");
    const { ToastProvider } = await import("./contexts/ToastContext");
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/a"]}>
          <Routes>
            <Route path="/a" element={<AudienceShell />}>
              <Route index element={<p>feed</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    await screen.findByText("feed");
  }

  it("never asks when the company has your name: copies it into the audience's profile", async () => {
    h.wire.getMe = { ...ME, name: "", firm: "" };
    h.client.getOrg.mockResolvedValueOnce({
      name: "Acme",
      members: { ana: "owner" },
      memberMetadata: { ana: { name: "Ana Lee" } },
    });
    await openAudience("org-named");
    await waitFor(() =>
      expect(h.client.call).toHaveBeenCalledWith("app-1", "setProfile", { name: "Ana Lee", firm: "" }),
    );
    expect(screen.queryByTestId("profile-prompt")).toBeNull();
    expect(h.client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("publishes an audience profile name to a company that has none, without asking", async () => {
    await openAudience("org-adopt");
    await waitFor(() => expect(h.client.setMemberMetadata).toHaveBeenCalledWith("org-adopt", "ana", { name: "Ana" }));
    expect(screen.queryByTestId("profile-prompt")).toBeNull();
  });

  it("asks once, for the company, when no name is known anywhere", async () => {
    h.wire.getMe = { ...ME, name: "", firm: "" };
    localStorage.setItem("calimero-names:last", "Ana from Globex");
    await openAudience("org-unnamed");
    const prompt = await screen.findByTestId("profile-prompt");
    expect(prompt).toHaveTextContent("Your name in this company");
    const input = screen.getByLabelText("Your name") as HTMLInputElement;
    expect(input.value).toBe("Ana from Globex");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(h.client.setMemberMetadata).toHaveBeenCalledWith("org-unnamed", "ana", { name: "Ana from Globex" }),
    );
    expect(h.client.call).toHaveBeenCalledWith("app-1", "setProfile", { name: "Ana from Globex", firm: "" });
  });
});

describe("the company pages", () => {
  it("lists the account's companies with their audiences and members", async () => {
    const { default: CompaniesPage } = await import("./pages/CompaniesPage");
    const { ToastProvider } = await import("./contexts/ToastContext");
    render(
      <ToastProvider>
        <MemoryRouter>
          <CompaniesPage />
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(await screen.findByText("1 audience · 2 members")).toBeInTheDocument();
    expect(h.client.listApps).toHaveBeenCalledWith({ bundle: "bundle-1" });
  });

  it("creates a company as an org whose members may start audiences and invite", async () => {
    const { default: CompaniesPage } = await import("./pages/CompaniesPage");
    const { ToastProvider } = await import("./contexts/ToastContext");
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/companies"]}>
          <Routes>
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:namespaceId" element={<p>audiences of the new company</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    fireEvent.change(await screen.findByTestId("space-name-input"), { target: { value: "Globex" } });
    // Your name in the company is asked here, once, with the company.
    expect(screen.getByTestId("create-space")).toBeDisabled();
    fireEvent.change(screen.getByTestId("self-name-input"), { target: { value: "Ana Lee" } });
    fireEvent.click(screen.getByTestId("create-space"));
    expect(await screen.findByText("audiences of the new company")).toBeInTheDocument();
    expect(h.client.createOrg).toHaveBeenCalledWith("Globex");
    expect(h.client.setCapabilities).toHaveBeenCalledWith("org-2", expect.any(Number), expect.anything());
    expect(h.client.setMemberMetadata).toHaveBeenCalledWith("org-2", "ana", { name: "Ana Lee" });
  });

  it("creates an audience as an app instance in the company and opens it", async () => {
    const { default: AudiencesPage } = await import("./pages/AudiencesPage");
    const { ToastProvider } = await import("./contexts/ToastContext");
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/companies/org-1"]}>
          <Routes>
            <Route path="/companies/:namespaceId" element={<AudiencesPage />} />
            <Route path="/a" element={<p>inside the audience</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(await screen.findByText("All investors")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("audience-name-input"), { target: { value: "Angels" } });
    fireEvent.click(screen.getByTestId("create-audience"));
    expect(await screen.findByText("inside the audience")).toBeInTheDocument();
    expect(h.client.createApp).toHaveBeenCalledWith("Angels", "bundle-1", { org: "org-1" });
    const { getActiveNamespaceId, getContextId } = await import("./lib/active");
    await waitFor(() => expect(getContextId()).toBe("app-2"));
    expect(getActiveNamespaceId()).toBe("org-1");
  });

  it("tells a member who may not add an audience to ask an owner, instead of offering Create (B8)", async () => {
    const { default: AudiencesPage } = await import("./pages/AudiencesPage");
    const { ToastProvider } = await import("./contexts/ToastContext");
    // A member whose company defaults were never set (the step-up refused): no CREATE_APP.
    const owner = h.client.getOrg.getMockImplementation();
    h.client.getOrg.mockResolvedValue({ name: "Acme", members: { ana: "member", ben: "owner" }, memberMetadata: {} });
    Object.assign(h.client, { session: { accountId: "ana" } });
    try {
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={["/companies/org-1"]}>
            <Routes>
              <Route path="/companies/:namespaceId" element={<AudiencesPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>,
      );
      expect((await screen.findByTestId("create-audience-ask")).textContent).toMatch(/Only an owner or admin/);
      expect(screen.queryByTestId("create-audience")).toBeNull();
    } finally {
      delete (h.client as { session?: unknown }).session;
      if (owner) h.client.getOrg.mockImplementation(owner);
    }
  });

  it("mints an audience invite: an org invite whose link lands in that audience", async () => {
    const { default: AudiencesPage } = await import("./pages/AudiencesPage");
    const { ToastProvider } = await import("./contexts/ToastContext");
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/companies/org-1"]}>
          <Routes>
            <Route path="/companies/:namespaceId" element={<AudiencesPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByTestId("audience-menu"));
    fireEvent.click(screen.getByTestId("invite-audience"));
    const link = await screen.findByTestId("invite-link");
    expect(h.client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
    expect(link.textContent).toContain("invite=token-1");
    expect(link.textContent).toContain("audience=app-1");
  });
});

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The screens on a mocked CalimeroClient: what they ask the node, and that the
// new wire (camelCase, u64 as decimal strings) reaches them in the shapes they
// were written against.

const h = await vi.hoisted(async () => {
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
  const client = (await import("@calimero-apps/connect/testing")).withRoutes({
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
    listAppTeams: vi.fn(async (): Promise<{ mode: string; appTeams: { package: string; teamId: string }[] }> => ({ mode: "legacy", appTeams: [] })),
  });
  return { wire, client, session: { source: "bundle-1" as string | { package: string } } };
});

vi.mock("./lib/sessionContext", () => {
  const signedIn = {
    client: h.client,
    accountId: "ana",
    target: { kind: "local", nodes: ["http://127.0.0.1:2501"] },
    get source() {
      return h.session.source;
    },
    passkey: () => ({}),
    after: () => {},
  };
  return {
    useSignedIn: () => signedIn,
    useMaybeSignedIn: () => signedIn,
    useSessionApi: () => ({ api: { session: { status: "signed-in" }, signOut: async () => {} } }),
  };
});

// The shared dialog is mero-react"s to test: here only what the app hands it and does after.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<object>()),
    InviteDialog: (p: {
      open: boolean;
      org: string;
      teams?: string[];
      linkBase?: string;
      appName?: string;
      labels?: { noun?: string; note?: string; title?: string };
    }) =>
      p.open
        ? createElement(
            "pre",
            { "data-testid": "invite-dialog" },
            JSON.stringify({ org: p.org, teams: p.teams, linkBase: p.linkBase, appName: p.appName, title: p.labels?.title, noun: p.labels?.noun, note: p.labels?.note }),
          )
        : null,
    CreateWorkspaceDialog: (p: {
      open: boolean;
      defaultSelfName?: string;
      release: unknown;
      labels?: { title?: string };
      onCreated: (w: { orgId: string; name: string; selfName: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "create-dialog" },
            createElement("h2", { "data-testid": "create-title" }, p.labels?.title),
            createElement("p", { "data-testid": "create-self" }, p.defaultSelfName),
            createElement("pre", { "data-testid": "create-release" }, JSON.stringify(p.release)),
            createElement(
              "button",
              { "data-testid": "create-done", onClick: () => p.onCreated({ orgId: "org-2", name: "Globex", selfName: "Ana Lee" }) },
              "done",
            ),
          )
        : null,
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
    // The live stream of this instance is open, from the log's head (the view's index 1): no replay.
    await waitFor(() => expect(h.client.events).toHaveBeenCalledWith("app-1", 2, expect.any(AbortSignal)));
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
    // The org, its name and yours come from the shared dialog.
    fireEvent.click(await screen.findByTestId("create-space"));
    expect(JSON.parse((await screen.findByTestId("create-release")).textContent ?? "null")).toEqual({ package: "com.calimero.mero-updates" });
    fireEvent.click(screen.getByTestId("create-done"));
    expect(await screen.findByText("audiences of the new company")).toBeInTheDocument();
    expect(h.client.createOrg).not.toHaveBeenCalled();
    expect(h.client.setCapabilities).toHaveBeenCalledWith("org-2", expect.any(Number), expect.anything());
    expect(h.client.setMemberMetadata).toHaveBeenCalledWith("org-2", "ana", { name: "Ana Lee" });
  });

  it("Invite on a company opens the shared dialog for that company", async () => {
    const { default: CompaniesPage } = await import("./pages/CompaniesPage");
    const { ToastProvider } = await import("./contexts/ToastContext");
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/companies"]}>
          <Routes>
            <Route path="/companies" element={<CompaniesPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByTestId("space-menu"));
    fireEvent.click(screen.getByTestId("invite-btn"));
    const shown = JSON.parse((await screen.findByTestId("invite-dialog")).textContent ?? "");
    expect(shown).toMatchObject({ org: "org-1", teams: [], appName: "Hyperfeed Updates", title: "Invite people to Acme", noun: "company" });
    expect(shown.note).toBeUndefined();
    expect(Object.fromEntries(new URL(shown.linkBase).searchParams)).toEqual({ org: "org-1" });
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

  async function openAudienceInvite() {
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
  }

  it("opens the shared invite dialog for an audience: a link that lands in it, on the app team", async () => {
    h.session.source = { package: "com.calimero.mero-updates" };
    h.client.listAppTeams.mockResolvedValueOnce({ mode: "standalone", appTeams: [{ package: "com.calimero.mero-updates", teamId: "team-1" }] });
    try {
      await openAudienceInvite();
      const shown = JSON.parse((await screen.findByTestId("invite-dialog")).textContent ?? "");
      expect(shown).toMatchObject({ org: "org-1", teams: ["team-1"], appName: "Hyperfeed Updates", title: "Invite to All investors" });
      expect(Object.fromEntries(new URL(shown.linkBase).searchParams)).toEqual({ org: "org-1", audience: "app-1" });
    } finally {
      h.session.source = "bundle-1";
    }
  });

  it("an app-only org gets the note on the audience invite dialog", async () => {
    h.session.source = { package: "com.calimero.mero-updates" };
    h.client.listAppTeams.mockResolvedValueOnce({ mode: "shared", appTeams: [{ package: "com.calimero.mero-updates", teamId: "team-1" }] });
    try {
      await openAudienceInvite();
      const shown = JSON.parse((await screen.findByTestId("invite-dialog")).textContent ?? "");
      expect(shown.note).toMatch(/^Invites to Hyperfeed Updates only/);
    } finally {
      h.session.source = "bundle-1";
    }
  });

  it("an org with app teams but none for this app: Invite says so and opens no dialog", async () => {
    h.session.source = { package: "com.calimero.mero-updates" };
    h.client.listAppTeams.mockResolvedValueOnce({ mode: "shared", appTeams: [{ package: "com.calimero.other", teamId: "team-9" }] });
    try {
      await openAudienceInvite();
      expect(await screen.findByText(/not set up/)).toBeInTheDocument();
      expect(screen.queryByTestId("invite-dialog")).toBeNull();
    } finally {
      h.session.source = "bundle-1";
    }
  });
});
